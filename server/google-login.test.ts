import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { allowedScopes } from "./account-signin.ts";
import { environmentDescriptor } from "./environment.ts";
import { createAppCodes, createGoogleLogin, GoogleLoginStore, LOGIN_BINDING_COOKIE, safeReturnTo, verifiedIdentity, GOOGLE_PROVIDER, type GoogleLoginOptions } from "./google-login.ts";
import { handleLoginRoutes } from "./google-login-http.ts";
import { SessionRegistry } from "./sessions.ts";

const CLIENT = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "segredo-de-teste", provider: GOOGLE_PROVIDER };
const LIST = { admins: ["member@example.com", "admin@example.com"], members: [] };
const REDIRECT = "https://lab.example.com/auth/google/callback";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nordus-login-"));
  dirs.push(dir);
  return dir;
}

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.c2lnbmF0dXJl`;
}

/** Google's token endpoint: checks the PKCE verifier against the challenge it was shown, then answers with these claims. */
function fakeGoogle(claims: (nonce: string) => Record<string, unknown>) {
  const seen: { challenge?: string; nonce?: string; body?: URLSearchParams } = {};
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = new URLSearchParams(String(init?.body));
    seen.body = body;
    const verifier = body.get("code_verifier") ?? "";
    if (createHash("sha256").update(verifier).digest("base64url") !== seen.challenge || body.get("code") !== "codigo-do-google") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    return new Response(JSON.stringify({ id_token: idToken(claims(seen.nonce!)) }), { status: 200 });
  };
  return { seen, fetchImpl };
}

const goodClaims = (email = "member@example.com") => (nonce: string) => ({
  iss: "https://accounts.google.com", aud: CLIENT.clientId, sub: "1029", email, email_verified: true, nonce,
  exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), name: "Avery",
});

function loginWith(claims: (nonce: string) => Record<string, unknown>, extra: Partial<GoogleLoginOptions> = {}) {
  const google = fakeGoogle(claims);
  const login = createGoogleLogin({ credentials: () => CLIENT, allow: (email) => allowedScopes(email, LIST), fetchImpl: google.fetchImpl, ...extra });
  const begin = (returnTo?: string) => {
    const started = login.begin({ redirectUri: REDIRECT, returnTo });
    if (!started.ok) throw new Error(started.reason);
    const params = new URL(started.url).searchParams;
    google.seen.challenge = params.get("code_challenge")!;
    google.seen.nonce = params.get("nonce")!;
    return { ...started, params };
  };
  return { login, google, begin };
}

describe("Entrar com Google", () => {
  it("asks Google for the identity only, with state, nonce and an S256 PKCE challenge", () => {
    const { begin } = loginWith(goodClaims());
    const { url, params, binding } = begin();
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(params.get("scope")).toBe("openid email profile");
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(params.get("state")).toMatch(/^[\w-]{43}$/);
    expect(params.get("nonce")).toMatch(/^[\w-]{43}$/);
    expect(binding).not.toBe(params.get("state"));
    expect(url).not.toContain(CLIENT.clientSecret);
  });

  it("is off until a client is saved", () => {
    const login = createGoogleLogin({ credentials: () => null, allow: () => ["admin"] });
    expect(login.enabled()).toBe(false);
    expect(login.begin({ redirectUri: REDIRECT })).toEqual({ ok: false, reason: "nao_configurado" });
  });

  it("lets an allowed address in with its scopes and the page it started from", async () => {
    const { login, google, begin } = loginWith(goodClaims());
    const { params, binding } = begin("/sala/abc?x=1");
    const done = await login.finish({ query: new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" }), binding });
    expect(done).toMatchObject({ ok: true, email: "member@example.com", scopes: ["admin", "client"], returnTo: "/sala/abc?x=1" });
    expect(google.seen.body?.get("redirect_uri")).toBe(REDIRECT);
  });

  it("hands over Google's name and photo with the identity", async () => {
    const picture = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";
    const { login, begin } = loginWith((nonce) => ({ ...goodClaims()(nonce), picture }));
    const { params, binding } = begin();
    const done = await login.finish({ query: new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" }), binding });
    expect(done).toMatchObject({ ok: true, name: "Avery", picture });
  });

  it("refuses any other Google account with a plain message code", async () => {
    const { login, begin } = loginWith(goodClaims("intruso@gmail.com"));
    const { params, binding } = begin();
    const done = await login.finish({ query: new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" }), binding });
    expect(done).toMatchObject({ ok: false, reason: "nao_permitido", countsAsFailure: true });
  });

  it("puts a verified account that is not on the list on the waiting list, and takes it off once it gets in", async () => {
    const requests: Array<[string, string | null]> = [];
    const cleared: string[] = [];
    const waitlist = { request: (email: string, name: string | null) => { requests.push([email, name]); }, clear: (email: string) => { cleared.push(email); } };
    const outsider = loginWith(goodClaims("Intruso@Gmail.com"), { waitlist });
    const first = outsider.begin();
    const refused = await outsider.login.finish({ query: new URLSearchParams({ state: first.params.get("state")!, code: "codigo-do-google" }), binding: first.binding });
    expect(refused).toMatchObject({ ok: false, reason: "lista_de_espera", countsAsFailure: true });
    expect(requests).toEqual([["intruso@gmail.com", "Avery"]]);
    expect(cleared).toEqual([]);
    const insider = loginWith(goodClaims(), { waitlist });
    const second = insider.begin();
    const entered = await insider.login.finish({ query: new URLSearchParams({ state: second.params.get("state")!, code: "codigo-do-google" }), binding: second.binding });
    expect(entered).toMatchObject({ ok: true });
    expect(cleared).toEqual(["member@example.com"]);
  });

  describe("the invite link", () => {
    const TOKEN = "convite-valido-123";
    const wire = (live = TOKEN) => {
      const recorded: Array<[string, string | null]> = [];
      const requested: string[] = [];
      const join = { matches: (token: string) => token === live, record: (email: string, name: string | null) => { recorded.push([email, name]); return true; } };
      const waitlist = { request: (email: string) => { requested.push(email); }, clear: () => {} };
      return { recorded, requested, join, waitlist };
    };
    const run = async (email: string, options: Partial<GoogleLoginOptions>, token: string | null) => {
      const { login, google } = loginWith(goodClaims(email), options);
      const started = login.begin({ redirectUri: REDIRECT, join: token });
      if (!started.ok) throw new Error(started.reason);
      const params = new URL(started.url).searchParams;
      google.seen.challenge = params.get("code_challenge")!;
      google.seen.nonce = params.get("nonce")!;
      if (token) expect(started.url).not.toContain(token);
      return login.finish({ query: new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" }), binding: started.binding });
    };

    it("records a request, not a failure, for an unlisted account that came through a live link", async () => {
      const w = wire();
      const done = await run("Novo@Gmail.com", { join: w.join, waitlist: w.waitlist }, TOKEN);
      expect(done).toMatchObject({ ok: false, reason: "pendente", countsAsFailure: false });
      expect(w.recorded).toEqual([["novo@gmail.com", "Avery"]]);
      expect(w.requested).toEqual([]);
    });

    it("keeps the usual refusal for a wrong, revoked or missing token", async () => {
      const w = wire();
      expect(await run("novo@gmail.com", { join: w.join }, "outro-token-9999")).toMatchObject({ ok: false, reason: "nao_permitido" });
      expect(await run("novo@gmail.com", { join: wire("outro-token-0000").join, waitlist: w.waitlist }, TOKEN)).toMatchObject({ ok: false, reason: "lista_de_espera" });
      expect(await run("novo@gmail.com", { join: w.join }, null)).toMatchObject({ ok: false, reason: "nao_permitido" });
      expect(w.recorded).toEqual([]);
    });

    it("signs an already allowed account in without a request", async () => {
      const w = wire();
      expect(await run("member@example.com", { join: w.join }, TOKEN)).toMatchObject({ ok: true });
      expect(w.recorded).toEqual([]);
    });

    it("never takes a malformed token", async () => {
      const w = wire("curto");
      expect(await run("novo@gmail.com", { join: w.join }, "curto")).toMatchObject({ ok: false, reason: "nao_permitido" });
    });
  });

  it("does not record an unverified e-mail on the waiting list", async () => {
    const requests: string[] = [];
    const claims = (nonce: string) => ({ ...goodClaims("intruso@gmail.com")(nonce), email_verified: false });
    const { login, begin } = loginWith(claims, { waitlist: { request: (email) => { requests.push(email); }, clear: () => {} } });
    const { params, binding } = begin();
    const done = await login.finish({ query: new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" }), binding });
    expect(done).toMatchObject({ ok: false, reason: "email_nao_verificado" });
    expect(requests).toEqual([]);
  });

  it("refuses a callback from another browser (login CSRF) and spends the state either way", async () => {
    const { login, begin } = loginWith(goodClaims());
    const { params, binding } = begin();
    const query = new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" });
    expect(await login.finish({ query, binding: undefined })).toMatchObject({ ok: false, reason: "expirou" });
    expect(await login.finish({ query, binding })).toMatchObject({ ok: false, reason: "expirou" });
  });

  it("uses a state only once", async () => {
    const { login, begin } = loginWith(goodClaims());
    const { params, binding } = begin();
    const query = new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" });
    expect((await login.finish({ query, binding })).ok).toBe(true);
    expect(await login.finish({ query, binding })).toMatchObject({ ok: false, reason: "expirou" });
  });

  it("lets a state expire after ten minutes", async () => {
    let now = 1_000_000;
    const { login, begin } = loginWith(goodClaims(), { now: () => now });
    const { params, binding } = begin();
    now += 10 * 60_000 + 1;
    expect(await login.finish({ query: new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" }), binding })).toMatchObject({ ok: false, reason: "expirou" });
  });

  it("treats a cancelled consent as cancelled, not as an attack", async () => {
    const { login, begin } = loginWith(goodClaims());
    const { params, binding } = begin();
    expect(await login.finish({ query: new URLSearchParams({ state: params.get("state")!, error: "access_denied" }), binding }))
      .toMatchObject({ ok: false, reason: "cancelado", countsAsFailure: false });
  });

  it("caps the number of open starts", () => {
    const { login, begin } = loginWith(goodClaims());
    for (let i = 0; i < 700; i += 1) begin();
    expect(login.pendingCount()).toBeLessThanOrEqual(500);
  });
});

describe("the ID token claims", () => {
  const base = { iss: "https://accounts.google.com", aud: CLIENT.clientId, sub: "1", email: "Member@example.com", email_verified: true, nonce: "n", exp: 2_000 };
  const check = (claims: Record<string, unknown>) => verifiedIdentity(claims, { clientId: CLIENT.clientId, nonce: "n", nowSeconds: 1_000 });

  it("accepts Google's own token for this client and lowercases the address", () => {
    expect(check(base)).toMatchObject({ ok: true, email: "member@example.com" });
  });
  it("carries Google's picture when it is a plain https address, and null otherwise", () => {
    const picture = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";
    expect(check({ ...base, picture })).toMatchObject({ ok: true, picture });
    expect(check(base)).toMatchObject({ ok: true, picture: null });
    for (const bad of ["http://lh3.googleusercontent.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "https://u:p@x.test/a.png", `https://x.test/${"a".repeat(600)}`, 7]) {
      expect(check({ ...base, picture: bad }), String(bad)).toMatchObject({ ok: true, picture: null });
    }
  });
  it("rejects another issuer, another client, a stale token, a replayed nonce and an unverified address", () => {
    expect(check({ ...base, iss: "https://evil.example" })).toMatchObject({ ok: false });
    expect(check({ ...base, aud: "other.apps.googleusercontent.com" })).toMatchObject({ ok: false });
    expect(check({ ...base, aud: [CLIENT.clientId, "other"], azp: "other" })).toMatchObject({ ok: false });
    expect(check({ ...base, exp: 500 })).toMatchObject({ ok: false, reason: "expirou" });
    expect(check({ ...base, nonce: "outro" })).toMatchObject({ ok: false });
    expect(check({ ...base, email_verified: false })).toMatchObject({ ok: false, reason: "email_nao_verificado" });
    expect(check({ ...base, sub: undefined })).toMatchObject({ ok: false });
  });
});

describe("returning after sign-in", () => {
  it("only ever goes to a path on this server", () => {
    expect(safeReturnTo("/sala/1?a=b#c")).toBe("/sala/1?a=b#c");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "", null, "/auth/google", "/x\u0000"]) {
      expect(safeReturnTo(bad)).toBe("/");
    }
  });
});

describe("Entrar com Google through a Nordus account", () => {
  const CONTA = "https://conta.nordus.ai";
  const INSTALLATION = "0b7f6c2e-6a43-4c1e-9d55-3f6f1c2b9a10";

  it("sends the person to the account, exchanges the code there with the machine's credential, and trusts only its issuer", async () => {
    const dir = tempDir();
    const store = new GoogleLoginStore(dir);
    store.setConta(CONTA, INSTALLATION, "nordus_install_aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(store.status()).toMatchObject({ configured: true, clientId: INSTALLATION, conta: CONTA });
    const credentials = new GoogleLoginStore(dir).credentials()!;
    expect(credentials.provider.authorizeUrl).toBe(`${CONTA}/oauth/authorize`);

    const claims = (iss: string) => (nonce: string) => ({ ...goodClaims()(nonce), iss, aud: INSTALLATION });
    for (const [iss, ok] of [[CONTA, true], ["https://accounts.google.com", false]] as const) {
      const google = fakeGoogle(claims(iss));
      const urls: string[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        urls.push(String(input));
        return google.fetchImpl(input, init);
      };
      const login = createGoogleLogin({ credentials: () => credentials, allow: (email) => allowedScopes(email, LIST), fetchImpl });
      const started = login.begin({ redirectUri: REDIRECT });
      if (!started.ok) throw new Error(started.reason);
      const params = new URL(started.url).searchParams;
      expect(started.url.startsWith(`${CONTA}/oauth/authorize?`)).toBe(true);
      expect(params.get("client_id")).toBe(INSTALLATION);
      google.seen.challenge = params.get("code_challenge")!;
      google.seen.nonce = params.get("nonce")!;
      const done = await login.finish({ query: new URLSearchParams({ state: params.get("state")!, code: "codigo-do-google" }), binding: started.binding });
      expect(urls).toEqual([`${CONTA}/oauth/token`]);
      expect(google.seen.body?.get("client_secret")).toMatch(/^nordus_install_/);
      expect(done.ok).toBe(ok);
    }
  });

  it("does not keep the machine's credential when the owner saves their own Google client without a secret", () => {
    const store = new GoogleLoginStore(tempDir());
    store.setConta(CONTA, INSTALLATION, "nordus_install_aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(() => store.set(CLIENT.clientId, null)).toThrow(/secreta/);
    store.set(CLIENT.clientId, CLIENT.clientSecret);
    expect(store.credentials()).toEqual(CLIENT);
  });
});

describe("the saved client", () => {
  it("seals the secret, keeps it on a blank save and never shows it", () => {
    const dir = tempDir();
    const store = new GoogleLoginStore(dir);
    expect(store.status()).toEqual({ configured: false, clientId: null, conta: null, updatedAt: null });
    expect(() => store.set("nao-e-google", "x")).toThrow(/googleusercontent/);
    expect(() => store.set(CLIENT.clientId, "")).toThrow(/secreta/);
    store.set(CLIENT.clientId, CLIENT.clientSecret);
    expect(readFileSync(join(dir, "google-login.json.enc")).includes(Buffer.from(CLIENT.clientSecret))).toBe(false);
    expect(JSON.stringify(store.status())).not.toContain(CLIENT.clientSecret);
    store.set(CLIENT.clientId, null);
    expect(new GoogleLoginStore(dir).credentials()).toEqual(CLIENT);
    store.remove();
    expect(new GoogleLoginStore(dir).credentials()).toBeNull();
  });
});

interface Reply { status: number; headers: { get(name: string): string | null; getSetCookie(): string[] }; json(): Promise<unknown> }

describe("the /auth routes", () => {
  async function serve() {
    const dir = tempDir();
    const sessions = new SessionRegistry({ file: join(dir, "sessions.json"), emailScopes: (email) => allowedScopes(email, LIST) });
    let claims = goodClaims();
    const google = fakeGoogle((nonce) => claims(nonce));
    const joined: string[] = [];
    const login = createGoogleLogin({
      credentials: () => CLIENT,
      allow: (email) => allowedScopes(email, LIST),
      join: { matches: (token) => token === "convite-valido-123", record: (email) => { joined.push(email); return true; } },
      fetchImpl: google.fetchImpl,
    });
    const appCodes = createAppCodes();
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      void handleLoginRoutes(req, res, url.pathname, req.method ?? "GET", url, { login, sessions, sessionCookie: "nordus_session_test", appCodes, environment: () => environmentDescriptor({ environmentId: "fixture", desktopManaged: false }) }).then((handled) => {
        if (!handled) { res.writeHead(404); res.end(); }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const headers = { host: "lab.example.com", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" };
    // fetch drops a Host header; the tunnel delivers lab.example.com, so send it the way the tunnel does.
    const get = (path: string, cookie?: string, extra: Record<string, string> = {}) => new Promise<Reply>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, headers: { ...headers, ...(cookie ? { cookie } : {}), ...extra } }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          const raw = res.headers["set-cookie"] ?? [];
          resolve({
            status: res.statusCode ?? 0,
            headers: { get: (name: string) => (res.headers[name.toLowerCase()] as string | undefined) ?? null, getSetCookie: () => raw },
            json: async () => JSON.parse(body),
          });
        });
      });
      req.on("error", reject);
      req.end();
    });
    const start = async (voltar = "/", query = "") => {
      const res = await get(`/auth/google?voltar=${encodeURIComponent(voltar)}${query}`);
      const location = new URL(res.headers.get("location")!);
      google.seen.challenge = location.searchParams.get("code_challenge")!;
      google.seen.nonce = location.searchParams.get("nonce")!;
      const binding = res.headers.getSetCookie().find((c) => c.startsWith(`${LOGIN_BINDING_COOKIE}=`))!;
      return { res, location, binding, cookie: binding.split(";")[0]! };
    };
    return { get, start, sessions, joined, setClaims: (next: typeof claims) => { claims = next; } };
  }

  it("says whether Google sign-in is on", async () => {
    const { get } = await serve();
    expect(await (await get("/auth/status")).json()).toEqual({ google: true });
  });

  it("sends the browser to Google with a short-lived binding cookie and comes back to this host", async () => {
    const { start } = await serve();
    const { res, location, binding } = await start();
    expect(res.status).toBe(302);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(binding).toMatch(/HttpOnly/);
    expect(binding).toMatch(/Secure/);
    expect(binding).toMatch(/SameSite=Lax/);
    expect(binding).toMatch(/Path=\/auth\/google\/callback/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("turns an allowed Google account into an httpOnly, Secure, SameSite session cookie", async () => {
    const { get, start, sessions } = await serve();
    const { location, cookie } = await start("/sala/1");
    const back = await get(`/auth/google/callback?state=${location.searchParams.get("state")}&code=codigo-do-google`, cookie);
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("/sala/1");
    const session = back.headers.getSetCookie().find((c) => c.startsWith("nordus_session_test="))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(Number(/Max-Age=(\d+)/.exec(session)![1])).toBeGreaterThan(20 * 24 * 3600);
    expect(sessions.list()).toEqual([expect.objectContaining({ email: "member@example.com", scopes: ["admin", "client"] })]);
    expect(back.headers.getSetCookie().some((c) => c.startsWith(`${LOGIN_BINDING_COOKIE}=;`))).toBe(true);
  });

  it("sends an unlisted account that came through the invite link back with a pending request and no session", async () => {
    const { get, start, sessions, joined, setClaims } = await serve();
    setClaims(goodClaims("novo@gmail.com"));
    const { res, location, cookie } = await start("/", "&convite=convite-valido-123");
    expect(res.headers.get("location")).not.toContain("convite-valido-123");
    const back = await get(`/auth/google/callback?state=${location.searchParams.get("state")}&code=codigo-do-google`, cookie);
    expect(back.headers.get("location")).toBe("/?login_erro=pendente");
    expect(back.headers.getSetCookie().some((c) => c.startsWith("nordus_session_test="))).toBe(false);
    expect(joined).toEqual(["novo@gmail.com"]);
    expect(sessions.list()).toEqual([]);
  });

  it("sends a refused account back to the sign-in page with a reason and no session", async () => {
    const { get, start, sessions, setClaims } = await serve();
    setClaims(goodClaims("outra@gmail.com"));
    const { location, cookie } = await start();
    const back = await get(`/auth/google/callback?state=${location.searchParams.get("state")}&code=codigo-do-google`, cookie);
    expect(back.headers.get("location")).toBe("/?login_erro=nao_permitido");
    expect(back.headers.getSetCookie().some((c) => c.startsWith("nordus_session_test="))).toBe(false);
    expect(sessions.list()).toEqual([]);
  });

  it("locks an address out after repeated failures", async () => {
    const { get } = await serve();
    for (let i = 0; i < 10; i += 1) await get(`/auth/google/callback?state=falso${i}&code=x`);
    const locked = await get("/auth/google");
    expect(locked.headers.get("location")).toBe("/?login_erro=muitas_tentativas");
  });

  it("hands a native app's sign-in back through its own scheme, redeemable only with the app's verifier", async () => {
    const { get, start, sessions } = await serve();
    const verifier = "v".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const { location, cookie } = await start("/", `&cliente=ios&desafio=${challenge}`);
    const back = await get(`/auth/google/callback?state=${location.searchParams.get("state")}&code=codigo-do-google`, cookie);
    const target = back.headers.get("location")!;
    expect(target.startsWith("ai.nordus.app://auth?code=")).toBe(true);
    expect(back.headers.getSetCookie().some((c) => c.startsWith("nordus_session_test="))).toBe(false);
    const code = new URL(target).searchParams.get("code")!;
    const wrong = await get(`/auth/app/troca?code=${code}&verificador=${"x".repeat(43)}`);
    expect(wrong.headers.get("location")).toBe("/?login_erro=expirou");
    expect(sessions.list()).toEqual([]);

    const again = await start("/", `&cliente=ios&desafio=${challenge}`);
    const second = await get(`/auth/google/callback?state=${again.location.searchParams.get("state")}&code=codigo-do-google`, again.cookie);
    const code2 = new URL(second.headers.get("location")!).searchParams.get("code")!;
    expect((await get(`/auth/app/troca?code=${code2}&verificador=${verifier}`, undefined, { "sec-fetch-site": "cross-site" })).headers.get("location")).toBe("/?login_erro=expirou");
    const third = await start("/", `&cliente=ios&desafio=${challenge}`);
    const done = await get(`/auth/google/callback?state=${third.location.searchParams.get("state")}&code=codigo-do-google`, third.cookie);
    const code3 = new URL(done.headers.get("location")!).searchParams.get("code")!;
    const swap = await get(`/auth/app/troca?code=${code3}&verificador=${verifier}`, undefined, { "sec-fetch-site": "none" });
    expect(swap.headers.get("location")).toBe("/");
    expect(swap.headers.getSetCookie().find((c) => c.startsWith("nordus_session_test="))).toMatch(/HttpOnly.*SameSite=Lax/);
    expect(sessions.list()).toEqual([expect.objectContaining({ email: "member@example.com" })]);
    expect((await get(`/auth/app/troca?code=${code3}&verificador=${verifier}`)).headers.get("location")).toBe("/?login_erro=expirou");
  });

  it("refuses an unknown app or a malformed challenge before going to Google", async () => {
    const { get } = await serve();
    expect((await get("/auth/google?cliente=android&desafio=" + "a".repeat(43))).headers.get("location")).toBe("/?login_erro=falhou");
    expect((await get("/auth/google?cliente=ios&desafio=curto")).headers.get("location")).toBe("/?login_erro=falhou");
  });

  it("refuses the old desktop client name so the sign-in never opens the previous app", async () => {
    const { get } = await serve();
    expect((await get("/auth/google?cliente=desktop&desafio=" + "a".repeat(43))).headers.get("location")).toBe("/?login_erro=falhou");
  });

  it("sends a refused app sign-in back to the app with the reason", async () => {
    const { get, start, setClaims } = await serve();
    setClaims(goodClaims("outra@gmail.com"));
    const { location, cookie } = await start("/", `&cliente=rn&desafio=${"a".repeat(43)}`);
    const back = await get(`/auth/google/callback?state=${location.searchParams.get("state")}&code=codigo-do-google`, cookie);
    expect(back.headers.get("location")).toBe("ai.nordus.rn://auth?erro=nao_permitido");
  });

  it("leaves every other path to the app", async () => {
    const { get } = await serve();
    expect((await get("/auth/outra-coisa")).status).toBe(404);
  });
});
