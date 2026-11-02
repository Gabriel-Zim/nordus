import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { allowedScopes } from "./account-signin.ts";
import { environmentDescriptor } from "./environment.ts";
import { APP_CALLBACKS, APP_CODE_TTL_MS, createAppCodes, createGoogleLogin, GOOGLE_PROVIDER, LOGIN_BINDING_COOKIE } from "./google-login.ts";
import { handleLoginRoutes } from "./google-login-http.ts";
import { resolveRequestAuth } from "./request-auth.ts";
import { LOCKOUT, SessionRegistry } from "./sessions.ts";

const CLIENT = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "segredo-de-teste", provider: GOOGLE_PROVIDER };
const LIST = { admins: ["member@example.com"], members: [] };
const COOKIE = "nordus_session_fixture";
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const PICTURE = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.c2lnbmF0dXJl`;
}

function fakeGoogle() {
  const seen: { challenge?: string; nonce?: string } = {};
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = new URLSearchParams(String(init?.body));
    if (createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") !== seen.challenge || body.get("code") !== "codigo-do-google") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    const claims = {
      iss: "https://accounts.google.com", aud: CLIENT.clientId, sub: "1029", email: "member@example.com",
      email_verified: true, nonce: seen.nonce, name: "Avery", picture: PICTURE,
      exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000),
    };
    return new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 });
  };
  return { seen, fetchImpl };
}

interface Reply {
  status: number;
  headers: { get(name: string): string | null; getSetCookie(): string[] };
  json(): Promise<any>;
}

async function serve() {
  const dir = mkdtempSync(join(tmpdir(), "nordus-app-token-"));
  dirs.push(dir);
  const sessions = new SessionRegistry({ file: join(dir, "sessions.json"), emailScopes: (email) => allowedScopes(email, LIST) });
  const google = fakeGoogle();
  const login = createGoogleLogin({ credentials: () => CLIENT, allow: (email) => allowedScopes(email, LIST), fetchImpl: google.fetchImpl });
  let codeNow = 1_000_000;
  const appCodes = createAppCodes({ now: () => codeNow });
  const environment = () => environmentDescriptor({ environmentId: "fixture-environment", desktopManaged: false });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/api/bots" || url.pathname === "/api/events") {
      const gate = resolveRequestAuth(req, { sessions, cookieName: COOKIE, streamPath: "/api/events", url });
      if (!gate.auth) {
        res.writeHead(gate.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: gate.error }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: url.pathname, scopes: gate.auth.scopes }));
      return;
    }
    void handleLoginRoutes(req, res, url.pathname, req.method ?? "GET", url, { login, sessions, sessionCookie: COOKIE, appCodes, environment }).then((handled) => {
      if (!handled) { res.writeHead(404); res.end(); }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  const call = (method: string, path: string, options: { cookie?: string; body?: string; headers?: Record<string, string> } = {}) => new Promise<Reply>((resolve, reject) => {
    const headers: Record<string, string> = { host: "lab.example.com", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9", ...options.headers };
    if (options.cookie) headers.cookie = options.cookie;
    if (options.body !== undefined) headers["content-length"] = String(Buffer.byteLength(options.body));
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        const raw = res.headers["set-cookie"] ?? [];
        resolve({
          status: res.statusCode ?? 0,
          headers: { get: (name: string) => (res.headers[name.toLowerCase()] as string | undefined) ?? null, getSetCookie: () => raw },
          json: async () => JSON.parse(text),
        });
      });
    });
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });

  const startApp = async (client: string) => {
    const res = await call("GET", `/auth/google?cliente=${client}&desafio=${CHALLENGE}`);
    const location = new URL(res.headers.get("location")!, "https://lab.example.com");
    if (location.origin !== "https://accounts.google.com") return { res, location, cookie: "" };
    google.seen.challenge = location.searchParams.get("code_challenge")!;
    google.seen.nonce = location.searchParams.get("nonce")!;
    const binding = res.headers.getSetCookie().find((cookie) => cookie.startsWith(`${LOGIN_BINDING_COOKIE}=`))!;
    return { res, location, cookie: binding.split(";")[0]! };
  };
  const startWeb = async () => {
    const res = await call("GET", "/auth/google");
    const location = new URL(res.headers.get("location")!, "https://lab.example.com");
    google.seen.challenge = location.searchParams.get("code_challenge")!;
    google.seen.nonce = location.searchParams.get("nonce")!;
    const binding = res.headers.getSetCookie().find((cookie) => cookie.startsWith(`${LOGIN_BINDING_COOKIE}=`))!;
    return { res, location, cookie: binding.split(";")[0]! };
  };
  const finish = async (started: { location: URL; cookie: string }) => {
    const res = await call("GET", `/auth/google/callback?state=${started.location.searchParams.get("state")}&code=codigo-do-google`, { cookie: started.cookie });
    return { res, location: new URL(res.headers.get("location")!, "https://lab.example.com") };
  };
  const exchange = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
    call("POST", "/auth/app/token", { body: typeof body === "string" ? body : JSON.stringify(body), headers });
  const appCode = async (client = "rn") => {
    const started = await startApp(client);
    const back = await finish(started);
    return { back, code: back.location.searchParams.get("code")! };
  };

  return {
    call, startApp, startWeb, finish, exchange, appCode, sessions, environment,
    advanceCodeClock: (ms: number) => { codeNow += ms; },
  };
}

describe("POST /auth/app/token", () => {
  it("exchanges the app's one-time code for the pairing body, and the token opens /api/bots and /api/events", async () => {
    const { call, exchange, appCode, sessions, environment } = await serve();
    const { back, code } = await appCode("rn");
    expect(back.res.status).toBe(302);
    expect(back.location.protocol).toBe("ai.nordus.rn:");
    expect(back.location.host).toBe("auth");
    expect(code).toMatch(/^[\w-]{43}$/);
    expect(back.res.headers.getSetCookie().some((cookie) => cookie.startsWith(`${COOKIE}=`))).toBe(false);

    const swapped = await exchange({ code, verificador: VERIFIER, label: "iPhone do Avery" });
    expect(swapped.status).toBe(200);
    expect(swapped.headers.get("cache-control")).toBe("no-store");
    expect(swapped.headers.getSetCookie()).toEqual([]);
    const body = await swapped.json();
    expect(body.token).toMatch(/^nordus_sess_/);
    expect(body.session).toMatchObject({ label: "iPhone do Avery", scopes: ["admin", "client"], email: "member@example.com" });
    expect(body.environment).toEqual(environment());
    expect(sessions.list()).toEqual([expect.objectContaining({ email: "member@example.com", scopes: ["admin", "client"] })]);

    const bots = await call("GET", "/api/bots", { headers: { authorization: `Bearer ${body.token}` } });
    expect(bots.status).toBe(200);
    expect((await bots.json()).scopes).toEqual(["admin", "client"]);
    const events = await call("GET", "/api/events", { headers: { authorization: `Bearer ${body.token}` } });
    expect(events.status).toBe(200);
    expect((await events.json()).path).toBe("/api/events");
    expect((await call("GET", "/api/bots", { headers: { authorization: "Bearer nordus_sess_nao_existe" } })).status).toBe(401);
  });

  it("gives an app the same scopes the browser sign-in gets for the same address", async () => {
    const { exchange, appCode, startWeb, finish, sessions } = await serve();
    const web = await finish(await startWeb());
    expect(web.res.status).toBe(302);
    expect(web.location.pathname).toBe("/");
    const browserSession = sessions.list()[0]!;
    expect(browserSession.email).toBe("member@example.com");

    const { code } = await appCode("rn");
    const swapped = await exchange({ code, verificador: VERIFIER });
    expect(swapped.status).toBe(200);
    const app = (await swapped.json()).session;
    expect(app.scopes).toEqual(browserSession.scopes);
    expect(app.email).toBe(browserSession.email);
  });

  it("keeps Google's name and photo in the session a browser sign-in opens", async () => {
    const { finish, startWeb, sessions } = await serve();
    const web = await finish(await startWeb());
    const cookie = web.res.headers.getSetCookie().find((entry) => entry.startsWith(`${COOKIE}=`))!.split(";")[0]!;
    expect(sessions.authenticate(cookie.slice(COOKIE.length + 1))).toMatchObject({ email: "member@example.com", name: "Avery", picture: PICTURE });
  });

  it("keeps the same name and photo in the session an app gets", async () => {
    const { exchange, appCode, sessions } = await serve();
    const { code } = await appCode("rn");
    const body = await (await exchange({ code, verificador: VERIFIER })).json();
    expect(body.session.name).toBe("Avery");
    expect(JSON.stringify(body)).not.toContain(PICTURE);
    expect(sessions.authenticate(body.token)).toMatchObject({ email: "member@example.com", name: "Avery", picture: PICTURE });
  });

  it("refuses the wrong verifier, spends the code and leaves no session behind", async () => {
    const { exchange, appCode, sessions } = await serve();
    const { code } = await appCode();
    const wrong = await exchange({ code, verificador: "x".repeat(43) });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toMatch(/expired or was already used/);
    expect(sessions.list()).toEqual([]);
    expect((await exchange({ code, verificador: VERIFIER })).status).toBe(401);
  });

  it("uses a code only once", async () => {
    const { exchange, appCode } = await serve();
    const { code } = await appCode();
    expect((await exchange({ code, verificador: VERIFIER })).status).toBe(200);
    expect((await exchange({ code, verificador: VERIFIER })).status).toBe(401);
  });

  it("refuses a code older than its sixty seconds", async () => {
    const { exchange, appCode, advanceCodeClock } = await serve();
    const { code } = await appCode();
    advanceCodeClock(APP_CODE_TTL_MS + 1);
    expect((await exchange({ code, verificador: VERIFIER })).status).toBe(401);
  });

  it("locks the address out after repeated failures", async () => {
    const { exchange, appCode } = await serve();
    const { code } = await appCode();
    for (let attempt = 0; attempt < LOCKOUT.failures; attempt += 1) {
      expect((await exchange({ code: "a".repeat(43), verificador: VERIFIER })).status).toBe(401);
    }
    const locked = await exchange({ code, verificador: VERIFIER });
    expect(locked.status).toBe(429);
    expect((await locked.json()).error).toMatch(/too many failed sign-in attempts/);
  });

  it("refuses anything that is not a JSON object with the JSON content type", async () => {
    const { exchange } = await serve();
    const plain = await exchange({ code: "x", verificador: VERIFIER }, { "content-type": "text/plain" });
    expect(plain.status).toBe(415);
    expect((await exchange("{", { "content-type": "application/json" })).status).toBe(400);
    expect((await exchange("[]", { "content-type": "application/json" })).status).toBe(400);
    expect((await exchange({}, { "content-type": "application/json" })).status).toBe(401);
  });

  it("refuses an unknown client before reaching Google", async () => {
    const { startApp } = await serve();
    const unknown = await startApp("android");
    expect(unknown.location.pathname).toBe("/");
    expect(unknown.location.searchParams.get("login_erro")).toBe("falhou");
  });

  it("keeps mac on the old Electron scheme, sends rn to its own and refuses desktop", async () => {
    expect(APP_CALLBACKS).toMatchObject({
      ios: "ai.nordus.app://auth",
      mac: "ai.nordus.desktop://auth",
      rn: "ai.nordus.rn://auth",
    });
    expect(APP_CALLBACKS).not.toHaveProperty("desktop");
    const { appCode, startApp } = await serve();
    expect((await startApp("desktop")).location.searchParams.get("login_erro")).toBe("falhou");
    for (const [client, scheme] of [["mac", "ai.nordus.desktop:"], ["rn", "ai.nordus.rn:"]] as const) {
      const { back } = await appCode(client);
      expect(back.location.protocol, client).toBe(scheme);
      expect(back.location.searchParams.get("code"), client).toMatch(/^[\w-]{43}$/);
    }
  });
});
