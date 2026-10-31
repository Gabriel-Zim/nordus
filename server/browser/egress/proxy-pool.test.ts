import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createProxyExit, maskProxy, openThroughProxy, parseProxyEnv, parseProxyUrl, ProxyPool, type ProxySpec } from "./proxy-pool.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => { server.close(() => done()); (server as { closeAllConnections?: () => void }).closeAllConnections?.(); })));
});

const listen = (server: Server) => new Promise<number>((resolve) => {
  servers.push(server);
  server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
});

const echo = (socket: Socket) => { socket.on("error", () => {}); socket.on("data", (chunk) => socket.write(chunk)); };

/** Um SOCKS5 falso. Com `login`, só aceita o método 2 (RFC 1929) e confere usuário e senha. */
async function fakeSocks(login?: { user: string; pass: string }, seen: string[] = []) {
  return listen(createServer((socket) => {
    socket.on("error", () => {});
    let stage = 0;
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0 && buf.length >= 2 + buf[1]!) {
        const methods = [...buf.subarray(2, 2 + buf[1]!)];
        buf = buf.subarray(2 + buf[1]!);
        if (login && methods.includes(2)) { stage = 1; socket.write(Buffer.from([5, 2])); }
        else if (!login && methods.includes(0)) { stage = 2; socket.write(Buffer.from([5, 0])); }
        else { socket.end(Buffer.from([5, 0xff])); return; }
      }
      if (stage === 1 && buf.length >= 2 && buf.length >= 3 + buf[1]! + buf[2 + buf[1]!]!) {
        const ulen = buf[1]!;
        const user = buf.subarray(2, 2 + ulen).toString();
        const plen = buf[2 + ulen]!;
        const pass = buf.subarray(3 + ulen, 3 + ulen + plen).toString();
        buf = buf.subarray(3 + ulen + plen);
        const ok = user === login!.user && pass === login!.pass;
        socket.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) { socket.end(); return; }
        stage = 2;
      }
      if (stage === 2 && buf.length >= 5) {
        const len = buf[4]!;
        if (buf.length < 7 + len) return;
        seen.push(buf.subarray(5, 5 + len).toString());
        socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        stage = 3;
        socket.removeAllListeners("data");
        echo(socket);
      }
    });
  }));
}

/** Um proxy HTTP falso que responde ao CONNECT com `status` quando o Proxy-Authorization confere. */
async function fakeHttp(auth: string | null, status = 200, seen: string[] = []) {
  return listen(createServer((socket) => {
    socket.on("error", () => {});
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      if (!buf.includes("\r\n\r\n")) return;
      seen.push(buf.split("\r\n")[0]!);
      const given = /Proxy-Authorization: (.*)\r\n/u.exec(buf)?.[1] ?? null;
      socket.removeAllListeners("data");
      if (auth !== null && given !== auth) { socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"); return; }
      socket.write(`HTTP/1.1 ${status} X\r\n\r\n`);
      if (status === 200) echo(socket);
      else socket.end();
    });
  }));
}

const ask = (opened: Awaited<ReturnType<typeof openThroughProxy>>, text: string) => new Promise<string>((resolve, reject) => {
  if (!("join" in opened)) return reject(new Error(`não abriu: ${JSON.stringify(opened)}`));
  const pair = createServer((client) => { opened.join(client); });
  servers.push(pair);
  pair.listen(0, "127.0.0.1", async () => {
    const { connect } = await import("node:net");
    const socket = connect((pair.address() as { port: number }).port, "127.0.0.1", () => socket.write(text));
    socket.once("data", (chunk) => { socket.destroy(); resolve(chunk.toString()); });
    socket.on("error", reject);
  });
});

const spec = (port: number, extra: Partial<ProxySpec> = {}): ProxySpec => ({ name: "PROXY_1", scheme: "socks5", host: "127.0.0.1", port, ...extra });

describe("o arquivo de segredos do pool", () => {
  it("lê socks5 e http, com e sem usuário e senha, e ignora comentário e linha inválida", () => {
    const parsed = parseProxyEnv([
      "# proxies residenciais",
      "PROXY_2=http://leo:s%40nha@br2.example.com:3128",
      "",
      "PROXY_1=socks5://ana:segredo@br1.example.com:1080",
      "PROXY_3=socks5://sem-login.example.com:1080",
      "PROXY_4=ftp://x.example.com:21",
      "PROXY_5=socks5://sem-porta.example.com",
      "OUTRA=socks5://a:b@x.example.com:1",
      "PROXY_1=socks5://repetido:x@y.example.com:9",
      "PROXY_6 socks5://sem-igual:1",
    ].join("\n"));
    expect(parsed.proxies.map((proxy) => proxy.name)).toEqual(["PROXY_1", "PROXY_2", "PROXY_3"]);
    expect(parsed.proxies[0]).toMatchObject({ scheme: "socks5", host: "br1.example.com", port: 1080, user: "ana", pass: "segredo" });
    expect(parsed.proxies[1]).toMatchObject({ scheme: "http", port: 3128, user: "leo", pass: "s@nha" });
    expect(parsed.proxies[2]!.user).toBeUndefined();
    expect(parsed.ignored).toEqual([6, 7, 8, 9, 10]);
  });

  it("aceita IPv6 entre colchetes e aspas em volta do valor", () => {
    expect(parseProxyUrl("PROXY_1", "socks5://u:p@[2001:db8::1]:1080")).toMatchObject({ host: "2001:db8::1", port: 1080 });
    expect(parseProxyEnv('PROXY_1="http://u:p@a.example.com:80"').proxies).toHaveLength(1);
  });

  it("mascara: só o nome e host:porta, nunca usuário nem senha", () => {
    const [proxy] = parseProxyEnv("PROXY_1=socks5://ana:segredo@br1.example.com:1080").proxies;
    expect(maskProxy(proxy!)).toBe("PROXY_1 br1.example.com:1080");
    const exit = createProxyExit(proxy!);
    expect(JSON.stringify({ ...exit, state: exit.state() })).not.toMatch(/ana|segredo/u);
    expect(exit.label).toBe("PROXY_1 br1.example.com:1080");
  });

  it("sem arquivo o pool fica vazio; relê quando o arquivo muda e preserva a saída que não mudou", () => {
    const dir = mkdtempSync(join(tmpdir(), "nordus-pool-"));
    const file = join(dir, "proxy.env");
    let now = 0;
    const pool = new ProxyPool({ env: { NORDUS_PROXY_FILE: file }, now: () => now });
    expect(pool.exits()).toEqual([]);
    writeFileSync(file, "PROXY_1=socks5://a:b@h1.example.com:1080\n");
    pool.refresh(true);
    const first = pool.exits()[0]!;
    expect(pool.exits().map((exit) => exit.name)).toEqual(["PROXY_1"]);
    writeFileSync(file, "PROXY_1=socks5://a:b@h1.example.com:1080\nPROXY_2=http://h2.example.com:3128\n");
    utimesSync(file, new Date(5_000_000), new Date(5_000_000));
    expect(pool.exits().length, "ainda não passou o intervalo de conferência").toBe(1);
    now += 6_000;
    expect(pool.exits().map((exit) => exit.name)).toEqual(["PROXY_1", "PROXY_2"]);
    expect(pool.exits()[0], "mesma saída, mesmo estado de saúde").toBe(first);
    writeFileSync(file, "PROXY_1=socks5://a:outra@h1.example.com:1080\n");
    utimesSync(file, new Date(6_000_000), new Date(6_000_000));
    pool.refresh(true);
    expect(pool.exits()[0]).not.toBe(first);
  });
});

describe("abrir pelo proxy", () => {
  it("SOCKS5 com usuário e senha: conecta e passa os bytes", async () => {
    const seen: string[] = [];
    const port = await fakeSocks({ user: "ana", pass: "segredo" }, seen);
    const opened = await openThroughProxy(spec(port, { user: "ana", pass: "segredo" }), { host: "site.test", port: 443 });
    expect(await ask(opened, "oi")).toBe("oi");
    expect(seen).toEqual(["site.test"]);
  });

  it("SOCKS5 com senha errada vira gone (a saída está fora para o robô)", async () => {
    const port = await fakeSocks({ user: "ana", pass: "segredo" });
    expect(await openThroughProxy(spec(port, { user: "ana", pass: "errada" }), { host: "site.test", port: 443 })).toEqual({ gone: true });
  });

  it("SOCKS5 sem autenticação também abre", async () => {
    const port = await fakeSocks();
    expect(await ask(await openThroughProxy(spec(port), { host: "site.test", port: 80 }), "x")).toBe("x");
  });

  it("HTTP CONNECT com Proxy-Authorization Basic", async () => {
    const seen: string[] = [];
    const port = await fakeHttp(`Basic ${Buffer.from("leo:s@nha").toString("base64")}`, 200, seen);
    const proxy = spec(port, { scheme: "http", user: "leo", pass: "s@nha" });
    expect(await ask(await openThroughProxy(proxy, { host: "site.test", port: 443 }), "ola")).toBe("ola");
    expect(seen).toEqual(["CONNECT site.test:443 HTTP/1.1"]);
    expect(await openThroughProxy({ ...proxy, pass: "errada" }, { host: "site.test", port: 443 })).toEqual({ gone: true });
  });

  it("HTTP CONNECT: o proxy no ar mas o site recusado é failed, não gone", async () => {
    const port = await fakeHttp(null, 502);
    expect(await openThroughProxy(spec(port, { scheme: "http" }), { host: "site.test", port: 443 })).toEqual({ failed: "refused" });
  });

  it("proxy desligado é gone", async () => {
    const closed = createServer();
    const port = await listen(closed);
    await new Promise<void>((done) => closed.close(() => done()));
    expect(await openThroughProxy(spec(port), { host: "site.test", port: 443 })).toEqual({ gone: true });
  });
});

describe("a saúde de cada saída", () => {
  it("o teste de vida diz online com o proxy atendendo, offline quando cai, e descansa antes de tentar de novo", async () => {
    const port = await fakeSocks({ user: "a", pass: "b" });
    let now = 1_000;
    const exit = createProxyExit(spec(port, { user: "a", pass: "b" }), { now: () => now, probeTarget: { host: "site.test", port: 443 } });
    expect(exit.state()).toBe("unknown");
    expect(await exit.probe()).toBe("online");
    const dead = createProxyExit(spec(1, { user: "a", pass: "b" }), { now: () => now, probeTarget: { host: "site.test", port: 443 } });
    expect(await dead.probe()).toBe("offline");
    expect(dead.resting()).toBe(true);
    now += 31_000;
    expect(dead.resting()).toBe(false);
  });
});
