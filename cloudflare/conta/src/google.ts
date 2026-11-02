import type { Env } from "./env";
import { pkceChallenge, sameText } from "./util";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SKEW_S = 120;

export const CALLBACK_PATH = "/google/callback";

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export async function authorizeUrl(env: Env, input: { state: string; nonce: string; verifier: string; loginHint?: string }): Promise<string> {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.ORIGIN}${CALLBACK_PATH}`,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: await pkceChallenge(input.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
    access_type: "online",
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  }).toString();
  return url.toString();
}

function decodeClaims(idToken: string): Record<string, unknown> | null {
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The ID token comes straight from Google's token endpoint over TLS, so its claims are checked, not its signature
 *  (OpenID Connect Core 1.0, section 3.1.3.7, item 6). */
export function identityFromClaims(claims: Record<string, unknown> | null, expected: { clientId: string; nonce: string; nowSeconds: number }): GoogleIdentity | null {
  if (!claims || typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.clientId)) return null;
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < expected.nowSeconds) return null;
  if (typeof claims.nonce !== "string" || !sameText(claims.nonce, expected.nonce)) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email.includes("@") || (claims.email_verified !== true && claims.email_verified !== "true")) return null;
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 80) : null;
  const picture = typeof claims.picture === "string" && claims.picture.startsWith("https://") ? claims.picture.slice(0, 500) : null;
  return { sub: claims.sub, email, name, picture };
}

export async function exchange(env: Env, input: { code: string; verifier: string; nonce: string }): Promise<GoogleIdentity | null> {
  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.ORIGIN}${CALLBACK_PATH}`,
      code_verifier: input.verifier,
    }).toString(),
  });
  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!response.ok || typeof body?.id_token !== "string") return null;
  return identityFromClaims(decodeClaims(body.id_token), { clientId: env.GOOGLE_CLIENT_ID, nonce: input.nonce, nowSeconds: Math.floor(Date.now() / 1000) });
}
