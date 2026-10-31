// The public /auth/* routes of Nordus's own sign-in page: a session cookie for the browser, a bearer token for the apps.
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  APP_CALLBACKS,
  clearBindingCookie,
  parseAppHandoff,
  type AppCodes,
  type AppHandoff,
  LOGIN_BINDING_COOKIE,
  LOGIN_CALLBACK_PATH,
  LOGIN_START_PATH,
  LOGIN_STATUS_PATH,
  serializeBindingCookie,
  type GoogleLogin,
} from "./google-login.ts";
import type { LoginRefusal } from "../shared/nordus-login.ts";
import type { EnvironmentDescriptor } from "./environment.ts";
import { readBody } from "./harness/http.ts";
import { deviceLabel, isLoopbackHost, labelFromUserAgent, parseCookies, requestOrigin, requestSource, serializeSessionCookie } from "./request-auth.ts";
import { cookieMaxAgeSeconds, type PublicSession, type Scope, type SessionRegistry } from "./sessions.ts";

export interface LoginRouteDeps {
  login: GoogleLogin;
  sessions: SessionRegistry;
  sessionCookie: string;
  appCodes: AppCodes;
  /** The same server description `/api/auth/pair` reports. */
  environment: () => EnvironmentDescriptor;
}

export const APP_EXCHANGE_PATH = "/auth/app/troca";
export const APP_TOKEN_PATH = "/auth/app/token";

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-frame-options": "DENY" } as const;

function appLocation(app: AppHandoff, params: Record<string, string>): string {
  return `${APP_CALLBACKS[app.client]}?${new URLSearchParams(params).toString()}`;
}

/** The body both `/api/auth/pair` and `POST /auth/app/token` answer with; apps decode it as one shape. */
export function appSessionBody(issued: { token: string; session: PublicSession }, environment: EnvironmentDescriptor) {
  return { token: issued.token, session: issued.session, environment };
}

function appAnswer(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { ...NO_STORE, "content-type": "application/json" });
  res.end(JSON.stringify(body));
  return true;
}

/** Where Google sends the person back: this server's own https address (loopback http only for local checks). */
export function loginRedirectUri(req: IncomingMessage): string | null {
  const origin = requestOrigin(req);
  if (!origin) return null;
  const { protocol, hostname } = new URL(origin);
  if (protocol === "https:" || isLoopbackHost(hostname)) return `${origin}${LOGIN_CALLBACK_PATH}`;
  return null;
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []): true {
  res.writeHead(302, { ...NO_STORE, location, ...(cookies.length ? { "set-cookie": cookies } : {}) });
  res.end();
  return true;
}

export function refusalLocation(reason: LoginRefusal, returnTo = "/"): string {
  const target = new URL(returnTo, "http://nordus.invalid");
  target.searchParams.set("login_erro", reason);
  return `${target.pathname}${target.search}`;
}

export async function handleLoginRoutes(req: IncomingMessage, res: ServerResponse, path: string, method: string, url: URL, deps: LoginRouteDeps): Promise<boolean> {
  if (!path.startsWith("/auth/")) return false;
  const secure = requestOrigin(req)?.startsWith("https://") === true;

  if (path === LOGIN_STATUS_PATH && method === "GET") {
    res.writeHead(200, { ...NO_STORE, "content-type": "application/json" });
    res.end(JSON.stringify({ google: deps.login.enabled() }));
    return true;
  }

  if (path === LOGIN_START_PATH && method === "GET") {
    const source = requestSource(req);
    if (!deps.sessions.attemptAllowed(source).ok) return redirect(res, refusalLocation("muitas_tentativas"));
    const redirectUri = loginRedirectUri(req);
    if (!redirectUri) return redirect(res, refusalLocation("falhou"));
    const app = parseAppHandoff(url.searchParams.get("cliente"), url.searchParams.get("desafio"));
    if (app === "invalid") return redirect(res, refusalLocation("falhou"));
    const started = deps.login.begin({ redirectUri, returnTo: url.searchParams.get("voltar"), app, join: url.searchParams.get("convite") });
    if (!started.ok) return redirect(res, refusalLocation(started.reason));
    return redirect(res, started.url, [serializeBindingCookie(started.binding, secure)]);
  }

  if (path === LOGIN_CALLBACK_PATH && method === "GET") {
    const source = requestSource(req);
    const cookies = parseCookies(req.headers.cookie);
    const spent = clearBindingCookie(secure);
    if (!deps.sessions.attemptAllowed(source).ok) return redirect(res, refusalLocation("muitas_tentativas"), [spent]);
    const finished = await deps.login.finish({ query: url.searchParams, binding: cookies.get(LOGIN_BINDING_COOKIE) });
    if (!finished.ok) {
      if (finished.countsAsFailure) deps.sessions.noteFailure(source);
      console.warn(`google login refused from ${source}: ${finished.reason}`);
      return redirect(res, finished.app ? appLocation(finished.app, { erro: finished.reason }) : refusalLocation(finished.reason, finished.returnTo), [spent]);
    }
    deps.sessions.clearFailures(source);
    if (finished.app) {
      const code = deps.appCodes.issue({ email: finished.email, subject: finished.subject, scopes: finished.scopes, name: finished.name, picture: finished.picture }, finished.app.challenge);
      return redirect(res, appLocation(finished.app, { code }), [spent]);
    }
    return redirect(res, finished.returnTo, [spent, signIn(req, deps, cookies, finished, secure, source)]);
  }

  if (path === APP_EXCHANGE_PATH && method === "GET") {
    const source = requestSource(req);
    // Only the app's own top-level load: a page on another site must not plant someone else's session here.
    const site = String(req.headers["sec-fetch-site"] ?? "none").toLowerCase();
    if (site === "cross-site" || site === "same-site") return redirect(res, refusalLocation("expirou"));
    if (!deps.sessions.attemptAllowed(source).ok) return redirect(res, refusalLocation("muitas_tentativas"));
    const grant = deps.appCodes.redeem(url.searchParams.get("code") ?? "", url.searchParams.get("verificador") ?? "");
    if (!grant) {
      deps.sessions.noteFailure(source);
      return redirect(res, refusalLocation("expirou"));
    }
    deps.sessions.clearFailures(source);
    return redirect(res, "/", [signIn(req, deps, parseCookies(req.headers.cookie), grant, secure, source)]);
  }

  if (path === APP_TOKEN_PATH && method === "POST") {
    // JSON only, like the pairing routes: an HTML form on another site cannot send this content type without a preflight.
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return appAnswer(res, 415, { error: "send the app sign-in as JSON (content-type: application/json)" });
    }
    const source = requestSource(req);
    const allowed = deps.sessions.attemptAllowed(source);
    if (!allowed.ok) return appAnswer(res, 429, { error: `too many failed sign-in attempts from your address; try again in ${Math.ceil(allowed.retryAfterMs / 1000)}s` });
    let body: unknown;
    try {
      body = await readBody(req, 4_096);
    } catch (error) {
      const tooLarge = (error as { status?: number }).status === 413;
      return appAnswer(res, tooLarge ? 413 : 400, { error: tooLarge ? "body too large" : "invalid JSON body" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return appAnswer(res, 400, { error: "send the code and the verifier" });
    const fields = body as Record<string, unknown>;
    const grant = deps.appCodes.redeem(
      typeof fields.code === "string" ? fields.code : "",
      typeof fields.verificador === "string" ? fields.verificador : "",
    );
    if (!grant) {
      deps.sessions.noteFailure(source);
      console.warn(`google app sign-in refused from ${source}: expirou`);
      return appAnswer(res, 401, { error: "this sign-in has expired or was already used" });
    }
    deps.sessions.clearFailures(source);
    const issued = deps.sessions.issue({
      label: deviceLabel(typeof fields.label === "string" ? fields.label : "", req.headers["user-agent"]),
      scopes: grant.scopes,
      userId: `google:${grant.subject}`,
      email: grant.email,
      name: grant.name ?? undefined,
      picture: grant.picture ?? undefined,
    });
    console.warn(`google app sign-in: ${grant.email} signed in from ${source}`);
    return appAnswer(res, 200, appSessionBody(issued, deps.environment()));
  }

  return false;
}

/** A new sign-in in this browser replaces its previous session instead of leaving it alive beside it. */
function signIn(
  req: IncomingMessage,
  deps: LoginRouteDeps,
  cookies: Map<string, string>,
  who: { email: string; subject: string; scopes: Scope[]; name?: string | null; picture?: string | null },
  secure: boolean,
  source: string,
): string {
  const previous = deps.sessions.authenticate(cookies.get(deps.sessionCookie));
  if (previous) deps.sessions.revoke(previous.id);
  const issued = deps.sessions.issue({ label: labelFromUserAgent(req.headers["user-agent"]), scopes: who.scopes, userId: `google:${who.subject}`, email: who.email, name: who.name ?? undefined, picture: who.picture ?? undefined });
  console.warn(`google login: ${who.email} signed in from ${source}`);
  return serializeSessionCookie(deps.sessionCookie, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) });
}
