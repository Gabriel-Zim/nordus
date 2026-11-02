import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./env";
import { route } from "./index";
import { nameProblem, suggestName } from "./names";

const ORIGIN = "https://conta.nordus.ai";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, dir), "utf8"));
  const bind = (values: unknown[]) => values.map((value) => (value === undefined ? null : value) as SQLInputValue);
  const prepared = (sql: string, values: unknown[] = []): any => ({
    sql,
    values,
    bind: (...next: unknown[]) => prepared(sql, next),
    first: async () => {
      const row = db.prepare(sql).get(...bind(values));
      return row ? { ...row } : null;
    },
    all: async () => ({ results: db.prepare(sql).all(...bind(values)).map((row) => ({ ...row })) }),
    run: async () => {
      const statement = db.prepare(sql);
      if (statement.columns().length) return { results: statement.all(...bind(values)) };
      return { meta: { changes: Number(statement.run(...bind(values)).changes) } };
    },
  });
  return {
    db,
    D1: { prepare: (sql: string) => prepared(sql), batch: async (list: any[]) => Promise.all(list.map((s) => s.run())) } as unknown as D1Database,
  };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const pkce = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

let env: Env;
let db: DatabaseSync;
let googleIdentity: { sub: string; email: string };
let tunnels: string[];
let dns: string[];
let deleted: string[];

beforeEach(() => {
  const fake = fakeD1();
  db = fake.db;
  env = {
    DB: fake.D1,
    ORIGIN,
    DOMAIN: "nordus.ai",
    CF_ACCOUNT_ID: "acc",
    CF_ZONE_ID: "zone",
    GOOGLE_CLIENT_ID: "cliente.apps.googleusercontent.com",
    MAX_PER_ACCOUNT: "2",
    CF_API_TOKEN: "cf",
    GOOGLE_CLIENT_SECRET: "segredo",
    ID_TOKEN_KEY: "chave",
  };
  googleIdentity = { sub: "111", email: "dona@example.com" };
  tunnels = [];
  dns = [];
  deleted = [];
  let pendingNonce = "";
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.host === "oauth2.googleapis.com") {
      const claims = { iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, nonce: pendingNonce, sub: googleIdentity.sub, email: googleIdentity.email, email_verified: true, name: "Dona" };
      return Response.json({ id_token: `x.${b64(claims)}.y` });
    }
    if (url.host === "accounts.google.com") throw new Error("browser only");
    const path = url.pathname.replace("/client/v4/", "");
    const method = init?.method ?? "GET";
    const ok = (result: unknown) => Response.json({ success: true, result });
    if (method === "POST" && path === "accounts/acc/cfd_tunnel") {
      tunnels.push(JSON.parse(String(init!.body)).name);
      return ok({ id: `tun${tunnels.length}` });
    }
    if (method === "PUT" && path.endsWith("/configurations")) return ok({});
    if (method === "GET" && path === "zones/zone/dns_records") return ok(url.searchParams.get("name") === "app.nordus.ai" || url.searchParams.get("name") === "lab2.nordus.ai" ? [{ id: "r" }] : []);
    if (method === "POST" && path === "zones/zone/dns_records") {
      dns.push(JSON.parse(String(init!.body)).name);
      return ok({ id: `dns${dns.length}` });
    }
    if (method === "GET" && path.endsWith("/token")) return ok("token-do-conector-bem-comprido");
    if (method === "GET" && /cfd_tunnel\/tun\d+$/.test(path)) return ok({ status: "healthy" });
    if (method === "DELETE") {
      deleted.push(path);
      return ok({});
    }
    return Response.json({ success: false, errors: [{ code: 1 }] }, { status: 404 });
  });
  // The Google redirect carries the nonce; the fake token endpoint answers with it.
  setNonce = (value) => {
    pendingNonce = value;
  };
});
let setNonce: (value: string) => void = () => {};

afterEach(() => vi.unstubAllGlobals());

const call = (path: string, init: RequestInit & { cookies?: Record<string, string> } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookies) headers.set("cookie", Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join("; "));
  return route(new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" }), env);
};

function cookiesOf(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair!.indexOf("=");
    out[pair!.slice(0, eq)] = pair!.slice(eq + 1);
  }
  return out;
}

const form = (values: Record<string, string>, origin = ORIGIN) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin },
  body: new URLSearchParams(values).toString(),
});

/** Runs the Google round trip a browser would make from a redirect to accounts.google.com. */
async function throughGoogle(start: Response, jar: Record<string, string>): Promise<Response> {
  expect(start.status).toBe(302);
  const google = new URL(start.headers.get("location")!);
  expect(google.host).toBe("accounts.google.com");
  Object.assign(jar, cookiesOf(start));
  setNonce(google.searchParams.get("nonce")!);
  const back = await call(`/google/callback?state=${google.searchParams.get("state")}&code=abc`, { cookies: jar });
  Object.assign(jar, cookiesOf(back));
  return back;
}

async function activate(jar: Record<string, string>, name: string, machine = "MacBook da Dona") {
  const started = await (await call("/v1/ativacoes", { method: "POST", body: JSON.stringify({ machine, platform: "darwin", credentialPrefix: "nordus_install_" }) })).json() as any;
  expect((await call("/v1/ativacoes/verificar", { method: "POST", body: JSON.stringify({ deviceCode: started.deviceCode }) })).status).toBe(428);
  const page = await call(`/ativar?codigo=${started.userCode}`, { cookies: jar });
  const confirmed = await call("/ativar", { ...form({ codigo: started.userCode, nome: name }), cookies: jar });
  const poll = await call("/v1/ativacoes/verificar", { method: "POST", body: JSON.stringify({ deviceCode: started.deviceCode }) });
  return { started, page, confirmed, poll };
}

async function signedIn(): Promise<Record<string, string>> {
  const jar: Record<string, string> = {};
  const back = await throughGoogle(await call("/entrar"), jar);
  expect(back.headers.get("location")).toBe("/");
  return jar;
}

describe("names", () => {
  it("refuses reserved, misleading and malformed names", () => {
    expect(nameProblem("app")).toBe("reservado");
    expect(nameProblem("login-banco")).toBe("reservado");
    expect(nameProblem("meu-nordus")).toBe("reservado");
    expect(nameProblem("-abc")).toBe("formato");
    expect(nameProblem("a--b")).toBe("formato");
    expect(nameProblem("ab")).toBe("formato");
    expect(nameProblem("loja-da-ana")).toBeNull();
  });
  it("suggests a valid name from the machine", () => {
    expect(suggestName("MacBook Pro de João")).toBe("macbook-pro-de-joao");
    expect(nameProblem(suggestName("Nordus"))).toBeNull();
  });
});

describe("activation and server sign-in", () => {
  it("connects a machine, hands it a tunnel, and signs its owner in through Google", async () => {
    const jar = await signedIn();
    const { page, confirmed, poll } = await activate(jar, "loja-da-ana");
    expect(await page.text()).toContain("MacBook da Dona");
    expect(await confirmed.text()).toContain("loja-da-ana.nordus.ai");
    expect(dns).toEqual(["loja-da-ana.nordus.ai"]);
    const done = await poll.json() as any;
    expect(done.address).toBe("https://loja-da-ana.nordus.ai");
    expect(done.email).toBe("dona@example.com");
    expect(done.credential).toMatch(/^nordus_install_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect((await call("/v1/ativacoes/verificar", { method: "POST", body: JSON.stringify({ deviceCode: "x".repeat(43) }) })).status).toBe(410);

    const endpoint = await call("/v1/installations/self/endpoint", { method: "POST", headers: { authorization: `Bearer ${done.credential}` } });
    expect(await endpoint.json()).toEqual({ endpoint: { url: "https://loja-da-ana.nordus.ai", status: "ready" }, connectorToken: "token-do-conector-bem-comprido" });
    expect((await call("/v1/installations/self/endpoint", { method: "POST", headers: { authorization: `Bearer ${done.credential.slice(0, -1)}A` } })).status).toBe(401);

    const verifier = "v".repeat(50);
    const authorize = (extra = "", redirect = "https://loja-da-ana.nordus.ai/auth/google/callback") =>
      `/oauth/authorize?client_id=${done.installationId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&state=st&nonce=nn&code_challenge=${pkce(verifier)}&code_challenge_method=S256${extra}`;
    expect((await call(authorize("", "https://outro.nordus.ai/auth/google/callback"))).status).toBe(400);

    // Already signed in to the account: one click.
    const prompt = await call(authorize(), { cookies: jar });
    Object.assign(jar, cookiesOf(prompt));
    const t = /name="t" value="([^"]+)"/.exec(await prompt.text())![1]!;
    expect((await call("/oauth/continuar", { ...form({ t }, "https://evil.example"), cookies: jar })).status).toBe(403);
    const back = await call("/oauth/continuar", { ...form({ t }), cookies: jar });
    const target = new URL(back.headers.get("location")!);
    expect(target.origin + target.pathname).toBe("https://loja-da-ana.nordus.ai/auth/google/callback");
    expect(target.searchParams.get("state")).toBe("st");
    const code = target.searchParams.get("code")!;

    const exchange = (values: Record<string, string>) =>
      call("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() });
    const base = { grant_type: "authorization_code", code, client_id: done.installationId, client_secret: done.credential, redirect_uri: "https://loja-da-ana.nordus.ai/auth/google/callback", code_verifier: verifier };
    expect((await exchange({ ...base, code_verifier: "w".repeat(50) })).status).toBe(400);
    const tokenResponse = await exchange(base);
    // The failed attempt above spent the code: one try per code.
    expect(tokenResponse.status).toBe(400);
  });

  it("issues an id token the server can read, once per code", async () => {
    const jar = await signedIn();
    const done = await (await activate(jar, "bots-da-ana")).poll.json() as any;
    const verifier = "q".repeat(50);
    const start = await call(`/oauth/authorize?client_id=${done.installationId}&redirect_uri=${encodeURIComponent("https://bots-da-ana.nordus.ai/auth/google/callback")}&response_type=code&state=s1&nonce=n1&code_challenge=${pkce(verifier)}&code_challenge_method=S256&trocar=1`, { cookies: jar });
    googleIdentity = { sub: "222", email: "colega@example.com" };
    const back = await throughGoogle(start, jar);
    const code = new URL(back.headers.get("location")!).searchParams.get("code")!;
    const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id: done.installationId, client_secret: done.credential, redirect_uri: "https://bots-da-ana.nordus.ai/auth/google/callback", code_verifier: verifier }).toString();
    const post = () => call("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const tokens = await (await post()).json() as any;
    const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({ iss: ORIGIN, aud: done.installationId, email: "colega@example.com", email_verified: true, nonce: "n1", sub: "google:222" });
    expect((await post()).status).toBe(400);
  });

  it("keeps names owned, refuses names in DNS, caps addresses per account and frees them on removal", async () => {
    const jar = await signedIn();
    expect(await (await activate(jar, "app")).confirmed.text()).toContain("reservado");
    expect(await (await activate(jar, "lab2")).confirmed.text()).toContain("reservado");
    await activate(jar, "primeiro");
    await activate(jar, "segundo");
    expect(await (await activate(jar, "terceiro")).confirmed.text()).toContain("já tem 2 endereços");
    // The same name again moves it to the new machine (a reinstall) instead of failing.
    const again = await activate(jar, "primeiro", "VPS nova");
    expect((await again.poll.json() as any).address).toBe("https://primeiro.nordus.ai");

    googleIdentity = { sub: "999", email: "outra@example.com" };
    const other = await signedIn();
    expect(await (await activate(other, "primeiro")).confirmed.text()).toContain("já tem dono");

    const id = (db.prepare("SELECT id FROM installations WHERE name = 'segundo'").get() as { id: string }).id;
    expect((await call("/remover", { ...form({ id }), cookies: other })).status).toBe(302);
    expect(db.prepare("SELECT COUNT(*) AS n FROM installations").get()).toEqual({ n: 2 });
    await call("/remover", { ...form({ id }), cookies: jar });
    expect(db.prepare("SELECT COUNT(*) AS n FROM installations").get()).toEqual({ n: 1 });
    expect(deleted.some((path) => path.endsWith("dns_records/dns2"))).toBe(true);
  });

  it("accepts a same-site form whose Origin the browser blanked, and refuses one from another site", async () => {
    const jar = await signedIn();
    const started = await (await call("/v1/ativacoes", { method: "POST", body: JSON.stringify({ machine: "PC", platform: "windows", credentialPrefix: "nordus_install_" }) })).json() as any;
    const post = (headers: Record<string, string>) => call("/ativar", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({ codigo: started.userCode, nome: "pc-da-dona" }).toString(),
      cookies: jar,
    });
    expect((await post({ origin: "null", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ "sec-fetch-site": "same-site" })).status).toBe(403);
    const ok = await post({ origin: "null", "sec-fetch-site": "same-origin" });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("pc-da-dona.nordus.ai");
  });

  it("checks a name while the person types: free, theirs, taken, reserved", async () => {
    const jar = await signedIn();
    await activate(jar, "loja-da-ana");
    const check = async (name: string, cookies = jar) => (await call(`/api/nome?n=${name}`, { cookies })).json() as Promise<any>;
    expect(await check("outra-loja")).toEqual({ ok: true });
    expect(await check("loja-da-ana")).toEqual({ ok: true, seu: true });
    expect((await check("app")).ok).toBe(false);
    expect((await check("lab2")).ok).toBe(false);
    googleIdentity = { sub: "777", email: "b@example.com" };
    expect((await check("loja-da-ana", await signedIn())).motivo).toContain("já tem dono");
    expect((await call("/api/nome?n=x")).status).toBe(401);
  });

  it("refuses a Google return in a browser that did not start the sign-in", async () => {
    const start = await call("/entrar");
    const google = new URL(start.headers.get("location")!);
    setNonce(google.searchParams.get("nonce")!);
    const back = await call(`/google/callback?state=${google.searchParams.get("state")}&code=abc`, { cookies: { "__Host-nordus_login": "outro" } });
    expect(back.status).toBe(400);
    expect(back.headers.getSetCookie().some((line) => line.startsWith("__Host-nordus_conta="))).toBe(false);
  });
});
