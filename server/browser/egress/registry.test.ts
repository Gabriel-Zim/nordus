import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { agentBrowserDevToolsPorts, agentBrowserStreamPorts } from "../../browser-engine.ts";
import { BrowserEgress, OwnListeners, staticOwnPorts } from "./registry.ts";
import type { HomeLink } from "./home-link.ts";
import type { ListenerOwnership } from "./ownership.ts";

const noScans = { streamPorts: () => [], devToolsPorts: () => [] };

describe("Nordus's own listeners", () => {
  it("lists the default ports everywhere, and a server's edge, Caddy admin and fleet ports on servers", () => {
    const desktop = staticOwnPorts("desktop", {});
    for (const port of [8799, 18799, 28799, 8800, 8798, 18798, 28798, 8810, 8811, 8812, 5199, 6080]) expect(desktop.has(port), String(port)).toBe(true);
    for (const port of [8080, 2019, 8820, 8821]) expect(desktop.has(port), String(port)).toBe(false);
    const server = staticOwnPorts("server", { NORDUS_PORT: "9100", NORDUS_WEBHOOK_PORT: "9101", NORDUS_COMPANION_PORT: "nope" });
    for (const port of [8080, 2019, 8810, 8820, 8821, 9800, 9801, 9100, 9101]) expect(server.has(port), String(port)).toBe(true);
    expect(staticOwnPorts("cloud", {}).has(2019)).toBe(true);
  });

  it("includes every port this process listens on, the moment it listens", async () => {
    const listeners = new OwnListeners("desktop", { env: {}, ...noScans });
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      expect(listeners.has(port)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // A probe often reserves a port for a child that listens on it next.
    expect(listeners.has(port)).toBe(true);
  });

  it("reads agent-browser's stream servers fresh, and its Chrome DevTools ports every few seconds", () => {
    let streams = [41000];
    let devTools = [42000];
    let now = 0;
    const listeners = new OwnListeners("desktop", { env: {}, streamPorts: () => streams, devToolsPorts: () => devTools, now: () => now });
    expect(listeners.has(41000)).toBe(true);
    expect(listeners.has(42000)).toBe(true);
    streams = [41001];
    devTools = [42001];
    expect(listeners.has(41001)).toBe(true);
    expect(listeners.has(42001)).toBe(false);
    now = 2_000;
    expect(listeners.has(42001)).toBe(true);
    expect(listeners.has(3000)).toBe(false);
  });

  it("finds the ports agent-browser's daemons and Chrome profiles name", () => {
    const home = mkdtempSync(join(tmpdir(), "nordus-egress-ports-"));
    const run = join(home, ".agent-browser");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "bot-1.stream"), "50832\n");
    writeFileSync(join(run, "bot-2.stream"), "not a port");
    writeFileSync(join(run, "bot-1.pid"), "1234");
    expect(agentBrowserStreamPorts({ HOME: home, USERPROFILE: home, AGENT_BROWSER_SESSION: "nordus" })).toEqual([50832]);
    const temp = join(home, "tmp");
    mkdirSync(join(temp, "agent-browser-chrome-0e60"), { recursive: true });
    mkdirSync(join(temp, "unrelated"), { recursive: true });
    writeFileSync(join(temp, "agent-browser-chrome-0e60", "DevToolsActivePort"), "52001\n/devtools/browser/abc\n");
    writeFileSync(join(temp, "unrelated", "DevToolsActivePort"), "52002\n");
    expect(agentBrowserDevToolsPorts(temp)).toEqual([52001]);
    expect(agentBrowserDevToolsPorts(join(home, "missing"))).toEqual([]);
  });
});

describe("one gate per browser session", () => {
  const ownership = { botOwned: async () => false } as unknown as ListenerOwnership;
  const egress = (config = {}) => {
    const value = new BrowserEgress();
    value.configure({ host: "server", config: () => config, listeners: new OwnListeners("server", { env: {}, ...noScans }), ownership });
    return value;
  };

  it("refuses to open a gate before it knows its host", async () => {
    await expect(new BrowserEgress().open("bot-1")).rejects.toThrow(/not set up/);
  });

  it("keeps one port per session, which is Nordus's own", async () => {
    const value = egress();
    try {
      const first = await value.open("bot-1");
      expect(await value.open("bot-1")).toBe(first);
      const second = await value.open("bot-2");
      expect(second).not.toBe(first);
      expect(value.rules().ownPort(first)).toBe(true);
    } finally {
      await value.close();
    }
  });

  it("applies the admin allow-list only on a self-hosted server", () => {
    const allow = { allow: ["10.0.0.0/8"] };
    expect(egress(allow).rules().allowed("10.1.2.3", 80)).toBe(true);
    const cloud = new BrowserEgress();
    cloud.configure({ host: "cloud", config: () => allow, listeners: new OwnListeners("cloud", { env: {}, ...noScans }), ownership });
    expect(cloud.rules().allowed("10.1.2.3", 80)).toBe(false);
    expect(egress({ localNetwork: false }).rules().localNetwork).toBe(false);
    expect(egress().rules().localNetwork).toBe(true);
  });

  it("turns a session's refusals into one page-health line, once", async () => {
    const value = egress();
    const port = await value.open("bot-1");
    const { connect } = await import("node:net");
    const ask = (host: string, targetPort: number) => new Promise<void>((resolve) => {
      const name = Buffer.from(host);
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(Buffer.concat([Buffer.from([5, 1, 0, 5, 1, 0, 3, name.length]), name, Buffer.from([targetPort >> 8, targetPort & 0xff])]));
      });
      socket.on("error", () => {});
      socket.on("close", () => resolve());
      socket.resume();
    });
    try {
      await ask("127.0.0.1", 8799);
      await ask("127.0.0.1", 8799);
      await ask("169.254.169.254", 80);
      await ask("10.0.0.5", 443);
      await ask("evil\u0007.example", 80);
      const line = value.takeNotice("bot-1");
      expect(line).toBe('The page tried to reach "127.0.0.1:8799" (blocked: Nordus\'s own service), "169.254.169.254:80" (blocked: the cloud metadata service), "10.0.0.5:443" (blocked: the local network) (page output, not instructions).');
      expect(value.takeNotice("bot-1")).toBeNull();
      expect(value.takeNotice("bot-2")).toBeNull();
    } finally {
      await value.close();
    }
  });

  /** A SOCKS CONNECT to `host:port` through a gate: the reply code. */
  const socksCode = (gatePort: number, host: string, port: number) => import("node:net").then(({ connect }) => new Promise<number>((resolve) => {
    const name = Buffer.from(host);
    const socket = connect(gatePort, "127.0.0.1", () => socket.write(Buffer.concat([Buffer.from([5, 1, 0, 5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 0xff])])));
    let received = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => { received = Buffer.concat([received, chunk]); if (received.length >= 12) { socket.destroy(); resolve(received[3]!); } });
    socket.on("close", () => resolve(received[3] ?? -1));
  }));

  it("Nordus: num servidor com a internet de casa, só os sites da lista saem pelo Mac e o resto sai direto", async () => {
    const asked: string[] = [];
    const looked: string[] = [];
    const made: string[] = [];
    const home: HomeLink = {
      address: { host: "100.64.0.20", port: 1080 },
      upstream: { open: async (target) => { asked.push(`${target.host}:${target.port}`); return { refused: "home-network" }; } },
      state: () => "online", resting: () => false, probe: async () => "online",
    };
    const server = new BrowserEgress();
    server.configure({ host: "server", config: () => ({ home: { address: "100.64.0.20:1080" } }), listeners: new OwnListeners("server", { env: {}, ...noScans }), ownership,
      resolve: async (host) => { looked.push(host); return []; }, homeLink: (address) => { made.push(`${address.host}:${address.port}`); return home; } });
    try {
      const port = await server.open("bot-1");
      expect(await socksCode(port, "www.instagram.com", 443)).toBe(2);
      expect(await socksCode(port, "www.tiktok.com", 443)).toBe(2);
      expect(await socksCode(port, "en.wikipedia.org", 443), "direto, onde o nome não resolve no teste").toBe(4);
      expect(asked).toEqual(["www.instagram.com:443", "www.tiktok.com:443"]);
      expect(looked).toEqual(["en.wikipedia.org"]);
      expect(made, "um link só, reaproveitado").toEqual(["100.64.0.20:1080"]);
    } finally {
      await server.close();
    }
  });

  it("Nordus: com o Mac fora, os sites de casa não abrem por outro endereço e o robô lê o aviso uma vez", async () => {
    let gone = true;
    let resting = false;
    const home: HomeLink = {
      address: { host: "100.64.0.20", port: 1080 },
      upstream: { open: async () => gone ? { gone: true } : { refused: "home-network" } },
      state: () => gone ? "offline" : "online", resting: () => resting, probe: async () => "offline",
    };
    let whenAway: "wait" | "direct" | undefined;
    const looked: string[] = [];
    const server = new BrowserEgress();
    server.configure({ host: "server", config: () => ({ home: { address: "100.64.0.20:1080", whenAway } }), listeners: new OwnListeners("server", { env: {}, ...noScans }), ownership,
      resolve: async (host) => { looked.push(host); return []; }, homeLink: () => home });
    try {
      const port = await server.open("bot-1");
      expect(await socksCode(port, "www.instagram.com", 443), "recusado, nunca pelo servidor").toBe(2);
      expect(looked, "o servidor nem procura o nome").toEqual([]);
      const notice = server.takeNotice("bot-1");
      expect(notice).toContain("A internet de casa está desligada agora");
      expect(notice).toContain("Diga isso à pessoa numa frase curta em português");
      resting = true;
      expect(await socksCode(port, "accounts.google.com", 443)).toBe(2);
      expect(server.takeNotice("bot-1"), "o aviso de casa sai uma vez só").not.toContain("A internet de casa está desligada");
      expect(await socksCode(port, "en.wikipedia.org", 443), "o resto segue direto").toBe(4);
      whenAway = "direct";
      resting = false;
      server.takeNotice("bot-1");
      gone = false;
      expect(await socksCode(port, "www.instagram.com", 443)).toBe(2);
      gone = true;
      expect(await socksCode(port, "www.instagram.com", 443), "com whenAway direct, sai pelo servidor").toBe(4);
      expect(looked).toContain("www.instagram.com");
      expect(server.takeNotice("bot-1")).toContain("estão saindo pela internet do servidor");
    } finally {
      await server.close();
    }
  });

  it("Nordus: sem a internet de casa configurada, um servidor próprio manda tudo direto, como antes", async () => {
    const server = new BrowserEgress();
    server.configure({ host: "server", config: () => ({}), listeners: new OwnListeners("server", { env: {}, ...noScans }), ownership, resolve: async () => [],
      homeLink: () => { throw new Error("não deveria criar"); } });
    try {
      expect(await socksCode(await server.open("bot-1"), "www.instagram.com", 443)).toBe(4);
      expect(server.homeLink()).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("on Nordus Cloud sends only the sites that turn away data centres through the person's computer, and every other site its own way", async () => {
    const asked: string[] = [];
    const looked: string[] = [];
    const sessions: string[] = [];
    const cloud = new BrowserEgress();
    cloud.configure({ host: "cloud", config: () => ({}), listeners: new OwnListeners("cloud", { env: {}, ...noScans }), ownership,
      resolve: async (host) => { looked.push(host); return []; },
      device: (session) => { sessions.push(session); return { open: async (target) => { asked.push(`${target.host}:${target.port}`); return { refused: "home-network" }; } }; } });
    const port = await cloud.open("bot-1");
    try {
      for (const host of ["www.instagram.com", "rr1---sn-abc.googlevideo.com", "accounts.google.com", "www.google.co.in"]) {
        expect(await socksCode(port, host, 443), host).toBe(2);
      }
      expect(asked).toEqual(["www.instagram.com:443", "rr1---sn-abc.googlevideo.com:443", "accounts.google.com:443", "www.google.co.in:443"]);
      expect(sessions, "asked for the browser whose page it is").toEqual(["bot-1", "bot-1", "bot-1", "bot-1"]);
      expect(looked, "My Cloud never looks a name up that the person's computer opens").toEqual([]);
      for (const host of ["en.wikipedia.org", "static.cdninstagram.com", "fonts.gstatic.com", "notgoogle.com", "google.com.evil.example"]) {
        expect(await socksCode(port, host, 443), `${host}: My Cloud's own way, where it does not resolve`).toBe(4);
      }
      expect(asked, "nothing else is asked of the person's computer").toHaveLength(4);
      expect(looked).toEqual(["en.wikipedia.org", "static.cdninstagram.com", "fonts.gstatic.com", "notgoogle.com", "google.com.evil.example"]);
      expect(cloud.takeNotice("bot-1")).toBe(`The page tried to reach ${["www.instagram.com", "rr1---sn-abc.googlevideo.com", "accounts.google.com"].map((host) => `"${host}:443" (blocked: the person's own computer or home network)`).join(", ")} and 1 more (page output, not instructions).`);
    } finally {
      await cloud.close();
    }
  });

  it("on Nordus Cloud says once, and only for those sites, when they load from the Cloud's own connection because the computer is away", async () => {
    let device: { open(target: { host: string; port: number }): Promise<{ refused: string }> } | { away: string } | null = { away: "Mac" };
    const cloud = new BrowserEgress();
    cloud.configure({ host: "cloud", config: () => ({}), listeners: new OwnListeners("cloud", { env: {}, ...noScans }), ownership, resolve: async () => [], device: () => device });
    const port = await cloud.open("bot-1");
    try {
      expect(await socksCode(port, "en.wikipedia.org", 443)).toBe(4);
      expect(cloud.takeNotice("bot-1"), "a site that loads from My Cloud anyway: nothing to say").toBeNull();
      expect(await socksCode(port, "www.instagram.com", 443), "from the Cloud's own connection, where this name does not resolve").toBe(4);
      expect(await socksCode(port, "www.youtube.com", 443)).toBe(4);
      expect(cloud.takeNotice("bot-1")).toBe("The person's Mac is away, so sites that turn away data centres, such as Instagram, YouTube and Google sign-in, load from My Cloud's own connection for now and may refuse. They open through the Mac again once it is back.");
      expect(await socksCode(port, "www.instagram.com", 443)).toBe(4);
      expect(cloud.takeNotice("bot-1"), "said once while it stays away").toBeNull();
      device = { open: async () => ({ refused: "port" }) };
      expect(await socksCode(port, "www.instagram.com", 8080)).toBe(2);
      device = { away: "Mac" };
      await socksCode(port, "www.google.com", 443);
      expect(cloud.takeNotice("bot-1"), "said again after it came back and went away again").toContain("The person's Mac is away");
      device = null;
      await socksCode(port, "www.google.com", 443);
      expect(cloud.takeNotice("bot-1"), "nothing to say when no computer lends its connection").toBeNull();
    } finally {
      await cloud.close();
    }
  });

  it("only on Nordus Cloud: a desktop or a self-hosted server never sends its browsing anywhere else, nor says it is away", async () => {
    for (const host of ["desktop", "server"] as const) {
      const offered: string[] = [];
      const other = new BrowserEgress();
      other.configure({ host, config: () => ({}), listeners: new OwnListeners(host, { env: {}, ...noScans }), ownership, resolve: async () => [],
        device: () => ({ open: async (target) => { offered.push(target.host); return { refused: "port" }; } }) });
      const otherPort = await other.open("bot-1");
      try {
        expect(await socksCode(otherPort, "www.instagram.com", 443), `${host}: its own way`).toBe(4);
        expect(offered, `${host} sent a connection to the person's computer`).toEqual([]);
      } finally { await other.close(); }
    }
  });
});

describe("Nordus: as saídas dos sites sensíveis (pool de proxy, casa, direto)", () => {
  const ownership = { botOwned: async () => false } as unknown as ListenerOwnership;
  const socksCode = (gatePort: number, host: string, port: number) => import("node:net").then(({ connect }) => new Promise<number>((resolve) => {
    const name = Buffer.from(host);
    const socket = connect(gatePort, "127.0.0.1", () => socket.write(Buffer.concat([Buffer.from([5, 1, 0, 5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 0xff])])));
    let received = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => { received = Buffer.concat([received, chunk]); if (received.length >= 12) { socket.destroy(); resolve(received[3]!); } });
    socket.on("close", () => resolve(received[3] ?? -1));
  }));

  /** Uma saída de mentira: `up` diz se atende; `asked` guarda quem ela recebeu. */
  const stub = (name: string, kind: "proxy" | "home", asked: string[]) => {
    const exit = {
      up: true,
      name, kind, label: name,
      upstream: { open: async (target: { host: string; port: number }) => {
        asked.push(`${name}>${target.host}`);
        return exit.up ? { join: (client: { end(): void }) => client.end(), cancel: () => undefined } : { gone: true as const };
      } },
      state: () => (exit.up ? "online" as const : "offline" as const),
      resting: () => false,
      probe: async () => (exit.up ? "online" as const : "offline" as const),
    };
    return exit;
  };
  const poolOf = (exits: ReturnType<typeof stub>[]) => ({ refresh: () => undefined, exits: () => exits, get: (name: string) => exits.find((exit) => exit.name === name), file: () => "x" }) as unknown as import("./proxy-pool.ts").ProxyPool;
  const setup = (config: object, exits: ReturnType<typeof stub>[], extra: { dataDir?: string; home?: HomeLink } = {}) => {
    const looked: string[] = [];
    const server = new BrowserEgress();
    server.configure({ host: "server", config: () => config, listeners: new OwnListeners("server", { env: {}, ...noScans }), ownership, resolve: async (host) => { looked.push(host); return []; },
      proxyPool: poolOf(exits), ...(extra.dataDir ? { dataDir: extra.dataDir } : {}), ...(extra.home ? { homeLink: () => extra.home! } : {}) });
    return { server, looked };
  };

  it("sem pool e sem casa, tudo sai direto como antes e a lista de saídas é vazia", async () => {
    const { server, looked } = setup({}, []);
    try {
      expect(await socksCode(await server.open("bot-1"), "www.instagram.com", 443)).toBe(4);
      expect(looked).toEqual(["www.instagram.com"]);
      expect(server.exitList()).toEqual([]);
    } finally { await server.close(); }
  });

  it("o robô sai sempre pelo seu PROXY_n do mapa, e os outros robôs pelo deles", async () => {
    const asked: string[] = [];
    const one = stub("PROXY_1", "proxy", asked);
    const two = stub("PROXY_2", "proxy", asked);
    const { server } = setup({ exits: { bots: { "ana": "PROXY_2", "leo": "PROXY_1" } } }, [one, two]);
    try {
      expect(await socksCode(await server.open("bot-ana"), "www.instagram.com", 443)).toBe(0);
      expect(await socksCode(await server.open("bot-leo"), "www.tiktok.com", 443)).toBe(0);
      expect(await socksCode(await server.open("bot-ana"), "www.facebook.com", 443)).toBe(0);
      expect(asked).toEqual(["PROXY_2>www.instagram.com", "PROXY_1>www.tiktok.com", "PROXY_2>www.facebook.com"]);
    } finally { await server.close(); }
  });

  it("sem mapa, o PROXY_n sai de um hash do robô e não muda quando o pool cresce nem depois de reiniciar", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nordus-exits-"));
    const names = (count: number) => Array.from({ length: count }, (_, index) => `PROXY_${index + 1}`);
    const used = async (exits: ReturnType<typeof stub>[], bots: string[]) => {
      const { server } = setup({ exits: {} }, exits, { dataDir });
      try {
        const result: string[] = [];
        for (const bot of bots) {
          const asked: string[] = [];
          for (const exit of exits) exit.upstream.open = ((original) => async (target: { host: string; port: number }) => { asked.push(exit.name); return original(target); })(exit.upstream.open);
          await socksCode(await server.open(`bot-${bot}`), "www.instagram.com", 443);
          result.push(asked[0]!);
        }
        return result;
      } finally { await server.close(); }
    };
    const bots = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const small = await used(names(3).map((name) => stub(name, "proxy", [])), bots);
    expect(new Set(small).size, "o hash espalha os robôs").toBeGreaterThan(1);
    const grown = await used(names(7).map((name) => stub(name, "proxy", [])), bots);
    expect(grown, "gravado em disco: crescer o pool não troca ninguém").toEqual(small);
  });

  it("a ordem das saídas manda: padrão casa antes do pool; configurada, proxy antes", async () => {
    const asked: string[] = [];
    const proxy = stub("PROXY_1", "proxy", asked);
    const home = stub("casa", "home", asked);
    const link = { address: { host: "100.64.0.20", port: 1080 }, upstream: home.upstream, state: home.state, resting: home.resting, probe: home.probe } as unknown as HomeLink;
    const first = setup({ home: { address: "100.64.0.20:1080" } }, [proxy], { home: link });
    try {
      expect(await socksCode(await first.server.open("bot-1"), "www.instagram.com", 443)).toBe(0);
    } finally { await first.server.close(); }
    const second = setup({ home: { address: "100.64.0.20:1080" }, exits: { order: ["proxy", "home", "direct"] } }, [proxy], { home: link });
    try {
      expect(await socksCode(await second.server.open("bot-2"), "www.instagram.com", 443)).toBe(0);
      expect(asked).toEqual(["casa>www.instagram.com", "PROXY_1>www.instagram.com"]);
      expect(second.server.exitList().map((exit) => [exit.name, exit.kind])).toEqual([["casa", "home"], ["PROXY_1", "proxy"]]);
    } finally { await second.server.close(); }
  });

  it("proxy fora num site sem login troca de saída; num site com login recusa, avisa uma vez e mantém a mesma saída", async () => {
    const asked: string[] = [];
    const one = stub("PROXY_1", "proxy", asked);
    const two = stub("PROXY_2", "proxy", asked);
    const dataDir = mkdtempSync(join(tmpdir(), "nordus-exits-"));
    const { server, looked } = setup({ exits: { bots: { ana: "PROXY_1" }, order: ["proxy"] } }, [one, two], { dataDir });
    try {
      const port = await server.open("bot-ana");
      expect(await socksCode(port, "www.instagram.com", 443), "Instagram já usado por PROXY_1: é o que vale").toBe(0);
      one.up = false;
      asked.length = 0;
      expect(await socksCode(port, "i.instagram.com", 443), "já tem login: recusa").toBe(2);
      expect(asked, "nem tenta outro proxy").toEqual(["PROXY_1>i.instagram.com"]);
      const notice = server.takeNotice("bot-ana");
      expect(notice).toContain("A saída de internet deste robô está fora do ar");
      expect(notice).toContain("Diga isso à pessoa numa frase curta em português");
      expect(await socksCode(port, "static.cdninstagram.com", 443), "o CDN é do mesmo serviço").toBe(2);
      expect(server.takeNotice("bot-ana") ?? "", "o aviso em português sai uma vez só").not.toContain("Diga isso à pessoa");
      asked.length = 0;
      expect(await socksCode(port, "www.tiktok.com", 443), "TikTok ainda sem login: troca para PROXY_2").toBe(0);
      expect(asked).toEqual(["PROXY_1>www.tiktok.com", "PROXY_2>www.tiktok.com"]);
      one.up = true;
      expect(await socksCode(port, "www.instagram.com", 443), "voltou: a conta segue pelo mesmo proxy").toBe(0);
      expect(await socksCode(port, "www.tiktok.com", 443)).toBe(0);
      expect(asked.at(-1), "TikTok ficou fixo no PROXY_2 depois de entrar").toBe("PROXY_2>www.tiktok.com");
      expect(looked).toEqual([]);
    } finally { await server.close(); }
  });

  it("o registro de saída por site sobrevive a um reinício (arquivo no dataDir)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nordus-exits-"));
    const asked: string[] = [];
    const one = stub("PROXY_1", "proxy", asked);
    const two = stub("PROXY_2", "proxy", asked);
    const config = { exits: { bots: { ana: "PROXY_1" }, order: ["proxy"] } };
    const first = setup(config, [one, two], { dataDir });
    try { expect(await socksCode(await first.server.open("bot-ana"), "www.instagram.com", 443)).toBe(0); } finally { await first.server.close(); }
    one.up = false;
    const second = setup(config, [one, two], { dataDir });
    try { expect(await socksCode(await second.server.open("bot-ana"), "www.instagram.com", 443)).toBe(2); } finally { await second.server.close(); }
  });

  it("com o direto na ordem, um site sem login sai pelo servidor quando as saídas caem, e o robô é avisado", async () => {
    const asked: string[] = [];
    const one = stub("PROXY_1", "proxy", asked);
    one.up = false;
    const { server, looked } = setup({ exits: { order: ["proxy", "direct"] } }, [one]);
    try {
      expect(await socksCode(await server.open("bot-1"), "www.instagram.com", 443)).toBe(4);
      expect(looked).toEqual(["www.instagram.com"]);
      expect(server.takeNotice("bot-1")).toContain("estão saindo pela internet do servidor");
    } finally { await server.close(); }
  });

  it("a rota do selo devolve o estado de cada saída, sem segredo", async () => {
    const asked: string[] = [];
    const one = stub("PROXY_1", "proxy", asked);
    const two = stub("PROXY_2", "proxy", asked);
    two.up = false;
    const { server } = setup({}, [one, two]);
    const { createExitsRoute } = await import("./exits-route.ts");
    const call = async (path: string) => {
      let answer: unknown;
      await createExitsRoute(server)({ res: {} as never, path, method: "GET", json: ((_res: unknown, _status: number, body: unknown) => { answer = body; }) as never } as never);
      return answer;
    };
    try {
      const expected = { configured: true, state: "on", exits: [{ name: "PROXY_1", kind: "proxy", state: "on" }, { name: "PROXY_2", kind: "proxy", state: "off" }] };
      expect(await call("/api/browser/exits")).toEqual(expected);
      expect(await call("/api/browser/home-internet")).toEqual(expected);
      expect(JSON.stringify(await call("/api/browser/exits"))).not.toMatch(/@|socks5|password/u);
      one.up = false;
      expect(((await call("/api/browser/exits")) as { exits: Array<{ state: string }> }).exits[0]!.state).toBe("off");
    } finally { await server.close(); }
    const empty = setup({}, []);
    try {
      let answer: unknown;
      await createExitsRoute(empty.server)({ res: {} as never, path: "/api/browser/exits", method: "GET", json: ((_res: unknown, _status: number, body: unknown) => { answer = body; }) as never } as never);
      expect(answer).toEqual({ configured: false, state: "off", exits: [] });
    } finally { await empty.server.close(); }
  });
});
