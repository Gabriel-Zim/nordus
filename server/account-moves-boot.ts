// Wires account moves into the server: the store gives the robots, and a model change goes through the very same
// `PATCH /api/bots/:id` handler a person's request would reach (same checks, same events), called in-process.
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { join } from "node:path";

import type { MoveSelection } from "../shared/account-moves.ts";
import { AccountMoves, type ApplyModelResult } from "./account-moves.ts";
import { json, readBody } from "./harness/http.ts";
import { createAccountMoveRoutes } from "./routes/account-moves.ts";
import { dispatchRoutes, type RouteHandler } from "./routes/table.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { Store } from "./store.ts";

/** Runs one request through the route table as the local owner and returns what the handler answered. */
export async function dispatchInProcess(
  routes: readonly RouteHandler[],
  method: string,
  path: string,
  body: unknown,
  /** Runs once the request exists, before routing; the server uses it to record the admin audit like a normal request. */
  before?: (req: IncomingMessage, res: ServerResponse, auth: RequestAuth) => void,
): Promise<{ status: number; body: any }> {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = path;
  req.headers = { host: "127.0.0.1", "content-type": "application/json" };
  req.push(Buffer.from(JSON.stringify(body)));
  req.push(null);
  const res = new ServerResponse(req);
  let status = 200;
  const chunks: Buffer[] = [];
  res.writeHead = ((code: number) => { status = code; return res; }) as typeof res.writeHead;
  res.end = ((chunk?: unknown) => {
    if (chunk) chunks.push(Buffer.from(chunk as string | Uint8Array));
    return res;
  }) as typeof res.end;
  const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  before?.(req, res, auth);
  const answered = await dispatchRoutes(routes, {
    req, res, url: new URL(path, "http://127.0.0.1"), path, method, auth, json, readBody,
  });
  if (!answered) return { status: 404, body: { error: "no route" } };
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return { status, body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { status, body: { error: raw } };
  }
}

export interface AccountMovesBoot {
  store: Pick<Store, "bot">;
  /** A robot taking part in a room turn is busy even when its own flag is off. */
  activeGroupTurnForBot(botId: string): unknown;
  dataDir: string;
  /** True during a workspace backup or restore. */
  maintenance(): boolean;
  /** Records a model change in the admin activity log. */
  audit(req: IncomingMessage, res: ServerResponse, method: string, path: string, auth: RequestAuth): void;
  routes: readonly RouteHandler[];
}

/** Builds the manager, starts its retry timer, and returns the route module to push on ROUTES. */
export function startAccountMoves(boot: AccountMovesBoot): RouteHandler {
  const moves = new AccountMoves({
    file: join(boot.dataDir, "account-moves.json"),
    maintenance: boot.maintenance,
    bot: (id) => {
      const bot = boot.store.bot(id);
      return bot ? { id: bot.id, name: bot.name, busy: Boolean(bot.busy || boot.activeGroupTurnForBot(bot.id)), modelSelection: bot.modelSelection } : null;
    },
    applyModel: async (botId: string, selection: MoveSelection): Promise<ApplyModelResult> => {
      const reply = await dispatchInProcess(boot.routes, "PATCH", `/api/bots/${encodeURIComponent(botId)}`, {
        modelSelection: selection,
        requireAvailableModel: true,
      }, (req, res, auth) => boot.audit(req, res, "PATCH", `/api/bots/${encodeURIComponent(botId)}`, auth));
      if (reply.status >= 200 && reply.status < 300) return { ok: true };
      const error = reply.body?.error;
      return { ok: false, status: reply.status, error: typeof error === "string" ? error : `HTTP ${reply.status}` };
    },
  });
  moves.start();
  return createAccountMoveRoutes({ moves });
}
