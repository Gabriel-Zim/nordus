import { lookup } from "node:dns/promises";
import { existsSync, statSync, statfsSync } from "node:fs";
import { basename } from "node:path";
import { connect } from "node:tls";
import type { DoctorCheck } from "../../shared/doctor.ts";
import type { ProviderSnapshot } from "../contracts.ts";
import type { McpHealthEntry } from "../mcp-health.ts";
import { redactSecretsInText } from "../redact.ts";
import { withReadOnlyDb } from "../sentinel/sources.ts";
import type { DoctorSource } from "./service.ts";

export const STEP_MS = 4_000;
const GIB = 1024 ** 3;
export const DISK_FAIL_BYTES = 2 * GIB;
export const DISK_WARN_BYTES = 10 * GIB;
const WAL_WARN_BYTES = 512 * 1024 ** 2;

/** Technical text never carries a credential and never grows without bound. */
export function technical(text: string): string {
  return redactSecretsInText(text).replace(/\s+/g, " ").trim().slice(0, 300);
}

export function withTimeout<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem resposta em ${Math.round(ms / 1000)} s`)), ms);
    const abort = () => { clearTimeout(timer); reject(new Error("verificação cancelada")); };
    signal?.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => { clearTimeout(timer); signal?.removeEventListener("abort", abort); });
  });
}

export interface EngineProbe {
  id: string;
  label: string;
  /** The engine's internal name, kept for the technical text only. */
  kind?: string;
  /** Some bot runs on it. An engine nobody uses and that is not set up is left out, not failed. */
  inUse: boolean;
  snapshot(): Promise<ProviderSnapshot>;
}

export function engineSource(engines: () => readonly EngineProbe[]): DoctorSource {
  return {
    group: "engines",
    label: "Motores",
    run: async (signal) => {
      const checks = (await Promise.all(engines().map((engine) => engineCheck(engine, signal)))).filter((check) => check !== null);
      if (!checks.some((check) => check.status !== "fail")) {
        checks.unshift({ id: "engine:nenhum", group: "engines", label: "Motores", status: "fail",
          detail: "Nenhum motor está funcionando, então nenhum robô consegue responder.",
          fix: "Abra Ajustes, Motores, e conecte pelo menos um motor. Se não conseguir, avise o TECNICO." });
      }
      return checks;
    },
  };
}

async function engineCheck(engine: EngineProbe, signal: AbortSignal): Promise<DoctorCheck | null> {
  const base = { id: `engine:${engine.id}`, group: "engines" as const, label: engine.label };
  let snapshot: ProviderSnapshot;
  try {
    snapshot = await withTimeout(engine.snapshot(), STEP_MS, signal);
  } catch (error) {
    return { ...base, status: "warn", detail: `${engine.label} não respondeu a tempo.`,
      fix: "Verifique de novo em um minuto. Se continuar, peça ao TECNICO para olhar este motor.",
      technical: technical(error instanceof Error ? error.message : String(error)) };
  }
  const facts = technical([engine.kind ? `motor ${engine.kind}` : "", snapshot.version ? `versão ${snapshot.version}` : "", snapshot.reason ?? "", snapshot.authenticationUnavailableReason ?? ""].filter(Boolean).join("; "));
  const tech = facts ? { technical: facts } : {};
  if (snapshot.state !== "available") {
    if (!engine.inUse) return null;
    return { ...base, ...tech, status: "fail", detail: `${engine.label} não está funcionando neste servidor.`,
      fix: "Peça ao TECNICO para instalar ou atualizar este motor." };
  }
  if (snapshot.authenticated === false) {
    return { ...base, ...tech, status: "fail", detail: `${engine.label} está instalado, mas saiu da conta.`,
      fix: "Abra Ajustes, Motores, e entre de novo na conta deste motor." };
  }
  if (snapshot.update || snapshot.warning) {
    return { ...base, status: "warn", detail: `${engine.label} funciona, mas tem um aviso.`,
      technical: technical([facts, snapshot.warning?.title ?? "", snapshot.update?.title ?? ""].filter(Boolean).join("; ")),
      fix: snapshot.update ? "Peça ao TECNICO para atualizar este motor." : "Abra Ajustes, Motores, para ver o aviso." };
  }
  return { ...base, ...tech, status: "ok", detail: `${engine.label} está instalado e conectado.` };
}

export interface NetworkTarget { id: string; label: string; host: string }

export const PROVIDER_TARGETS: readonly NetworkTarget[] = [
  { id: "anthropic", label: "Anthropic (Claude)", host: "api.anthropic.com" },
  { id: "openai", label: "OpenAI (Codex)", host: "api.openai.com" },
  { id: "xai", label: "xAI (Grok)", host: "api.x.ai" },
  { id: "google", label: "Google (Gemini)", host: "generativelanguage.googleapis.com" },
];

export interface NetworkProbes {
  dns(host: string): Promise<unknown>;
  tls(host: string): Promise<unknown>;
  http(url: string, signal: AbortSignal): Promise<{ status: number }>;
}

export const realNetworkProbes: NetworkProbes = {
  dns: (host) => lookup(host),
  tls: (host) => new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host }, () => { socket.end(); resolve(); });
    socket.setTimeout(STEP_MS, () => socket.destroy(new Error("TLS sem resposta")));
    socket.once("error", reject);
  }),
  http: async (url, signal) => {
    const response = await fetch(url, { method: "GET", signal, redirect: "manual" });
    await response.body?.cancel();
    return { status: response.status };
  },
};

/** Any answer proves the provider is reachable; 401 is the expected answer without a key. */
export function networkSource(targets: readonly NetworkTarget[], probes: NetworkProbes = realNetworkProbes): DoctorSource {
  return {
    group: "network",
    label: "Conexão com os provedores",
    run: (signal) => Promise.all(targets.map(async (target): Promise<DoctorCheck> => {
      const base = { id: `network:${target.id}`, group: "network" as const, label: target.label };
      const unreachable = (stage: string, error: unknown): DoctorCheck => ({
        ...base, status: "fail",
        detail: `O servidor não consegue falar com ${target.label}. Os robôs que usam esse provedor vão falhar.`,
        fix: "Se for só este provedor, provavelmente é instabilidade dele: espere alguns minutos. Se todos falharem, a internet do servidor caiu; avise o TECNICO.",
        technical: technical(`${stage} ${target.host}: ${error instanceof Error ? error.message : String(error)}`),
      });
      try { await withTimeout(probes.dns(target.host), STEP_MS, signal); } catch (error) { return unreachable("DNS", error); }
      try { await withTimeout(probes.tls(target.host), STEP_MS, signal); } catch (error) { return unreachable("TLS", error); }
      const controller = new AbortController();
      const stop = () => controller.abort();
      signal.addEventListener("abort", stop, { once: true });
      let status: number;
      try {
        status = (await withTimeout(probes.http(`https://${target.host}/`, controller.signal), STEP_MS, signal)).status;
      } catch (error) {
        return unreachable("HTTP", error);
      } finally {
        controller.abort();
        signal.removeEventListener("abort", stop);
      }
      const tech = { technical: `HTTP ${status} de ${target.host}` };
      if (status === 403 || status === 429) {
        return { ...base, ...tech, status: "warn", detail: `${target.label} respondeu, mas está recusando ou limitando os pedidos deste servidor.`,
          fix: "Espere alguns minutos. Se continuar, avise o TECNICO para conferir a conta e o limite." };
      }
      if (status >= 500) {
        return { ...base, ...tech, status: "warn", detail: `${target.label} respondeu com erro do lado dele.`,
          fix: "É instabilidade do provedor. Espere alguns minutos e verifique de novo." };
      }
      return { ...base, ...tech, status: "ok", detail: `O servidor alcança ${target.label}.` };
    })),
  };
}

export function diskSource(dir: string, statfs: (path: string) => { freeBytes: number; totalBytes: number } = (path) => {
  const stats = statfsSync(path);
  return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
}): DoctorSource {
  return {
    group: "disk",
    label: "Espaço em disco",
    run: async () => {
      const { freeBytes, totalBytes } = statfs(dir);
      const free = `${(freeBytes / GIB).toFixed(1).replace(".", ",")} GB livres`;
      const base = { id: "disk", group: "disk" as const, label: "Espaço em disco", technical: `${free} de ${(totalBytes / GIB).toFixed(0)} GB em ${dir}` };
      if (freeBytes < DISK_FAIL_BYTES) {
        return [{ ...base, status: "fail", detail: `O disco do servidor está quase cheio (${free}). Conversas e arquivos novos podem não ser salvos.`,
          fix: "Avise o TECNICO agora para liberar espaço." }];
      }
      if (freeBytes < DISK_WARN_BYTES) {
        return [{ ...base, status: "warn", detail: `O disco do servidor está ficando cheio (${free}).`,
          fix: "Peça ao TECNICO para liberar espaço nos próximos dias." }];
      }
      return [{ ...base, status: "ok", detail: `Há espaço de sobra no disco (${free}).` }];
    },
  };
}

/** A bot whose tools failed to load in a turn, remembered until that bot finishes a turn well. */
export interface ToolLoadFailure { botId: string; botName: string; turnId?: string; at: number; message: string }

export class ToolLoadFailures {
  private readonly byBot = new Map<string, ToolLoadFailure>();
  failed(failure: ToolLoadFailure): void { this.byBot.set(failure.botId, failure); }
  /** The turn that failed to load its tools does not clear itself by finishing. */
  turnSucceeded(botId: string, turnId: string | undefined): void {
    const failure = this.byBot.get(botId);
    if (failure && (failure.turnId === undefined || failure.turnId !== turnId)) this.byBot.delete(botId);
  }
  list(): ToolLoadFailure[] { return [...this.byBot.values()]; }
}

export function toolsSource(deps: { connections(): Record<string, McpHealthEntry | undefined>; loadFailures(): readonly ToolLoadFailure[] }): DoctorSource {
  return {
    group: "tools",
    label: "Ferramentas",
    run: async () => {
      const checks: DoctorCheck[] = [];
      for (const [name, entry] of Object.entries(deps.connections())) {
        if (!entry || entry.state === "ok") continue;
        checks.push({
          id: `tools:${name}`, group: "tools", label: `Conexão ${name}`,
          status: entry.state === "down" ? "fail" : "warn",
          detail: entry.state === "down"
            ? `A conexão de ferramentas ${name} está fora do ar. Os robôs que dependem dela não conseguem usá-la.`
            : `A conexão de ferramentas ${name} falhou na última tentativa.`,
          fix: "O Nordus tenta de novo sozinho a cada minuto. Se não voltar, abra Ajustes e confira o login dessa conexão.",
          technical: technical(`falhas seguidas: ${entry.failures}${entry.downSince ? `; fora desde ${new Date(entry.downSince).toISOString()}` : ""}`),
        });
      }
      for (const failure of deps.loadFailures()) {
        checks.push({
          id: `tools:robo:${failure.botId}`, group: "tools", label: `Ferramentas de ${failure.botName}`,
          status: "warn",
          detail: `No último turno, as ferramentas de ${failure.botName} não carregaram. O aviso some quando ${failure.botName} terminar um turno sem erro.`,
          fix: `Mande uma nova mensagem para ${failure.botName}. Se o aviso voltar, relate o problema ao TECNICO.`,
          technical: technical(`${new Date(failure.at).toISOString()}: ${failure.message}`),
        });
      }
      if (!checks.length) checks.push({ id: "tools", group: "tools", label: "Ferramentas", status: "ok", detail: "Todas as ferramentas carregaram no último uso." });
      return checks;
    },
  };
}

export function databaseSource(files: readonly string[]): DoctorSource {
  return {
    group: "databases",
    label: "Bancos de dados",
    run: async () => files.filter((file) => existsSync(file)).map((file): DoctorCheck => {
      const name = basename(file);
      const base = { id: `database:${name}`, group: "databases" as const, label: databaseLabel(name) };
      try {
        const tables = withReadOnlyDb(file, (db) => (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n) ?? 0;
        const size = statSync(file).size;
        const wal = existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0;
        const tech = { technical: `${name}: ${tables} tabelas, ${mb(size)} MB, diário ${mb(wal)} MB` };
        if (wal > WAL_WARN_BYTES) {
          return { ...base, ...tech, status: "warn", detail: "O banco responde, mas o diário de gravação está grande e pode deixar o Nordus lento.",
            fix: "Peça ao TECNICO para compactar o banco num horário calmo." };
        }
        return { ...base, ...tech, status: "ok", detail: "O banco abre e responde normalmente." };
      } catch (error) {
        return { ...base, status: "fail", detail: "O banco não abriu. Parte do Nordus pode não salvar ou não mostrar dados.",
          fix: "Avise o TECNICO agora. Não reinicie nem apague nada por conta própria.",
          technical: technical(`${name}: ${error instanceof Error ? error.message : String(error)}`) };
      }
    }),
  };
}

function databaseLabel(name: string): string {
  if (name === "messages.db") return "Conversas";
  if (name === "runtime.db") return "Tarefas em andamento";
  return name;
}

function mb(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1).replace(".", ",");
}
