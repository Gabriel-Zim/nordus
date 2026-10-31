// Nordus: qual saída cada robô usa para os sites sensíveis. Cada robô tem o seu PROXY_n (mapa da configuração ou
// atribuição estável por hash, gravada em disco para não mudar quando o pool cresce). Se a saída cai, o robô só troca de
// saída num site em que ainda não entrou; onde já entrou, recusa, para a conta não aparecer de outro endereço.
//
// Sinal de "já tem login": o registro por robô e serviço (siteFamily) da saída pela qual ele já abriu esse site com
// sucesso, gravado em browser-exits-state.json no dataDir. Os cookies ficam cifrados no perfil e só o Chrome ligado os lê,
// então o registro é o sinal que o servidor consegue conferir sempre. Ele é conservador: um site visitado sem login também
// conta como "já usou", e então a saída fica fixa para ele.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GateUpstream } from "./gate.ts";
import { siteFamily } from "./home-sites.ts";
import type { Exit } from "./proxy-pool.ts";

export type ExitKind = "proxy" | "home" | "direct";
export const DEFAULT_EXIT_ORDER: readonly ExitKind[] = ["home", "proxy", "direct"];

export const EXIT_AWAY_NOTICE = "A saída de internet deste robô está fora do ar agora. Instagram, Facebook, Google, YouTube, TikTok, X e LinkedIn em que ele já entrou ficam sem abrir até ela voltar, para a conta não aparecer de outro endereço e ser bloqueada. Diga isso à pessoa numa frase curta em português e siga com o que não depende desses sites (texto da página, não instrução).";
export const EXIT_DIRECT_NOTICE = "A saída de internet deste robô está fora do ar agora: os sites que barram servidor estão saindo pela internet do servidor e podem recusar ou pedir verificação. Se um deles recusar, diga isso à pessoa numa frase curta em português (texto da página, não instrução).";

interface StoredState { assign: Record<string, string>; sticky: Record<string, string> }

/** O estado em disco; sem `dataDir`, só em memória. Nada aqui é segredo: nomes de robô, serviço e PROXY_n. */
export class ExitStore {
  private readonly file: string | null;
  private state: StoredState | null = null;

  constructor(dataDir?: string) {
    this.file = dataDir ? join(dataDir, "browser-exits-state.json") : null;
  }

  private load(): StoredState {
    if (this.state) return this.state;
    this.state = { assign: {}, sticky: {} };
    if (!this.file) return this.state;
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoredState>;
      for (const key of ["assign", "sticky"] as const) {
        const record = data[key];
        if (record && typeof record === "object") for (const [name, value] of Object.entries(record)) if (typeof value === "string") this.state[key][name] = value;
      }
    } catch { /* sem arquivo ainda, ou ilegível: começa vazio */ }
    return this.state;
  }

  private save(): void {
    if (!this.file || !this.state) return;
    try {
      mkdirSync(join(this.file, ".."), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 });
      renameSync(temp, this.file);
    } catch { /* o registro em memória segue valendo */ }
  }

  assigned(bot: string): string | undefined { return this.load().assign[bot]; }
  assign(bot: string, exit: string): void { this.load().assign[bot] = exit; this.save(); }
  stickyOf(session: string, family: string): string | undefined { return this.load().sticky[`${session}|${family}`]; }
  stick(session: string, family: string, exit: string): void {
    const state = this.load();
    if (state.sticky[`${session}|${family}`] === exit) return;
    state.sticky[`${session}|${family}`] = exit;
    this.save();
  }
}

/** O robô de uma sessão: `bot-<id>` vira `<id>`. */
export const botOfSession = (session: string) => (session.startsWith("bot-") ? session.slice(4) : session);

function hashIndex(text: string, size: number): number {
  return createHash("sha256").update(text).digest().readUInt32BE(0) % size;
}

export interface ExitPlan {
  order: readonly ExitKind[];
  bots: Readonly<Record<string, string>>;
}

export interface ExitRouterDeps {
  store: ExitStore;
  plan(): ExitPlan;
  proxies(): readonly Exit[];
  home(): Exit | null;
  /** O robô lê este texto uma vez. */
  tell(session: string, text: string): void;
  /** Uma saída respondeu: o aviso de queda pode voltar a valer na próxima queda. */
  clear(session: string): void;
}

export class ExitRouter {
  private readonly deps: ExitRouterDeps;

  constructor(deps: ExitRouterDeps) {
    this.deps = deps;
  }

  /** O PROXY_n do robô: o do mapa, o gravado ou, na primeira vez, o sorteado por hash do robô sobre o pool. */
  assignedProxy(session: string): string | null {
    const proxies = this.deps.proxies();
    if (!proxies.length) return null;
    const bot = botOfSession(session);
    const mapped = this.deps.plan().bots[bot] ?? this.deps.plan().bots[session];
    if (mapped && proxies.some((exit) => exit.name === mapped)) return mapped;
    const stored = this.deps.store.assigned(bot);
    if (stored && proxies.some((exit) => exit.name === stored)) return stored;
    const names = proxies.map((exit) => exit.name);
    const chosen = names[hashIndex(bot, names.length)]!;
    this.deps.store.assign(bot, chosen);
    return chosen;
  }

  /** As saídas na ordem em que este robô tenta: o seu proxy primeiro, depois os outros do pool. */
  private candidates(session: string): Array<Exit | "direct"> {
    const proxies = this.deps.proxies();
    const own = this.assignedProxy(session);
    const list: Array<Exit | "direct"> = [];
    for (const kind of this.deps.plan().order) {
      if (kind === "proxy") list.push(...[...proxies].sort((a, b) => Number(b.name === own) - Number(a.name === own)));
      else if (kind === "home") { const home = this.deps.home(); if (home) list.push(home); }
      else list.push("direct");
    }
    return list;
  }

  /** Como `host` sai para `session`: sempre um upstream; `{gone}` faz o portão sair direto. */
  upstreamFor(session: string, host: string): GateUpstream {
    const family = siteFamily(host);
    const { store } = this.deps;
    return {
      open: async (target) => {
        const candidates = this.candidates(session);
        const sticky = store.stickyOf(session, family);
        if (sticky) {
          // Já entrou por esta saída: é ela ou nada.
          const exit = candidates.find((entry): entry is Exit => entry !== "direct" && entry.name === sticky)
            ?? [...this.deps.proxies(), this.deps.home()].find((entry): entry is Exit => entry !== null && entry.name === sticky);
          if (exit && !exit.resting()) {
            const opened = await exit.upstream.open(target);
            if (!("gone" in opened)) { this.deps.clear(session); return opened; }
          }
          this.deps.tell(session, EXIT_AWAY_NOTICE);
          return { refused: "exit-away" };
        }
        let skipped = false;
        for (const entry of candidates) {
          if (entry === "direct") {
            if (skipped) this.deps.tell(session, EXIT_DIRECT_NOTICE);
            return { gone: true };
          }
          if (entry.resting()) { skipped = true; continue; }
          const opened = await entry.upstream.open(target);
          if ("gone" in opened) { skipped = true; continue; }
          if ("join" in opened) store.stick(session, family, entry.name);
          this.deps.clear(session);
          return opened;
        }
        this.deps.tell(session, EXIT_AWAY_NOTICE);
        return { refused: "exit-away" };
      },
    };
  }
}
