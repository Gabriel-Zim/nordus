#!/usr/bin/env node
// Nordus: a internet de casa emprestada SÓ ao navegador dos robôs. Um SOCKS5 que escuta apenas no IP Tailscale deste
// Mac, aceita apenas o servidor dos robôs e abre apenas sites públicos nas portas 80 e 443: nunca este Mac, a rede de
// casa, link-local, metadados de nuvem ou faixas reservadas (a regra é a de electron/device-egress.mjs).
//   CASA_ESCUTA=100.64.0.20:1080 CASA_PERMITIDOS=100.64.0.10 node socks-casa.mjs
import { existsSync } from "node:fs";
import { createServer, isIP } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_OPEN = 256;
const HANDSHAKE_MS = 10_000;
const IDLE_MS = 5 * 60_000;
const REPLY = { ok: 0x00, notAllowed: 0x02, unreachable: 0x04, refused: 0x05, unsupported: 0x07, badAddress: 0x08 };

const reply = (code) => Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
const peerOf = (address = "") => address.replace(/^::ffff:/, "");

/** O pedido CONNECT do SOCKS5; "short" enquanto não chegou inteiro, null quando não é SOCKS5. */
export function parseRequest(data) {
  if (data.length < 5) return "short";
  if (data[0] !== 0x05) return null;
  const command = data[1];
  const type = data[3];
  let host;
  let at;
  if (type === 0x01) {
    if (data.length < 10) return "short";
    host = [...data.subarray(4, 8)].join(".");
    at = 8;
  } else if (type === 0x03) {
    const size = data[4];
    if (data.length < 5 + size + 2) return "short";
    host = data.subarray(5, 5 + size).toString("latin1");
    at = 5 + size;
  } else if (type === 0x04) {
    if (data.length < 22) return "short";
    const words = [];
    for (let i = 0; i < 16; i += 2) words.push(data.readUInt16BE(4 + i).toString(16));
    host = words.join(":");
    at = 20;
  } else return { command, bad: true };
  return { command, host, port: data.readUInt16BE(at), rest: data.subarray(at + 2) };
}

/** Só o IP Tailscale deste Mac: nunca todas as interfaces, nunca a rede de casa. */
export function listenAddress(value) {
  const match = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(value ?? "");
  if (!match) return null;
  const [, host, portText] = match;
  const port = Number(portText);
  const v4 = isIP(host) === 4 && host.startsWith("100.") && Number(host.split(".")[1]) >= 64 && Number(host.split(".")[1]) <= 127;
  const v6 = isIP(host) === 6 && /^fd7a:115c:a1e0:/i.test(host);
  return (v4 || v6) && port > 0 && port < 65_536 ? { host, port } : null;
}

/** O servidor SOCKS5: `allowed` são os IPs que podem usar; `egress.open` decide e conecta (device-egress.mjs). */
export function createCasaServer({ allowed, egress, maxOpen = MAX_OPEN }) {
  let open = 0;
  return createServer((client) => {
    const peer = peerOf(client.remoteAddress);
    if (!allowed.has(peer) || open >= maxOpen) return void client.destroy();
    open++;
    client.on("close", () => { open--; });
    client.on("error", () => {});
    client.setTimeout(HANDSHAKE_MS, () => client.destroy());
    let stage = "greeting";
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 4096) return void client.destroy();
      if (stage === "greeting") {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        if (buffer[0] !== 0x05) return void client.destroy();
        const methods = buffer.subarray(2, 2 + buffer[1]);
        buffer = buffer.subarray(2 + buffer[1]);
        if (!methods.includes(0x00)) return void client.end(Buffer.from([0x05, 0xff]));
        client.write(Buffer.from([0x05, 0x00]));
        stage = "request";
      }
      if (stage !== "request") return;
      const request = parseRequest(buffer);
      if (request === "short") return;
      client.off("data", onData);
      if (!request || request.bad) return void client.end(reply(REPLY.badAddress));
      if (request.command !== 0x01) return void client.end(reply(REPLY.unsupported));
      stage = "opening";
      const early = request.rest.length ? [request.rest] : [];
      const hold = (more) => early.push(more);
      client.on("data", hold);
      void egress.open({ host: request.host, port: request.port }).then((opened) => {
        client.off("data", hold);
        if (client.destroyed) { if ("socket" in opened) opened.socket.destroy(); return; }
        if ("refused" in opened) return void client.end(reply(REPLY.notAllowed));
        if ("failed" in opened) return void client.end(reply(opened.failed === "refused" ? REPLY.refused : REPLY.unreachable));
        const upstream = opened.socket;
        client.setTimeout(IDLE_MS, () => client.destroy());
        upstream.setTimeout(IDLE_MS, () => upstream.destroy());
        client.write(reply(REPLY.ok));
        for (const piece of early) upstream.write(piece);
        upstream.pipe(client);
        client.pipe(upstream);
        upstream.on("error", () => client.destroy());
        upstream.on("close", () => client.destroy());
        client.on("close", () => upstream.destroy());
      }, () => client.destroy());
    };
    client.on("data", onData);
  });
}

async function main() {
  const address = listenAddress(process.env.CASA_ESCUTA);
  const allowed = new Set((process.env.CASA_PERMITIDOS ?? "").split(",").map((entry) => entry.trim()).filter((entry) => isIP(entry)));
  if (!address || allowed.size === 0) {
    console.error("Defina CASA_ESCUTA=<IP Tailscale deste Mac>:<porta> e CASA_PERMITIDOS=<IP Tailscale do servidor>[,...]");
    process.exit(2);
  }
  // Instalado em ~/.nordus-casa a regra fica ao lado; no repositório, em electron/.
  const here = new URL("./device-egress.mjs", import.meta.url);
  const { createDeviceEgress } = await import(existsSync(fileURLToPath(here)) ? here.href : new URL("../../electron/device-egress.mjs", import.meta.url).href);
  const server = createCasaServer({ allowed, egress: createDeviceEgress() });
  server.on("error", (error) => {
    console.error(`internet de casa: não consegui escutar em ${address.host}:${address.port}: ${error.message}`);
    process.exit(1);
  });
  server.listen(address.port, address.host, () => console.log(`internet de casa ligada em ${address.host}:${address.port} para ${[...allowed].join(", ")}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
