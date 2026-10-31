// Chaveiro, owner only. GET /api/keychain lists sites (never the sign-ins); POST /api/keychain/sign-in {url} opens a browser of
// its own for the person to sign in, viewed at /api/bots/<login id>/browser/live; POST /api/keychain/sign-in/<id>/done keeps
// that site's sign-in, /cancel drops it. PATCH /api/keychain/<id> {name?, bots?}; DELETE /api/keychain/<id> signs every bot out.
import type { PublicKeychainEntry } from "../keychain.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface KeychainSignIn { id: string; url: string; site: string }

export interface KeychainRouteDeps {
  list(): PublicKeychainEntry[];
  startSignIn(url: string, owner: string): Promise<KeychainSignIn>;
  finishSignIn(id: string, owner: string, name?: string): Promise<PublicKeychainEntry>;
  cancelSignIn(id: string, owner: string): Promise<void>;
  update(id: string, patch: { name?: string; bots?: string[] }): Promise<PublicKeychainEntry | null>;
  remove(id: string): Promise<{ entry: PublicKeychainEntry; failed: string[] } | null>;
  botExists(id: string): boolean;
}

const ENTRY = /^[a-z0-9]{12}$/u;
const SIGN_IN = /^chaveiro-[a-f0-9]{16}$/u;

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function keychainHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const text = value.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function createKeychainRoutes(deps: KeychainRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/keychain")) return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Só o dono da Nordus mexe no Chaveiro." });
    res.setHeader("cache-control", "no-store");
    const owner = auth.kind === "session" ? auth.session.id : "local-owner";
    const jsonBody = async (limit = 8192) => {
      const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
      if (mediaType !== "application/json") return null;
      const body = await readBody(req, limit);
      return body && typeof body === "object" ? body as Record<string, unknown> : null;
    };

    if (path === "/api/keychain" && method === "GET") return json(res, 200, { entries: deps.list() });

    if (path === "/api/keychain/sign-in" && method === "POST") {
      const body = await jsonBody();
      const url = keychainHttpUrl(body?.url);
      if (!url) return json(res, 400, { error: "Digite o endereço do site, por exemplo instagram.com." });
      try { return json(res, 200, await deps.startSignIn(url, owner)); }
      catch (error) { return json(res, 503, { error: message(error, "Não deu para abrir o navegador agora. Tente de novo.") }); }
    }

    const signIn = /^\/api\/keychain\/sign-in\/([\w-]+)\/(done|cancel)$/u.exec(path);
    if (signIn && method === "POST") {
      if (!SIGN_IN.test(signIn[1]!)) return json(res, 404, { error: "Esse login já foi fechado." });
      if (signIn[2] === "cancel") {
        await deps.cancelSignIn(signIn[1]!, owner).catch(() => undefined);
        return json(res, 200, { ok: true });
      }
      const body = await jsonBody();
      const name = typeof body?.name === "string" ? body.name.slice(0, 60) : undefined;
      try { return json(res, 200, { entry: await deps.finishSignIn(signIn[1]!, owner, name) }); }
      catch (error) { return json(res, 409, { error: message(error, "Não deu para guardar o login. Tente de novo.") }); }
    }

    const entry = /^\/api\/keychain\/([\w-]+)$/u.exec(path);
    if (entry && ENTRY.test(entry[1]!)) {
      if (method === "PATCH") {
        const body = await jsonBody();
        if (!body) return json(res, 400, { error: "Pedido inválido." });
        const patch: { name?: string; bots?: string[] } = {};
        if (body.name !== undefined) {
          if (typeof body.name !== "string" || !body.name.trim()) return json(res, 400, { error: "Dê um nome ao site." });
          patch.name = body.name;
        }
        if (body.bots !== undefined) {
          if (!Array.isArray(body.bots) || body.bots.length > 500 || !body.bots.every((id) => typeof id === "string" && deps.botExists(id))) {
            return json(res, 400, { error: "Um dos robôs não existe mais." });
          }
          patch.bots = body.bots as string[];
        }
        const updated = await deps.update(entry[1]!, patch);
        return updated ? json(res, 200, { entry: updated }) : json(res, 404, { error: "Esse site não está mais no Chaveiro." });
      }
      if (method === "DELETE") {
        const removed = await deps.remove(entry[1]!);
        return removed ? json(res, 200, removed) : json(res, 404, { error: "Esse site não está mais no Chaveiro." });
      }
    }
    return json(res, 404, { error: "not found" });
  };
}
