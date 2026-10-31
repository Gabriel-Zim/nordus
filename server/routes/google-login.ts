import { LOGIN_CALLBACK_PATH, type GoogleLoginStore } from "../google-login.ts";
import { browserHttpsOrigin } from "./oauth-apps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface GoogleLoginRouteDeps {
  store: GoogleLoginStore;
  publicOrigin: () => string | null;
  /** False on a hosted workspace or a Cloud home, whose people sign in elsewhere. */
  available: boolean;
}

/** Settings → Pessoas: the sign-in client's id and secret. Admin only (no CLIENT_ALLOW entry); the secret never comes back. */
export function createGoogleLoginRoutes({ store, publicOrigin, available }: GoogleLoginRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== "/api/google-login") return PASS;
    if (!available) return json(res, 404, { error: "O login com Google não existe neste tipo de servidor." });
    const origin = browserHttpsOrigin(req) ?? publicOrigin();
    const view = () => ({ ...store.status(), redirectUri: origin ? `${origin}${LOGIN_CALLBACK_PATH}` : null });
    if (method === "GET") return json(res, 200, view());
    if (method === "PUT") {
      const body = await readBody(req, 8_192) as { clientId?: unknown; clientSecret?: unknown } | null;
      if (typeof body?.clientId !== "string" || !body.clientId.trim()) return json(res, 400, { error: "O ID do cliente é obrigatório." });
      try {
        store.set(body.clientId, typeof body.clientSecret === "string" ? body.clientSecret : null);
      } catch (error) {
        return json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message });
      }
      return json(res, 200, view());
    }
    if (method === "DELETE") {
      store.remove();
      return json(res, 200, view());
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
