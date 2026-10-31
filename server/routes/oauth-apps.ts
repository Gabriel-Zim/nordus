import { isOAuthAppProvider, isSignInProvider, startSignIn, type OAuthAppStore } from "../oauth-apps.ts";
import { provesSameOrigin, requestOrigin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** The https address the browser is on, when the request proves it; the platform still accepts only addresses
 *  registered with it, so a forged one fails there. */
export function browserHttpsOrigin(req: Parameters<typeof requestOrigin>[0]): string | null {
  if (!provesSameOrigin(req)) return null;
  const origin = requestOrigin(req);
  return origin?.startsWith("https://") ? origin : null;
}

export interface OAuthAppRouteDeps {
  oauthApps: OAuthAppStore;
  /** The https address sign-ins come back to; null when this server has none. */
  publicOrigin: () => string | null;
}

/** "ID do cliente" and "Segredo" for Nordus's own apps; the secret goes in and never comes back out. */
export function createOAuthAppRoutes({ oauthApps, publicOrigin }: OAuthAppRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/oauth-apps" && method === "GET") {
      return json(res, 200, { apps: oauthApps.list(), callbackOrigin: browserHttpsOrigin(req) ?? publicOrigin() });
    }
    const accountBots = /^\/api\/oauth-apps\/([a-z]+)\/accounts\/([\w-]+)\/bots$/.exec(path);
    if (accountBots && method === "PUT") {
      const provider = accountBots[1]!;
      if (!isOAuthAppProvider(provider)) return json(res, 404, { error: "Unknown app." });
      const body = await readBody(req, 16_384) as { bots?: unknown } | null;
      const bots = body?.bots === null ? null : Array.isArray(body?.bots) && body!.bots.every((id) => typeof id === "string") ? body!.bots as string[] : undefined;
      if (bots === undefined) return json(res, 400, { error: "bots must be a list of bot ids or null" });
      try { oauthApps.setAccountBots(provider, accountBots[2]!, bots); } catch (error) { return json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message }); }
      return json(res, 200, { apps: oauthApps.list() });
    }
    const match = /^\/api\/oauth-apps\/([a-z]+)(\/(connect|disconnect))?$/.exec(path);
    if (!match) return PASS;
    const provider = match[1]!;
    if (!isOAuthAppProvider(provider)) return json(res, 404, { error: "Unknown app." });
    const action = match[3];
    if (!action && method === "PUT") {
      const body = await readBody(req, 8_192) as { clientId?: unknown; clientSecret?: unknown } | null;
      if (typeof body?.clientId !== "string" || !body.clientId.trim()) return json(res, 400, { error: "O ID do cliente é obrigatório." });
      try {
        oauthApps.set(provider, body.clientId, typeof body.clientSecret === "string" ? body.clientSecret : null);
      } catch (error) {
        return json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message });
      }
      return json(res, 200, { apps: oauthApps.list() });
    }
    if (!action && method === "DELETE") {
      oauthApps.remove(provider);
      return json(res, 200, { apps: oauthApps.list() });
    }
    if (action === "connect" && method === "POST") {
      if (!isSignInProvider(provider)) return json(res, 409, { error: "Este app ainda não conecta por aqui." });
      // Come back to the address the person is using (lab.example.com or the tailnet one), else the configured one.
      const origin = browserHttpsOrigin(req) ?? publicOrigin();
      if (!origin) return json(res, 409, { error: "Este servidor não tem um endereço público para o retorno do login." });
      try {
        return json(res, 200, { authorizationUrl: startSignIn(oauthApps, provider, origin) });
      } catch (error) {
        return json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message });
      }
    }
    if (action === "disconnect" && method === "POST") {
      const body = await readBody(req, 4_096).catch(() => null) as { accountId?: unknown } | null;
      if (typeof body?.accountId !== "string") return json(res, 400, { error: "accountId is required" });
      oauthApps.removeAccount(provider, body.accountId);
      return json(res, 200, { apps: oauthApps.list() });
    }
    return PASS;
  };
}
