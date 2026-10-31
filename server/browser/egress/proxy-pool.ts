// Nordus: o pool de proxy residencial. Cada linha do arquivo de segredos vira uma saída autenticada (SOCKS5 com usuário e
// senha, RFC 1929, ou HTTP CONNECT com Proxy-Authorization Basic) para o portão de rede dos navegadores dos robôs.
// Usuário e senha nunca saem daqui: o que aparece em log, estado ou API é só "PROXY_1 host:porta".
import { Buffer } from "node:buffer";
import { connect as tcpConnect, isIP, type Socket } from "node:net";
import { statSync, readFileSync } from "node:fs";

import type { LinkOpened } from "../../../electron/device-link-protocol.mjs";
import type { GateTarget, GateUpstream } from "./gate.ts";

export const DEFAULT_PROXY_FILE = "/home/nordus/.nordus-secrets/proxy-residencial.env";

const CONNECT_MS = 8_000;
const ANSWER_MS = 15_000;
/** Depois de uma falha, a saída só é chamada de novo a cada tanto: um site não espera 8 s a cada pedido. */
const RETRY_MS = 30_000;
const RELOAD_CHECK_MS = 5_000;
/** O alvo leve do teste de saúde: abrir e fechar, sem mandar nada. */
export const PROBE_TARGET: GateTarget = { host: "www.google.com", port: 443 };

export interface ProxySpec {
  name: string;
  scheme: "socks5" | "http";
  host: string;
  port: number;
  user?: string;
  pass?: string;
}

/** "socks5://usuario:senha@host:1080" ou "http://host:3128"; o que não for isso devolve null. */
export function parseProxyUrl(name: string, value: string): ProxySpec | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  const scheme = url.protocol === "socks5:" || url.protocol === "socks5h:" ? "socks5" : url.protocol === "http:" ? "http" : null;
  if (!scheme) return null;
  const port = Number(url.port || (scheme === "http" && /:80(?:\/|$)/u.test(value.trim().replace(/^[^@]*@/u, "")) ? "80" : ""));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (!host) return null;
  let user: string | undefined;
  let pass: string | undefined;
  try {
    if (url.username) user = decodeURIComponent(url.username);
    if (url.password) pass = decodeURIComponent(url.password);
  } catch { return null; }
  if ((user?.length ?? 0) > 255 || (pass?.length ?? 0) > 255) return null;
  return { name, scheme, host, port, ...(user !== undefined ? { user } : {}), ...(pass !== undefined ? { pass } : {}) };
}

/** Só "PROXY_1 host:porta", sem usuário nem senha. */
export function maskProxy(spec: Pick<ProxySpec, "name" | "host" | "port">): string {
  return `${spec.name} ${spec.host.includes(":") ? `[${spec.host}]` : spec.host}:${spec.port}`;
}

export interface ParsedProxyFile { proxies: ProxySpec[]; ignored: number[] }

/** Linhas `PROXY_1=socks5://...`; comentários com `#`. Linha inválida é ignorada e só o número dela é devolvido. */
export function parseProxyEnv(text: string): ParsedProxyFile {
  const proxies: ProxySpec[] = [];
  const ignored: number[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/u).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?(PROXY_\d{1,3})\s*=\s*(.+)$/u.exec(line);
    const value = match?.[2]!.trim().replace(/^(["'])(.*)\1$/u, "$2");
    const spec = match && value ? parseProxyUrl(match[1]!, value) : null;
    if (!spec || seen.has(spec.name)) { ignored.push(index + 1); return; }
    seen.add(spec.name);
    proxies.push(spec);
  });
  proxies.sort((a, b) => Number(a.name.slice(6)) - Number(b.name.slice(6)));
  return { proxies, ignored };
}

type Connect = typeof tcpConnect;

function socksRequest(target: GateTarget): Buffer | null {
  const kind = isIP(target.host);
  const port = Buffer.alloc(2);
  port.writeUInt16BE(target.port);
  if (kind === 4) return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01]), Buffer.from(target.host.split(".").map(Number)), port]);
  if (kind === 6) return null;
  const name = Buffer.from(target.host, "latin1");
  if (name.length === 0 || name.length > 255) return null;
  return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, port]);
}

/** Uma conexão pelo proxy: `{ join }` com o site respondendo; `{ failed }` quando o proxy atendeu mas o site não abriu;
 * `{ gone }` quando o proxy nem atendeu, recusou o login ou não entendeu o pedido (a saída está fora para o robô). */
export function openThroughProxy(spec: ProxySpec, target: GateTarget, connect: Connect = tcpConnect): Promise<LinkOpened> {
  const socks = spec.scheme === "socks5" ? socksRequest(target) : null;
  if (spec.scheme === "socks5" && !socks) return Promise.resolve({ failed: "unreachable" });
  return new Promise((settle) => {
    let done = false;
    let stage: "greeting" | "auth" | "answer" = "greeting";
    let buffer = Buffer.alloc(0);
    const socket: Socket = connect({ host: spec.host, port: spec.port });
    const finish = (result: LinkOpened) => {
      if (done) return;
      done = true;
      clearTimeout(connectTimer);
      clearTimeout(answerTimer);
      socket.off("data", onData);
      settle(result);
    };
    const fail = (result: LinkOpened) => { socket.destroy(); finish(result); };
    const connectTimer = setTimeout(() => fail({ gone: true }), CONNECT_MS);
    const answerTimer = setTimeout(() => fail({ gone: true }), ANSWER_MS);
    const succeed = (rest: Buffer) => {
      socket.pause();
      finish({
        join: (client, early = []) => {
          for (const piece of early) socket.write(piece);
          if (rest.length) client.write(rest);
          socket.pipe(client);
          client.pipe(socket);
          socket.on("error", () => client.destroy());
          socket.on("close", () => client.destroy());
          client.on("close", () => socket.destroy());
          socket.resume();
        },
        cancel: () => socket.destroy(),
      });
    };
    const authed = spec.user !== undefined;
    const onSocks = (): void => {
      if (stage === "greeting") {
        if (buffer.length < 2) return;
        const method = buffer[1]!;
        if (buffer[0] !== 0x05 || (method !== 0x00 && !(method === 0x02 && authed))) return fail({ gone: true });
        buffer = buffer.subarray(2);
        if (method === 0x02) {
          const user = Buffer.from(spec.user ?? "", "utf8");
          const pass = Buffer.from(spec.pass ?? "", "utf8");
          stage = "auth";
          socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
        } else {
          stage = "answer";
          socket.write(socks!);
        }
      }
      if (stage === "auth") {
        if (buffer.length < 2) return;
        if (buffer[1] !== 0x00) return fail({ gone: true });
        buffer = buffer.subarray(2);
        stage = "answer";
        socket.write(socks!);
      }
      if (stage !== "answer" || buffer.length < 5) return;
      const type = buffer[3]!;
      const size = type === 0x01 ? 10 : type === 0x04 ? 22 : type === 0x03 ? 7 + buffer[4]! : -1;
      if (size < 0) return fail({ gone: true });
      if (buffer.length < size) return;
      const code = buffer[1]!;
      if (code === 0x00) return succeed(buffer.subarray(size));
      fail({ failed: code === 0x05 ? "refused" : "unreachable" });
    };
    const onHttp = (): void => {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) { if (buffer.length > 16_384) fail({ gone: true }); return; }
      const status = /^HTTP\/1\.[01] (\d{3})/u.exec(buffer.subarray(0, end).toString("latin1"));
      if (!status) return fail({ gone: true });
      const code = Number(status[1]);
      if (code >= 200 && code < 300) return succeed(buffer.subarray(end + 4));
      if (code === 407 || code === 401) return fail({ gone: true });
      fail({ failed: code === 403 || code === 502 ? "refused" : "unreachable" });
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (spec.scheme === "socks5") onSocks(); else onHttp();
    };
    socket.once("connect", () => {
      clearTimeout(connectTimer);
      if (spec.scheme === "socks5") {
        socket.write(authed ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
        return;
      }
      const authority = `${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`;
      const credentials = authed ? `Proxy-Authorization: Basic ${Buffer.from(`${spec.user}:${spec.pass ?? ""}`, "utf8").toString("base64")}\r\n` : "";
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${credentials}Proxy-Connection: keep-alive\r\n\r\n`);
    });
    socket.on("data", onData);
    socket.once("error", () => fail({ gone: true }));
    socket.once("close", () => finish({ gone: true }));
  });
}

export type ExitState = "online" | "offline" | "unknown";

/** Uma saída para os sites sensíveis: um proxy do pool ou o Mac de casa. Nada aqui carrega segredo. */
export interface Exit {
  /** "PROXY_1" ou "casa". */
  readonly name: string;
  readonly kind: "proxy" | "home";
  /** Texto sem segredo para log: "PROXY_1 host:porta". */
  readonly label: string;
  readonly upstream: GateUpstream;
  state(): ExitState;
  /** Falhou há pouco e ainda não voltou: o portão não espera por ela. */
  resting(): boolean;
  probe(): Promise<ExitState>;
}

export function createProxyExit(spec: ProxySpec, options: { connect?: Connect; now?: () => number; probeTarget?: GateTarget } = {}): Exit {
  const connect = options.connect ?? tcpConnect;
  const now = options.now ?? Date.now;
  const probeTarget = options.probeTarget ?? PROBE_TARGET;
  let state: ExitState = "unknown";
  let failedAt = -Infinity;
  const note = (opened: LinkOpened): LinkOpened => {
    if ("gone" in opened) { state = "offline"; failedAt = now(); } else { state = "online"; failedAt = -Infinity; }
    return opened;
  };
  return {
    name: spec.name,
    kind: "proxy",
    label: maskProxy(spec),
    upstream: { open: (target) => openThroughProxy(spec, target, connect).then(note) },
    state: () => state,
    resting: () => state === "offline" && now() - failedAt < RETRY_MS,
    probe: async () => {
      const opened = await openThroughProxy(spec, probeTarget, connect);
      if ("cancel" in opened) opened.cancel();
      note(opened);
      return state;
    },
  };
}

/** O arquivo de segredos como pool vivo: relido quando o arquivo muda (mtime) e a cada reconfiguração. Sem arquivo, vazio. */
export class ProxyPool {
  private readonly env: NodeJS.ProcessEnv;
  private readonly connect: Connect | undefined;
  private readonly now: () => number;
  private readonly probeTarget: GateTarget | undefined;
  private fileKey = "";
  private checkedAt = -Infinity;
  private list: Exit[] = [];
  private specs = new Map<string, string>();

  constructor(options: { env?: NodeJS.ProcessEnv; connect?: Connect; now?: () => number; probeTarget?: GateTarget } = {}) {
    this.env = options.env ?? process.env;
    this.connect = options.connect;
    this.now = options.now ?? Date.now;
    this.probeTarget = options.probeTarget;
  }

  file(): string { return this.env.NORDUS_PROXY_FILE?.trim() || DEFAULT_PROXY_FILE; }

  /** Relê na hora (reconfiguração) ou só se passaram alguns segundos desde a última conferência. */
  refresh(force = false): void {
    if (!force && this.now() - this.checkedAt < RELOAD_CHECK_MS) return;
    this.checkedAt = this.now();
    const file = this.file();
    let key = "";
    try { const stat = statSync(file); key = `${file}:${stat.mtimeMs}:${stat.size}`; } catch { key = ""; }
    if (key === this.fileKey) return;
    this.fileKey = key;
    if (!key) { this.list = []; this.specs.clear(); return; }
    let parsed: ParsedProxyFile;
    try { parsed = parseProxyEnv(readFileSync(file, "utf8")); } catch { return; }
    // Uma saída que não mudou fica como está, com o estado de saúde que já tem.
    const previous = new Map(this.list.map((exit) => [exit.name, exit]));
    const specs = new Map<string, string>();
    this.list = parsed.proxies.map((spec) => {
      const signature = `${spec.scheme}|${spec.host}|${spec.port}|${spec.user ?? ""}|${spec.pass ?? ""}`;
      specs.set(spec.name, signature);
      const old = previous.get(spec.name);
      if (old && this.specs.get(spec.name) === signature) return old;
      return createProxyExit(spec, { ...(this.connect ? { connect: this.connect } : {}), now: this.now, ...(this.probeTarget ? { probeTarget: this.probeTarget } : {}) });
    });
    this.specs = specs;
    if (parsed.ignored.length) console.warn(`[proxy-pool] ${parsed.ignored.length} linha(s) inválida(s) ignorada(s) em ${file} (linhas ${parsed.ignored.slice(0, 10).join(", ")})`);
  }

  exits(): readonly Exit[] { this.refresh(); return this.list; }
  get(name: string): Exit | undefined { return this.exits().find((exit) => exit.name === name); }
}
