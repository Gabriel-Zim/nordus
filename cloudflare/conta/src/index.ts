import { CloudflareError, connectorToken, dnsNameTaken, hostname, provision, release, tunnelOnline } from "./cloudflare";
import type { Env } from "./env";
import { authorizeUrl, CALLBACK_PATH, exchange, type GoogleIdentity } from "./google";
import { nameProblem, normalizeName, suggestName, type NameProblem } from "./names";
import { activatedPage, activatePage, authorizePage, errorPage, homeSignedIn, homeSignedOut } from "./pages";
import {
  BINDING_COOKIE,
  clientIp,
  cookie,
  hmacJwt,
  json,
  normalizeUserCode,
  PENDING_TTL_MS,
  pkceChallenge,
  randomToken,
  readCookie,
  redirect,
  sameOriginPost,
  sameText,
  sha256,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  userCode,
} from "./util";

export const SERVER_CALLBACK_PATH = "/auth/google/callback";
const ACTIVATION_TTL_MS = 30 * 60_000;
const CODE_TTL_MS = 60_000;
const ID_TOKEN_TTL_S = 300;
const CREDENTIAL = /^(nordus_install_|nordus_install_)([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const CREDENTIAL_PREFIXES = new Set(["nordus_install_", "nordus_install_"]);
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

interface UserRow { id: string; email: string; name: string | null; picture: string | null }
interface InstallationRow {
  id: string;
  user_id: string;
  name: string;
  machine: string;
  platform: string;
  app_version: string | null;
  credential_lookup: string | null;
  credential_hash: string | null;
  credential_prefix: string;
  tunnel_id: string | null;
  dns_record_id: string | null;
}
interface ActivationRow {
  device_hash: string;
  user_code: string;
  machine: string;
  platform: string;
  app_version: string | null;
  credential_prefix: string;
  status: "pending" | "approved" | "consumed";
  installation_id: string | null;
  expires_at: number;
}
interface ServerLogin { installationId: string; redirectUri: string; state: string; nonce: string; challenge: string }

const now = () => Date.now();

async function rateLimited(env: Env, bucket: string, limit: number, windowMs: number): Promise<boolean> {
  const at = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, hits, window_ends_at) VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET hits = CASE WHEN window_ends_at <= ?3 THEN 1 ELSE hits + 1 END,
       window_ends_at = CASE WHEN window_ends_at <= ?3 THEN ?2 ELSE window_ends_at END
     RETURNING hits`,
  ).bind(bucket, at + windowMs, at).first<{ hits: number }>();
  return (row?.hits ?? 0) > limit;
}

async function currentUser(request: Request, env: Env): Promise<UserRow | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT users.id, users.email, users.name, users.picture FROM web_sessions JOIN users ON users.id = web_sessions.user_id
     WHERE web_sessions.token_hash = ? AND web_sessions.expires_at > ?`,
  ).bind(await sha256(token), now()).first<UserRow>();
}

async function startGoogle(env: Env, kind: "conta" | "servidor", data: unknown, loginHint?: string): Promise<Response> {
  const state = randomToken();
  const binding = randomToken();
  const verifier = randomToken(48);
  const nonce = randomToken();
  await env.DB.prepare(`INSERT INTO google_pending (state_hash, binding_hash, verifier, nonce, kind, data, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256(state), await sha256(binding), verifier, nonce, kind, JSON.stringify(data), now() + PENDING_TTL_MS)
    .run();
  return redirect(await authorizeUrl(env, { state, nonce, verifier, loginHint }), [cookie(BINDING_COOKIE, binding, PENDING_TTL_MS / 1000)]);
}

async function upsertUser(env: Env, identity: GoogleIdentity): Promise<UserRow> {
  const id = `google:${identity.sub}`;
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, created_at, last_login_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(id) DO UPDATE SET email = ?2, name = ?3, picture = ?4, last_login_at = ?5`,
  ).bind(id, identity.email, identity.name, identity.picture, now()).run();
  return { id, email: identity.email, name: identity.name, picture: identity.picture };
}

async function newSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare(`INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(await sha256(token), userId, now() + SESSION_TTL_MS).run();
  return cookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000);
}

function localPath(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  return raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") && raw.length < 300 ? raw : "/";
}

async function issueCode(env: Env, login: ServerLogin, userId: string, cookies: string[] = []): Promise<Response> {
  const code = randomToken();
  await env.DB.prepare(`INSERT INTO auth_codes (code_hash, installation_id, redirect_uri, challenge, nonce, user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256(code), login.installationId, login.redirectUri, login.challenge, login.nonce, userId, now() + CODE_TTL_MS).run();
  const target = new URL(login.redirectUri);
  target.search = new URLSearchParams({ code, state: login.state }).toString();
  return redirect(target.toString(), cookies);
}

async function installationByCredential(env: Env, header: string | null): Promise<InstallationRow | null> {
  const match = CREDENTIAL.exec((header ?? "").replace(/^Bearer\s+/i, "").trim());
  if (!match) return null;
  const row = await env.DB.prepare(`SELECT * FROM installations WHERE credential_lookup = ?`).bind(match[2]).first<InstallationRow>();
  if (!row?.credential_hash || row.credential_prefix !== match[1]) return null;
  return sameText(await sha256(match[3]!), row.credential_hash) ? row : null;
}

async function formOf(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded")) return new URLSearchParams();
  return new URLSearchParams(await request.text());
}

async function jsonOf(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

async function home(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return homeSignedOut("/entrar");
  const { results } = await env.DB.prepare(`SELECT * FROM installations WHERE user_id = ? ORDER BY created_at`).bind(user.id).all<InstallationRow>();
  const servers = await Promise.all(results.map(async (row) => ({
    id: row.id,
    name: row.name,
    host: hostname(env, row.name),
    machine: row.machine,
    platform: row.platform,
    online: row.tunnel_id ? await tunnelOnline(env, row.tunnel_id).catch(() => null) : false,
  })));
  return homeSignedIn(user, servers, Number(env.MAX_PER_ACCOUNT));
}

async function googleCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const state = url.searchParams.get("state") ?? "";
  const stateHash = state ? await sha256(state) : "";
  const pending = stateHash
    ? await env.DB.prepare(`DELETE FROM google_pending WHERE state_hash = ? AND expires_at > ? RETURNING *`).bind(stateHash, now())
      .first<{ binding_hash: string; verifier: string; nonce: string; kind: "conta" | "servidor"; data: string }>()
    : null;
  const clearBinding = cookie(BINDING_COOKIE, "", 0);
  if (!pending) return errorPage("O login expirou", "Comece de novo: o link de entrada vale por 10 minutos.");
  const binding = readCookie(request, BINDING_COOKIE);
  if (!binding || !sameText(await sha256(binding), pending.binding_hash)) {
    return errorPage("O login expirou", "Comece de novo no mesmo navegador em que clicou em Entrar.");
  }
  const data: unknown = JSON.parse(pending.data);
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    if (pending.kind === "servidor") {
      const login = data as ServerLogin;
      const target = new URL(login.redirectUri);
      target.search = new URLSearchParams({ error: "access_denied", state: login.state }).toString();
      return redirect(target.toString(), [clearBinding]);
    }
    return redirect("/", [clearBinding]);
  }
  const identity = await exchange(env, { code, verifier: pending.verifier, nonce: pending.nonce });
  if (!identity) return errorPage("O Google não confirmou o login", "Tente de novo. A conta precisa ter o e-mail verificado.");
  const user = await upsertUser(env, identity);
  const cookies = [clearBinding, await newSession(env, user.id)];
  if (pending.kind === "servidor") return issueCode(env, data as ServerLogin, user.id, cookies);
  return redirect(localPath((data as { volta?: string }).volta), cookies);
}

async function activationByUserCode(env: Env, code: string | null): Promise<ActivationRow | null> {
  const normalized = normalizeUserCode(code);
  if (!normalized) return null;
  return env.DB.prepare(`SELECT * FROM activations WHERE user_code = ? AND expires_at > ?`).bind(normalized, now()).first<ActivationRow>();
}

async function showActivation(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return redirect(`/entrar?volta=${encodeURIComponent(url.pathname + url.search)}`);
  const activation = await activationByUserCode(env, url.searchParams.get("codigo"));
  if (!activation) return errorPage("Código inválido ou vencido", "Rode o instalador (ou nordus login) de novo para ver um código novo. Cada código vale 30 minutos.", 404);
  if (activation.status !== "pending") return errorPage("Este código já foi usado", "Volte para a tela do instalador.");
  const owned = await env.DB.prepare(`SELECT name FROM installations WHERE user_id = ? AND machine = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(user.id, activation.machine).first<{ name: string }>();
  return activatePage({ code: activation.user_code, machine: activation.machine, platform: activation.platform, viewer: user, name: owned?.name ?? suggestName(activation.machine) });
}

async function confirmActivation(request: Request, env: Env): Promise<Response> {
  if (!sameOriginPost(request, env.ORIGIN)) return errorPage("Pedido recusado", "Abra o link do instalador de novo.", 403);
  const user = await currentUser(request, env);
  if (!user) return redirect("/entrar");
  const form = await formOf(request);
  const activation = await activationByUserCode(env, form.get("codigo"));
  if (!activation || activation.status !== "pending") return errorPage("Código inválido ou vencido", "Rode o instalador de novo para ver um código novo.", 404);
  const name = normalizeName(form.get("nome"));
  const retry = (error: string) => activatePage({ code: activation.user_code, machine: activation.machine, platform: activation.platform, viewer: user, name, error });
  if (await rateLimited(env, `nome:${user.id}`, 30, 60 * 60_000)) return retry("Muitas tentativas. Espere alguns minutos.");
  const problem = nameProblem(name);
  if (problem) return retry(NAME_PROBLEM[problem]);

  const existing = await env.DB.prepare(`SELECT * FROM installations WHERE name = ?`).bind(name).first<InstallationRow>();
  if (existing && existing.user_id !== user.id) return retry(NAME_PROBLEM.ocupado);
  let installation = existing;
  try {
    if (!installation) {
      const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM installations WHERE user_id = ?`).bind(user.id).first<{ n: number }>();
      if ((count?.n ?? 0) >= Number(env.MAX_PER_ACCOUNT)) return retry(`Sua conta já tem ${env.MAX_PER_ACCOUNT} endereços. Remova um em ${env.ORIGIN} para liberar.`);
      if (await dnsNameTaken(env, name)) return retry(NAME_PROBLEM.reservado);
      const id = crypto.randomUUID();
      const provisioned = await provision(env, id, name);
      try {
        await env.DB.prepare(
          `INSERT INTO installations (id, user_id, name, machine, platform, app_version, credential_prefix, tunnel_id, dns_record_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, user.id, name, activation.machine, activation.platform, activation.app_version, activation.credential_prefix, provisioned.tunnelId, provisioned.dnsRecordId, now()).run();
      } catch (error) {
        await release(env, provisioned).catch(() => undefined);
        throw error;
      }
      installation = await env.DB.prepare(`SELECT * FROM installations WHERE id = ?`).bind(id).first<InstallationRow>();
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "provision failed", error: error instanceof Error ? error.message : String(error) }));
    if (error instanceof CloudflareError) return retry("Não consegui criar o endereço agora. Tente de novo em um minuto.");
    throw error;
  }
  await env.DB.prepare(`UPDATE activations SET status = 'approved', installation_id = ? WHERE device_hash = ? AND status = 'pending'`)
    .bind(installation!.id, activation.device_hash).run();
  return activatedPage({ id: installation!.id, name, host: hostname(env, name), machine: activation.machine, viewer: user });
}

const NAME_PROBLEM: Record<NameProblem, string> = {
  formato: "Use de 3 a 32 letras minúsculas, números ou hífen, sem hífen no começo ou no fim.",
  reservado: "Esse nome é reservado. Escolha outro.",
  ocupado: "Esse endereço já tem dono. Escolha outro.",
};

/** The name check behind the activation page's field: free, already this person's, or why not. */
async function checkName(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (await rateLimited(env, `checar:${user.id}`, 300, 60 * 60_000)) return json({ ok: false, motivo: "Muitas tentativas. Espere alguns minutos." }, 429);
  const name = normalizeName(url.searchParams.get("n"));
  const problem = nameProblem(name);
  if (problem) return json({ ok: false, motivo: NAME_PROBLEM[problem] });
  const existing = await env.DB.prepare(`SELECT user_id FROM installations WHERE name = ?`).bind(name).first<{ user_id: string }>();
  if (existing) return existing.user_id === user.id ? json({ ok: true, seu: true }) : json({ ok: false, motivo: NAME_PROBLEM.ocupado });
  if (await dnsNameTaken(env, name).catch(() => false)) return json({ ok: false, motivo: NAME_PROBLEM.reservado });
  return json({ ok: true });
}

async function serverState(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  const row = await env.DB.prepare(`SELECT tunnel_id FROM installations WHERE id = ? AND user_id = ?`).bind(url.searchParams.get("id") ?? "", user.id).first<{ tunnel_id: string | null }>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ online: row.tunnel_id ? await tunnelOnline(env, row.tunnel_id).catch(() => false) : false });
}

async function removeInstallation(request: Request, env: Env): Promise<Response> {
  if (!sameOriginPost(request, env.ORIGIN)) return errorPage("Pedido recusado", "Tente de novo pela página da sua conta.", 403);
  const user = await currentUser(request, env);
  if (!user) return redirect("/entrar");
  const id = (await formOf(request)).get("id") ?? "";
  const row = await env.DB.prepare(`SELECT * FROM installations WHERE id = ? AND user_id = ?`).bind(id, user.id).first<InstallationRow>();
  if (row) {
    await release(env, { tunnelId: row.tunnel_id, dnsRecordId: row.dns_record_id });
    await env.DB.prepare(`DELETE FROM installations WHERE id = ?`).bind(row.id).run();
  }
  return redirect("/");
}

async function startActivation(request: Request, env: Env): Promise<Response> {
  if (await rateLimited(env, `ativacao:${clientIp(request)}`, 20, 60 * 60_000)) return json({ error: "rate_limited" }, 429, { "retry-after": "600" });
  const body = await jsonOf(request);
  const machine = text(body.machine, 64) || "Nordus";
  const platform = text(body.platform, 16) || "linux";
  const appVersion = text(body.appVersion, 64) || null;
  const prefix = text(body.credentialPrefix, 32);
  if (!CREDENTIAL_PREFIXES.has(prefix)) return json({ error: "invalid_request" }, 400);
  const deviceCode = randomToken();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = userCode();
    try {
      await env.DB.prepare(
        `INSERT INTO activations (device_hash, user_code, machine, platform, app_version, credential_prefix, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).bind(await sha256(deviceCode), code, machine, platform, appVersion, prefix, now() + ACTIVATION_TTL_MS, now()).run();
      return json({
        deviceCode,
        userCode: code,
        verificationUrl: `${env.ORIGIN}/ativar?codigo=${code}`,
        intervalSeconds: 3,
        expiresInSeconds: ACTIVATION_TTL_MS / 1000,
      });
    } catch (error) {
      if (!String(error).includes("UNIQUE")) throw error;
    }
  }
  return json({ error: "control_plane_unavailable" }, 503);
}

async function pollActivation(request: Request, env: Env): Promise<Response> {
  const deviceCode = text((await jsonOf(request)).deviceCode, 64);
  if (!deviceCode) return json({ error: "invalid_request" }, 400);
  const activation = await env.DB.prepare(`SELECT * FROM activations WHERE device_hash = ?`).bind(await sha256(deviceCode)).first<ActivationRow>();
  if (!activation || activation.expires_at <= now() || activation.status === "consumed") return json({ error: "expired_token" }, 410);
  if (activation.status === "pending") return json({ error: "authorization_pending" }, 428);
  const claimed = await env.DB.prepare(`UPDATE activations SET status = 'consumed' WHERE device_hash = ? AND status = 'approved' RETURNING installation_id`)
    .bind(activation.device_hash).first<{ installation_id: string }>();
  if (!claimed) return json({ error: "expired_token" }, 410);
  const lookup = randomToken(16);
  const secret = randomToken(32);
  const row = await env.DB.prepare(
    `UPDATE installations SET credential_lookup = ?, credential_hash = ?, credential_prefix = ?, machine = ?, platform = ?, app_version = ?, last_seen_at = ?
     WHERE id = ? RETURNING *`,
  ).bind(lookup, await sha256(secret), activation.credential_prefix, activation.machine, activation.platform, activation.app_version, now(), claimed.installation_id)
    .first<InstallationRow>();
  if (!row) return json({ error: "expired_token" }, 410);
  const owner = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(row.user_id).first<{ email: string }>();
  return json({
    installationId: row.id,
    credential: `${activation.credential_prefix}${lookup}.${secret}`,
    address: `https://${hostname(env, row.name)}`,
    email: owner?.email ?? null,
    controlPlane: env.ORIGIN,
  });
}

async function endpoint(request: Request, env: Env): Promise<Response> {
  const row = await installationByCredential(env, request.headers.get("authorization"));
  if (!row) return json({ error: "unauthorized" }, 401);
  const url = `https://${hostname(env, row.name)}`;
  if (request.method === "GET") return json({ endpoint: row.tunnel_id ? { url, status: "ready" } : null });
  if (request.method === "DELETE") {
    await release(env, { tunnelId: row.tunnel_id, dnsRecordId: row.dns_record_id });
    await env.DB.prepare(`UPDATE installations SET tunnel_id = NULL, dns_record_id = NULL WHERE id = ?`).bind(row.id).run();
    return new Response(null, { status: 204 });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const appVersion = text((await jsonOf(request)).appVersion, 64) || row.app_version;
  let tunnelId: string;
  if (row.tunnel_id) tunnelId = row.tunnel_id;
  else {
    const provisioned = await provision(env, row.id, row.name);
    tunnelId = provisioned.tunnelId;
    await env.DB.prepare(`UPDATE installations SET tunnel_id = ?, dns_record_id = ? WHERE id = ?`).bind(provisioned.tunnelId, provisioned.dnsRecordId, row.id).run();
  }
  await env.DB.prepare(`UPDATE installations SET app_version = ?, last_seen_at = ? WHERE id = ?`).bind(appVersion, now(), row.id).run();
  return json({ endpoint: { url, status: "ready" }, connectorToken: await connectorToken(env, tunnelId) });
}

async function authorize(request: Request, env: Env, url: URL): Promise<Response> {
  const q = url.searchParams;
  const installation = await env.DB.prepare(`SELECT * FROM installations WHERE id = ?`).bind(q.get("client_id") ?? "").first<InstallationRow>();
  const expectedRedirect = installation ? `https://${hostname(env, installation.name)}${SERVER_CALLBACK_PATH}` : "";
  if (!installation?.credential_hash || !expectedRedirect || q.get("redirect_uri") !== expectedRedirect) {
    return errorPage("Este Nordus não está conectado", "O endereço não pertence a um Nordus conectado a uma conta. Rode nordus login no servidor.", 400);
  }
  const state = q.get("state") ?? "";
  const nonce = q.get("nonce") ?? "";
  const challenge = q.get("code_challenge") ?? "";
  if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !CHALLENGE.test(challenge) || !state || state.length > 200 || !nonce || nonce.length > 200) {
    return errorPage("Pedido de login inválido", "Volte para o seu Nordus e clique em Entrar com Google de novo.");
  }
  const login: ServerLogin = { installationId: installation.id, redirectUri: expectedRedirect, state, nonce, challenge };
  const user = q.get("trocar") ? null : await currentUser(request, env);
  if (!user) return startGoogle(env, "servidor", login);
  const continueState = randomToken();
  const binding = randomToken();
  await env.DB.prepare(`INSERT INTO google_pending (state_hash, binding_hash, verifier, nonce, kind, data, expires_at) VALUES (?, ?, '', '', 'servidor', ?, ?)`)
    .bind(await sha256(continueState), await sha256(binding), JSON.stringify(login), now() + PENDING_TTL_MS).run();
  const switchUrl = new URL(url);
  switchUrl.searchParams.set("trocar", "1");
  const response = authorizePage({ host: hostname(env, installation.name), name: installation.name, viewer: user, continueToken: continueState, switchHref: switchUrl.pathname + switchUrl.search });
  response.headers.append("set-cookie", cookie(BINDING_COOKIE, binding, PENDING_TTL_MS / 1000));
  return response;
}

async function continueAuthorize(request: Request, env: Env): Promise<Response> {
  if (!sameOriginPost(request, env.ORIGIN)) return errorPage("Pedido recusado", "Volte para o seu Nordus e entre de novo.", 403);
  const user = await currentUser(request, env);
  const state = (await formOf(request)).get("t") ?? "";
  const pending = state
    ? await env.DB.prepare(`DELETE FROM google_pending WHERE state_hash = ? AND kind = 'servidor' AND verifier = '' AND expires_at > ? RETURNING *`)
      .bind(await sha256(state), now()).first<{ binding_hash: string; data: string }>()
    : null;
  const binding = readCookie(request, BINDING_COOKIE);
  if (!user || !pending || !binding || !sameText(await sha256(binding), pending.binding_hash)) {
    return errorPage("O login expirou", "Volte para o seu Nordus e clique em Entrar com Google de novo.");
  }
  return issueCode(env, JSON.parse(pending.data) as ServerLogin, user.id, [cookie(BINDING_COOKIE, "", 0)]);
}

async function token(request: Request, env: Env): Promise<Response> {
  const form = await formOf(request);
  if (form.get("grant_type") !== "authorization_code") return json({ error: "unsupported_grant_type" }, 400);
  const clientId = form.get("client_id") ?? "";
  const installation = await installationByCredential(env, form.get("client_secret"));
  if (!installation || installation.id !== clientId) return json({ error: "invalid_client" }, 401);
  const code = form.get("code") ?? "";
  const row = code
    ? await env.DB.prepare(`DELETE FROM auth_codes WHERE code_hash = ? RETURNING *`).bind(await sha256(code))
      .first<{ installation_id: string; redirect_uri: string; challenge: string; nonce: string; user_id: string; expires_at: number }>()
    : null;
  if (!row || row.expires_at <= now() || row.installation_id !== installation.id || row.redirect_uri !== form.get("redirect_uri")) {
    return json({ error: "invalid_grant" }, 400);
  }
  const verifier = form.get("code_verifier") ?? "";
  if (!verifier || !sameText(await pkceChallenge(verifier), row.challenge)) return json({ error: "invalid_grant" }, 400);
  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(row.user_id).first<UserRow>();
  if (!user) return json({ error: "invalid_grant" }, 400);
  const iat = Math.floor(now() / 1000);
  const idToken = await hmacJwt({
    iss: env.ORIGIN,
    aud: installation.id,
    sub: user.id,
    email: user.email,
    email_verified: true,
    ...(user.name ? { name: user.name } : {}),
    ...(user.picture ? { picture: user.picture } : {}),
    nonce: row.nonce,
    iat,
    exp: iat + ID_TOKEN_TTL_S,
  }, env.ID_TOKEN_KEY);
  return json({ access_token: randomToken(), token_type: "Bearer", expires_in: ID_TOKEN_TTL_S, id_token: idToken });
}

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  if (pathname === "/healthz") return json({ ok: true });
  if (pathname === "/" && method === "GET") return home(request, env);
  if (pathname === "/entrar" && method === "GET") return startGoogle(env, "conta", { volta: localPath(url.searchParams.get("volta")) });
  if (pathname === "/sair" && method === "POST") {
    const token = readCookie(request, SESSION_COOKIE);
    if (token && sameOriginPost(request, env.ORIGIN)) await env.DB.prepare(`DELETE FROM web_sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
    return redirect("/", [cookie(SESSION_COOKIE, "", 0)]);
  }
  if (pathname === CALLBACK_PATH && method === "GET") return googleCallback(request, env, url);
  if (pathname === "/ativar" && method === "GET") return showActivation(request, env, url);
  if (pathname === "/ativar" && method === "POST") return confirmActivation(request, env);
  if (pathname === "/remover" && method === "POST") return removeInstallation(request, env);
  if (pathname === "/api/nome" && method === "GET") return checkName(request, env, url);
  if (pathname === "/api/estado" && method === "GET") return serverState(request, env, url);
  if (pathname === "/oauth/authorize" && method === "GET") return authorize(request, env, url);
  if (pathname === "/oauth/continuar" && method === "POST") return continueAuthorize(request, env);
  if (pathname === "/oauth/token" && method === "POST") return token(request, env);
  if (pathname === "/v1/ativacoes" && method === "POST") return startActivation(request, env);
  if (pathname === "/v1/ativacoes/verificar" && method === "POST") return pollActivation(request, env);
  if (pathname === "/v1/installations/self/endpoint") return endpoint(request, env);
  return json({ error: "not_found" }, 404);
}

async function sweep(env: Env): Promise<void> {
  const at = now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM google_pending WHERE expires_at <= ?`).bind(at),
    env.DB.prepare(`DELETE FROM web_sessions WHERE expires_at <= ?`).bind(at),
    env.DB.prepare(`DELETE FROM activations WHERE expires_at <= ?`).bind(at),
    env.DB.prepare(`DELETE FROM auth_codes WHERE expires_at <= ?`).bind(at),
    env.DB.prepare(`DELETE FROM rate_limits WHERE window_ends_at <= ?`).bind(at),
  ]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(JSON.stringify({ message: "request failed", path: new URL(request.url).pathname, error: error instanceof Error ? error.message : String(error) }));
      return json({ error: "control_plane_unavailable" }, 503);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await sweep(env);
  },
} satisfies ExportedHandler<Env>;
