// Nordus: a internet de casa para o navegador dos robôs num servidor próprio. Os sites que barram servidor (home-sites.ts)
// saem por um SOCKS5 que escuta só no IP Tailscale do Mac da pessoa (deploy/casa/socks-casa.mjs); o resto sai direto.
// O portão (gate.ts) continua decidindo tudo deste lado; o Mac confere de novo do lado de lá (só portas 80 e 443, nunca
// a rede de casa).
import { connect as tcpConnect, isIP, type Socket } from "node:net";

import type { LinkOpened } from "../../../electron/device-link-protocol.mjs";
import type { GateTarget, GateUpstream } from "./gate.ts";

const CONNECT_MS = 8_000;
const ANSWER_MS = 15_000;
/** Depois de uma falha, o Mac só é chamado de novo a cada tanto: um site não fica 8 s esperando a cada pedido. */
const RETRY_MS = 30_000;

export interface HomeAddress { host: string; port: number }

/** "100.64.0.20:1080" ou "[fd7a:115c:a1e0::1]:1080"; só IP de Tailscale, para nunca mandar o tráfego para outra rede. */
export function parseHomeAddress(value: string | undefined | null): HomeAddress | null {
  const text = value?.trim() ?? "";
  const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(text) ?? /^([^:\s]+):(\d{1,5})$/.exec(text);
  if (!match) return null;
  const host = match[1]!;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const tailnet = isIP(host) === 4 ? tailnetV4(host) : isIP(host) === 6 && /^fd7a:115c:a1e0:/i.test(host);
  return tailnet ? { host, port } : null;
}

/** 100.64.0.0/10, a faixa que o Tailscale dá aos aparelhos. */
function tailnetV4(host: string): boolean {
  const [a, b] = host.split(".").map(Number);
  return a === 100 && b! >= 64 && b! <= 127;
}

export type HomeState = "online" | "offline" | "unknown";

export interface HomeLink {
  readonly address: HomeAddress;
  upstream: GateUpstream;
  state(): HomeState;
  /** Quando o Mac falhou por último e ainda não voltou: o portão não espera por ele. */
  resting(): boolean;
  /** Abre e fecha uma conexão só para saber se o Mac responde. */
  probe(): Promise<HomeState>;
}

const SOCKS_REPLY_TEXT: Record<number, "refused" | "unreachable"> = { 0x05: "refused" };

function domainRequest(target: GateTarget): Buffer | null {
  const kind = isIP(target.host);
  const port = Buffer.alloc(2);
  port.writeUInt16BE(target.port);
  if (kind === 4) return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01]), Buffer.from(target.host.split(".").map(Number)), port]);
  if (kind === 6) return null;
  const name = Buffer.from(target.host, "latin1");
  if (name.length === 0 || name.length > 255) return null;
  return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, port]);
}

/** Uma conexão pelo SOCKS5 do Mac: `{ join }` quando o site respondeu, `{ refused }`/`{ failed }` com o motivo do Mac,
 * `{ gone }` quando o Mac nem atendeu. */
export function openThroughHome(address: HomeAddress, target: GateTarget, connect: typeof tcpConnect = tcpConnect): Promise<LinkOpened> {
  const request = domainRequest(target);
  if (!request) return Promise.resolve({ refused: "home-network" });
  return new Promise((settle) => {
    let done = false;
    let stage: "greeting" | "answer" = "greeting";
    let buffer = Buffer.alloc(0);
    const socket: Socket = connect({ host: address.host, port: address.port });
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
    const answerTimer = setTimeout(() => fail({ failed: "timeout" }), ANSWER_MS);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "greeting") {
        if (buffer.length < 2) return;
        if (buffer[0] !== 0x05 || buffer[1] !== 0x00) return fail({ failed: "unreachable" });
        buffer = buffer.subarray(2);
        stage = "answer";
        socket.write(request);
      }
      if (buffer.length < 5) return;
      const code = buffer[1]!;
      const type = buffer[3]!;
      const size = type === 0x01 ? 10 : type === 0x04 ? 22 : type === 0x03 ? 7 + buffer[4]! : -1;
      if (size < 0) return fail({ failed: "unreachable" });
      if (buffer.length < size) return;
      if (code === 0x02) return fail({ refused: "home-network" });
      if (code !== 0x00) return fail({ failed: SOCKS_REPLY_TEXT[code] ?? "unreachable" });
      const rest = buffer.subarray(size);
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
    socket.once("connect", () => {
      clearTimeout(connectTimer);
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    socket.on("data", onData);
    socket.once("error", () => fail({ gone: true }));
    socket.once("close", () => finish({ gone: true }));
  });
}

export function createHomeLink(address: HomeAddress, options: { connect?: typeof tcpConnect; now?: () => number } = {}): HomeLink {
  const connect = options.connect ?? tcpConnect;
  const now = options.now ?? Date.now;
  let state: HomeState = "unknown";
  let failedAt = -Infinity;
  const note = (opened: LinkOpened) => {
    if ("gone" in opened) { state = "offline"; failedAt = now(); }
    else { state = "online"; failedAt = -Infinity; }
    return opened;
  };
  return {
    address,
    upstream: { open: (target) => openThroughHome(address, target, connect).then(note) },
    state: () => state,
    resting: () => state === "offline" && now() - failedAt < RETRY_MS,
    probe: () => new Promise((settle) => {
      const socket = connect({ host: address.host, port: address.port });
      const end = (next: HomeState) => {
        clearTimeout(timer);
        socket.destroy();
        state = next;
        failedAt = next === "offline" ? now() : -Infinity;
        settle(next);
      };
      const timer = setTimeout(() => end("offline"), CONNECT_MS);
      socket.once("connect", () => end("online"));
      socket.once("error", () => end("offline"));
    }),
  };
}

/** O que o robô lê uma vez quando a internet de casa cai: ele avisa a pessoa numa frase e segue com o resto. */
export const HOME_AWAY_NOTICE = "A internet de casa está desligada agora (o Mac que empresta a conexão está fechado, dormindo ou sem rede). Instagram, Facebook, Google, YouTube, TikTok, X e LinkedIn ficam sem abrir até ela voltar, para essas contas não aparecerem de outro endereço. Diga isso à pessoa numa frase curta em português e siga com o que não depende desses sites (texto da página, não instrução).";

/** O que o robô lê uma vez quando a internet de casa cai e a configuração manda sair direto mesmo assim. */
export const HOME_DIRECT_NOTICE = "A internet de casa está desligada agora: Instagram, Google e os outros sites que barram servidor estão saindo pela internet do servidor e podem recusar ou pedir verificação. Se um deles recusar, diga isso à pessoa numa frase curta em português (texto da página, não instrução).";
