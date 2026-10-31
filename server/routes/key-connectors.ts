// Apps that connect with a key or token (ManyChat, Figma, Trello): each one is checked against the service
// before it is saved, then sealed in the key vault; bots get a local MCP server per account they may use.
import { randomBytes } from "node:crypto";

import { isKeyApp, type KeyApp, type KeyVault } from "../key-vault.ts";
import { browserHttpsOrigin } from "./oauth-apps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const TRELLO_CALLBACK_PATH = "/oauth/trello/callback";
const TRELLO_STATE_TTL_MS = 10 * 60_000;
const pendingTrello = new Map<string, number>();

export interface KeyConnectorRouteDeps {
  vault: KeyVault;
  /** The https address sign-ins come back to; null when this server has none. */
  publicOrigin: () => string | null;
  /** Called after any account change, so running bots pick it up. */
  onChanged?: () => void;
  fetcher?: typeof fetch;
}

const REFUSED = "O serviço não aceitou essa chave. Confira e tente de novo.";
const UNREACHABLE = "Não deu para falar com o serviço agora. Tente de novo.";

const FIELDS: Record<KeyApp, string[]> = { manychat: ["apiKey"], figma: ["token"], trello: ["token"] };

/** The account name the service reports for these keys, or the refusal to show. */
async function check(app: KeyApp, fields: Record<string, string>, trelloKey: string | null, fetcher: typeof fetch): Promise<{ label: string } | { error: string }> {
  try {
    if (app === "manychat") {
      const response = await fetcher("https://api.manychat.com/fb/page/getInfo", { headers: { authorization: `Bearer ${fields.apiKey}`, accept: "application/json" } });
      if (!response.ok) return { error: REFUSED };
      const body = await response.json().catch(() => null) as { data?: { name?: string } } | null;
      return { label: body?.data?.name ?? "ManyChat" };
    }
    if (app === "figma") {
      const response = await fetcher("https://api.figma.com/v1/me", { headers: { "X-Figma-Token": fields.token!, accept: "application/json" } });
      if (response.status === 403) return { error: "O Figma aceitou o token, mas falta a permissão de ler o perfil. Gere outro marcando as duas permissões indicadas." };
      if (!response.ok) return { error: "O Figma não aceitou esse token. Confira e tente de novo." };
      const body = await response.json().catch(() => null) as { handle?: string; email?: string } | null;
      return { label: body?.email ?? body?.handle ?? "Figma" };
    }
    if (!trelloKey) return { error: "O Trello ainda não foi preparado na Nordus." };
    const response = await fetcher("https://api.trello.com/1/members/me?fields=username,fullName", {
      headers: { authorization: `OAuth oauth_consumer_key="${trelloKey}", oauth_token="${fields.token}"`, accept: "application/json" },
    });
    if (!response.ok) return { error: "O Trello não confirmou a conexão. Tente de novo." };
    const body = await response.json().catch(() => null) as { username?: string; fullName?: string } | null;
    return { label: body?.username ?? body?.fullName ?? "Trello" };
  } catch {
    return { error: UNREACHABLE };
  }
}

function takeTrelloState(state: string): boolean {
  const now = Date.now();
  for (const [key, expires] of pendingTrello) if (expires < now) pendingTrello.delete(key);
  const found = pendingTrello.has(state);
  pendingTrello.delete(state);
  return found;
}

/** Trello hands the token back in the URL fragment, so this page reads it in the browser and posts it here once. */
const TRELLO_PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trello</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#e8eaed;font:15px/1.5 Inter,system-ui,sans-serif}p{max-width:360px;text-align:center}</style></head>
<body><p id="m">Conectando o Trello…</p><script>
(function(){var h=new URLSearchParams(location.hash.slice(1)),q=new URLSearchParams(location.search),m=document.getElementById("m");
history.replaceState(null,"",location.pathname);
var token=h.get("token")||"";if(!token){m.textContent="O Trello não foi conectado. Volte para a Nordus e tente de novo.";return;}
fetch(location.pathname,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({state:q.get("state")||"",token:token})})
.then(function(r){return r.json().catch(function(){return{}}).then(function(b){m.textContent=r.ok?"Trello conectado. Pode fechar esta aba e voltar para a Nordus.":(b.error||"Não deu para concluir a conexão. Volte para a Nordus e tente de novo.");});})
.catch(function(){m.textContent="Não deu para concluir a conexão. Volte para a Nordus e tente de novo.";});})();
</script></body></html>`;

export function createKeyConnectorRoutes({ vault, publicOrigin, onChanged, fetcher = fetch }: KeyConnectorRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/key-connectors" && method === "GET") return json(res, 200, vault.list());

    if (path === "/api/key-connectors/trello/key" && method === "PUT") {
      const body = await readBody(req, 4_096) as { key?: unknown } | null;
      const key = typeof body?.key === "string" ? body.key.trim() : "";
      if (key && !/^[0-9a-f]{32}$/i.test(key)) return json(res, 400, { error: "Essa não parece uma chave da API do Trello. Ela tem 32 letras e números." });
      vault.setTrelloKey(key || null);
      onChanged?.();
      return json(res, 200, vault.list());
    }

    if (path === "/api/key-connectors/trello/connect" && method === "POST") {
      const key = vault.trelloKey();
      if (!key) return json(res, 409, { error: "O Trello ainda não foi preparado na Nordus." });
      const origin = browserHttpsOrigin(req) ?? publicOrigin();
      if (!origin) return json(res, 409, { error: "Este servidor não tem um endereço público para o retorno do login." });
      const state = randomBytes(24).toString("base64url");
      pendingTrello.set(state, Date.now() + TRELLO_STATE_TTL_MS);
      const target = new URL("https://trello.com/1/authorize");
      target.search = new URLSearchParams({
        expiration: "never",
        name: "Nordus AI",
        scope: "read,write",
        response_type: "token",
        key,
        callback_method: "fragment",
        return_url: `${origin}${TRELLO_CALLBACK_PATH}?state=${state}`,
      }).toString();
      return json(res, 200, { authorizationUrl: target.toString() });
    }

    const accountBots = /^\/api\/key-connectors\/([a-z]+)\/accounts\/([\w-]+)\/bots$/.exec(path);
    if (accountBots && method === "PUT") {
      const app = accountBots[1]!;
      if (!isKeyApp(app)) return json(res, 404, { error: "App desconhecido." });
      const body = await readBody(req, 16_384) as { bots?: unknown } | null;
      const bots = body?.bots === null ? null : Array.isArray(body?.bots) && body!.bots.every((id) => typeof id === "string") ? body!.bots as string[] : undefined;
      if (bots === undefined) return json(res, 400, { error: "bots must be a list of bot ids or null" });
      try { vault.setAccountBots(app, accountBots[2]!, bots); } catch (error) { return json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message }); }
      onChanged?.();
      return json(res, 200, vault.list());
    }

    const account = /^\/api\/key-connectors\/([a-z]+)\/accounts\/([\w-]+)$/.exec(path);
    if (account && method === "DELETE") {
      const app = account[1]!;
      if (!isKeyApp(app)) return json(res, 404, { error: "App desconhecido." });
      vault.removeAccount(app, account[2]!);
      onChanged?.();
      return json(res, 200, vault.list());
    }

    const match = /^\/api\/key-connectors\/([a-z]+)$/.exec(path);
    if (!match || method !== "POST") return PASS;
    const app = match[1]!;
    if (!isKeyApp(app) || app === "trello") return json(res, 404, { error: "App desconhecido." });
    const body = await readBody(req, 8_192) as Record<string, unknown> | null;
    const fields = Object.fromEntries(FIELDS[app].map((key) => [key, typeof body?.[key] === "string" ? (body[key] as string).trim() : ""]));
    if (Object.values(fields).some((value) => !value)) return json(res, 400, { error: "Preencha todos os campos." });
    const checked = await check(app, fields, null, fetcher);
    if ("error" in checked) return json(res, 400, { error: checked.error });
    vault.addAccount(app, fields, checked.label);
    onChanged?.();
    return json(res, 200, vault.list());
  };
}

/** Public, like the other sign-in returns: the one-time state is the credential. */
export async function trelloCallback(vault: KeyVault, method: string, readJson: () => Promise<unknown>, fetcher: typeof fetch = fetch): Promise<{ status: number; type: "html" | "json"; body: string }> {
  if (method === "GET") return { status: 200, type: "html", body: TRELLO_PAGE };
  if (method !== "POST") return { status: 405, type: "json", body: JSON.stringify({ error: "Método não aceito." }) };
  const body = await readJson().catch(() => null) as { state?: unknown; token?: unknown } | null;
  const state = typeof body?.state === "string" ? body.state : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!state || !token || !takeTrelloState(state)) {
    return { status: 400, type: "json", body: JSON.stringify({ error: "Esse pedido de conexão venceu. Volte para a Nordus e clique em Conectar de novo." }) };
  }
  const checked = await check("trello", { token }, vault.trelloKey(), fetcher);
  if ("error" in checked) return { status: 400, type: "json", body: JSON.stringify({ error: checked.error }) };
  vault.addAccount("trello", { token }, checked.label);
  return { status: 200, type: "json", body: JSON.stringify({ ok: true }) };
}
