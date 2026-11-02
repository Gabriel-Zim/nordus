export const SESSION_COOKIE = "__Host-nordus_conta";
export const BINDING_COOKIE = "__Host-nordus_login";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const PENDING_TTL_MS = 10 * 60_000;

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacJwt(claims: Record<string, unknown>, key: string): Promise<string> {
  const header = base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64url(signature)}`;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** A form POST from another site carries its own Origin and Sec-Fetch-Site; a page cannot set either. Chrome sends
 *  Origin "null" when the page's referrer policy is no-referrer, so Sec-Fetch-Site decides then. */
export function sameOriginPost(request: Request, origin: string): boolean {
  if (request.method !== "POST") return false;
  const sent = request.headers.get("origin");
  if (sent && sent !== "null") return sent === origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

export function userCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const letters = [...bytes].map((byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]).join("");
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export function normalizeUserCode(value: string | null): string | null {
  const letters = (value ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length !== 8 || [...letters].some((char) => !USER_CODE_ALPHABET.includes(char))) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}
