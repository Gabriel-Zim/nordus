import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error: the home relay is plain JavaScript run with node on the Mac.
import { createCasaServer, listenAddress } from "../../../deploy/casa/socks-casa.mjs";
import { createHomeInternetRoute } from "./home-internet-route.ts";
import { createHomeLink, openThroughHome, parseHomeAddress } from "./home-link.ts";
import { cleanHomeSite, homeSiteMatcher } from "./home-sites.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

const listen = (server: Server) => new Promise<number>((done) => {
  servers.push(server);
  server.listen(0, "127.0.0.1", () => done((server.address() as AddressInfo).port));
});

/** A site that answers "oi:" plus whatever it gets. */
async function echoSite(): Promise<number> {
  return listen(createServer((socket) => socket.on("data", (chunk: Buffer) => socket.write(Buffer.concat([Buffer.from("oi:"), chunk])))));
}

/** The Mac's relay with a stand-in egress: "site.test:443" reaches the echo site, "192.168.1.1" is the home network. */
async function casa(sitePort: number, allowed = ["127.0.0.1"]): Promise<number> {
  const egress = {
    open: async ({ host, port }: { host: string; port: number }) => {
      if (host === "192.168.1.1") return { refused: "home-network" };
      if (port !== 443) return { refused: "port" };
      if (host === "fora.test") return { failed: "unreachable" };
      return new Promise((settle) => {
        const socket = connect({ host: "127.0.0.1", port: sitePort });
        socket.once("connect", () => settle({ socket }));
      });
    },
  };
  return listen(createCasaServer({ allowed: new Set(allowed), egress }));
}

const exchange = (socket: Socket, text: string) => new Promise<string>((done) => {
  socket.once("data", (chunk) => done(chunk.toString()));
  socket.write(text);
});

describe("o endereço da internet de casa", () => {
  it("aceita só IP de Tailscale com porta", () => {
    expect(parseHomeAddress("100.64.0.20:1080")).toEqual({ host: "100.64.0.20", port: 1080 });
    expect(parseHomeAddress("[fd7a:115c:a1e0::1]:1080")).toEqual({ host: "fd7a:115c:a1e0::1", port: 1080 });
    for (const bad of ["192.168.1.10:1080", "0.0.0.0:1080", "100.64.0.20", "100.200.1.1:1080", "casa:1080", "100.64.0.20:99999", ""]) {
      expect(parseHomeAddress(bad), bad).toBeNull();
    }
  });

  it("o relé do Mac também só escuta no IP de Tailscale", () => {
    expect(listenAddress("100.64.0.20:1080")).toEqual({ host: "100.64.0.20", port: 1080 });
    expect(listenAddress("0.0.0.0:1080")).toBeNull();
    expect(listenAddress("192.168.1.5:1080")).toBeNull();
  });
});

describe("a lista de sites que saem por casa", () => {
  it("cobre as redes sociais, o Google e seus subdomínios por padrão, e o resto sai direto", () => {
    const home = homeSiteMatcher(undefined);
    for (const host of ["www.instagram.com", "scontent.cdninstagram.com", "m.facebook.com", "accounts.google.com", "www.google.com.br",
      "www.youtube.com", "www.tiktok.com", "x.com", "pbs.twimg.com", "www.linkedin.com"]) expect(home(host), host).toBe(true);
    for (const host of ["en.wikipedia.org", "notinstagram.com", "instagram.com.evil.test", "ipinfo.io"]) expect(home(host), host).toBe(false);
  });

  it("a lista editada troca a padrão e aceita endereço colado", () => {
    expect(cleanHomeSite("https://www.Instagram.com/explore")).toBe("instagram.com");
    expect(cleanHomeSite("*.example.com")).toBe("example.com");
    expect(cleanHomeSite("não é site")).toBeNull();
    const home = homeSiteMatcher(["https://www.mercadolivre.com.br/", "lixo"]);
    expect(home("lista.mercadolivre.com.br")).toBe(true);
    expect(home("www.instagram.com"), "fora da lista editada").toBe(false);
    expect(home("www.google.de"), "o Google de cada país só vem com google.com na lista").toBe(false);
  });
});

describe("uma conexão pela casa", () => {
  it("chega ao site pelo relé do Mac e leva os bytes nos dois sentidos", async () => {
    const relay = await casa(await echoSite());
    const opened = await openThroughHome({ host: "127.0.0.1", port: relay }, { host: "site.test", port: 443 });
    expect("join" in opened).toBe(true);
    if (!("join" in opened)) return;
    const local = createServer();
    const port = await listen(local);
    const accepted = new Promise<Socket>((done) => local.once("connection", done));
    const browser = connect({ host: "127.0.0.1", port });
    opened.join(await accepted, [Buffer.from("antes ")]);
    expect(await exchange(browser, "depois")).toMatch(/^oi:antes (oi:)?/);
    browser.destroy();
  });

  it("traz a recusa do Mac (rede de casa, porta) e a falha do site sem cair para outra saída", async () => {
    const relay = await casa(await echoSite());
    const mac = { host: "127.0.0.1", port: relay };
    expect(await openThroughHome(mac, { host: "192.168.1.1", port: 443 })).toEqual({ refused: "home-network" });
    expect(await openThroughHome(mac, { host: "site.test", port: 22 })).toEqual({ refused: "home-network" });
    expect(await openThroughHome(mac, { host: "fora.test", port: 443 })).toEqual({ failed: "unreachable" });
  });

  it("o relé derruba quem não está na lista de permitidos", async () => {
    const relay = await casa(await echoSite(), ["100.64.0.10"]);
    expect(await openThroughHome({ host: "127.0.0.1", port: relay }, { host: "site.test", port: 443 })).toEqual({ gone: true });
  });

  it("com o Mac desligado responde gone, marca a casa como fora e descansa antes de chamar de novo", async () => {
    const closed = createServer();
    const port = await listen(closed);
    await new Promise<void>((done) => closed.close(() => done()));
    servers.splice(servers.indexOf(closed), 1);
    let now = 1_000;
    const link = createHomeLink({ host: "127.0.0.1", port }, { now: () => now });
    expect(link.state()).toBe("unknown");
    expect(await link.upstream.open({ host: "site.test", port: 443 })).toEqual({ gone: true });
    expect(link.state()).toBe("offline");
    expect(link.resting()).toBe(true);
    now += 31_000;
    expect(link.resting()).toBe(false);
    expect(await link.probe()).toBe("offline");
  });

  it("o teste de vida diz online quando o relé atende", async () => {
    const relay = await casa(await echoSite());
    const link = createHomeLink({ host: "127.0.0.1", port: relay });
    expect(await link.probe()).toBe("online");
    expect(link.resting()).toBe(false);
  });
});

describe("o selo da internet de casa", () => {
  const call = async (route: ReturnType<typeof createHomeInternetRoute>) => {
    let answer: unknown;
    await route({ res: {} as never, path: "/api/browser/home-internet", method: "GET", json: ((_res: unknown, _status: number, body: unknown) => { answer = body; }) as never } as never);
    return answer;
  };

  it("diz desligada quando não há casa configurada, e ligada ou desligada conforme o Mac responde", async () => {
    expect(await call(createHomeInternetRoute(() => null))).toEqual({ configured: false, state: "off" });
    const relay = await casa(await echoSite());
    expect(await call(createHomeInternetRoute(() => createHomeLink({ host: "127.0.0.1", port: relay })))).toEqual({ configured: true, state: "on" });
    const closed = createServer();
    const port = await listen(closed);
    await new Promise<void>((done) => closed.close(() => done()));
    servers.splice(servers.indexOf(closed), 1);
    expect(await call(createHomeInternetRoute(() => createHomeLink({ host: "127.0.0.1", port })))).toEqual({ configured: true, state: "off" });
  });
});
