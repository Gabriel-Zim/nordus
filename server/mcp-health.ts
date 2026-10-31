// Background health of the remote (http/SSE) MCP servers: a probe every 5 minutes, faster while one is failing,
// so a dropped connection shows on the list and reaches the bot as a plain sentence instead of a raw tool error.
import type { McpProbeFailureKind, McpProbeResult } from "./mcp-probe.ts";

export type McpHealthState = "ok" | "degraded" | "down";

export interface McpHealthEntry {
  state: McpHealthState;
  checkedAt: number;
  /** Last time the server answered a probe. */
  lastOkAt: number | null;
  /** First failed probe of the current outage. */
  downSince: number | null;
  failures: number;
  /** Why the last probe failed, in one plain pt-BR sentence with no technical detail; absent while the server answers. */
  reason?: string;
}

const REASON_BY_KIND: Record<McpProbeFailureKind, string> = {
  unreachable: "Não consegui falar com o app agora.",
  timeout: "O app demorou demais para responder.",
  http: "O app recusou o acesso; pode ser preciso entrar de novo.",
  protocol: "O app respondeu de um jeito que não consegui entender.",
  spawn: "Não consegui abrir o app neste computador.",
  closed: "O app foi encerrado antes de responder.",
  cancelled: "A verificação do app foi interrompida.",
};

/** The short sentence the person reads when an app is failing; a result without a code gets the generic one. */
export function mcpHealthReason(result: McpProbeResult | { kind?: McpProbeFailureKind }): string {
  const kind = (result as { kind?: McpProbeFailureKind }).kind;
  return (kind && REASON_BY_KIND[kind]) || "Não consegui falar com o app agora.";
}

export const MCP_HEALTH_INTERVAL_MS = 5 * 60_000;
/** While a server is failing it is probed every minute, so it comes back on its own soon after it answers again. */
export const MCP_HEALTH_RETRY_MS = 60_000;
export const MCP_HEALTH_PROBE_TIMEOUT_MS = 15_000;
/** One failed probe is "degraded"; this many in a row is "down". */
export const MCP_HEALTH_DOWN_AFTER = 2;

export interface McpHealthDeps<S> {
  /** Enabled remote servers by name, read fresh on every round. */
  servers: () => Record<string, S>;
  probe: (name: string, server: S, signal: AbortSignal) => Promise<McpProbeResult>;
  now?: () => number;
  onChange?: (name: string, entry: McpHealthEntry | null) => void;
  setTimer?: (run: () => void, ms: number) => { cancel(): void };
}

export class McpHealthMonitor<S = unknown> {
  private readonly entries = new Map<string, McpHealthEntry>();
  private timer: { cancel(): void } | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private readonly now: () => number;
  private readonly deps: McpHealthDeps<S>;

  constructor(deps: McpHealthDeps<S>) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  start(firstDelayMs = 30_000): void {
    this.stopped = false;
    this.schedule(firstDelayMs);
  }

  stop(): void {
    this.stopped = true;
    this.timer?.cancel();
    this.timer = null;
  }

  entry(name: string): McpHealthEntry | undefined {
    const entry = this.entries.get(name);
    return entry ? { ...entry } : undefined;
  }

  snapshot(): Record<string, McpHealthEntry> {
    return Object.fromEntries([...this.entries].map(([name, entry]) => [name, { ...entry }]));
  }

  /** One round over every enabled remote server, one at a time; overlapping calls share the same round. */
  checkAll(): Promise<void> {
    this.running ??= this.round().finally(() => { this.running = null; });
    return this.running;
  }

  private async round(): Promise<void> {
    const servers = this.deps.servers();
    for (const name of this.entries.keys()) {
      if (!(name in servers)) {
        this.entries.delete(name);
        this.deps.onChange?.(name, null);
      }
    }
    for (const [name, server] of Object.entries(servers)) {
      let result: McpProbeResult;
      try {
        result = await this.deps.probe(name, server, AbortSignal.timeout(MCP_HEALTH_PROBE_TIMEOUT_MS));
      } catch {
        result = { ok: false, error: "probe failed" };
      }
      this.note(name, result);
    }
  }

  private note(name: string, result: McpProbeResult): void {
    const at = this.now();
    const previous = this.entries.get(name);
    // A server that wants the person to sign in is reachable; that is the sign-in badge's job, not an outage.
    const answered = result.ok || result.auth === "required";
    const next: McpHealthEntry = answered
      ? { state: "ok", checkedAt: at, lastOkAt: at, downSince: null, failures: 0 }
      : {
        state: (previous?.failures ?? 0) + 1 >= MCP_HEALTH_DOWN_AFTER ? "down" : "degraded",
        checkedAt: at,
        lastOkAt: previous?.lastOkAt ?? null,
        downSince: previous?.downSince ?? at,
        failures: (previous?.failures ?? 0) + 1,
        reason: mcpHealthReason(result),
      };
    this.entries.set(name, next);
    if (previous?.state !== next.state || previous?.reason !== next.reason) this.deps.onChange?.(name, { ...next });
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    const set = this.deps.setTimer ?? ((run, delay) => {
      const handle = setTimeout(run, delay);
      handle.unref?.();
      return { cancel: () => clearTimeout(handle) };
    });
    this.timer = set(() => {
      void this.checkAll().finally(() => {
        const failing = [...this.entries.values()].some((entry) => entry.state !== "ok");
        this.schedule(failing ? MCP_HEALTH_RETRY_MS : MCP_HEALTH_INTERVAL_MS);
      });
    }, ms);
  }
}

function clockTime(at: number, timeZone: string): string {
  const format = (zone: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone }).format(at);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

/** The line a bot reads at the start of its turn when one of its connections is failing; empty when all answer. */
export function mcpOutageNote(entries: Record<string, McpHealthEntry | undefined>, names: readonly string[], timeZone: string): string {
  const lines: string[] = [];
  for (const name of names) {
    const entry = entries[name];
    if (!entry || entry.state === "ok" || entry.downSince === null) continue;
    const since = clockTime(entry.downSince, timeZone);
    lines.push(entry.state === "down"
      ? `A conexão ${name} está fora do ar desde ${since}.`
      : `A conexão ${name} está instável desde ${since}.`);
  }
  if (!lines.length) return "";
  return `[Nordus: ${lines.join(" ")} Se a tarefa depender dela, diga isso em uma frase simples em vez de mostrar o erro, e siga com o que der para fazer sem ela.]`;
}
