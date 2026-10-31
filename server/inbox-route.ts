// Nordus: the email Worker and the client portal ask here what an incoming message is. Its own bearer (env
// NORDUS_INBOX_TOKEN, else DATA_DIR/inbox-token, made on first start with mode 0600); never a person's session.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { z } from "zod";

import type { Decider } from "./decider/index.ts";
import { triageInbox, type DispatchMember } from "./decider/nordus-uses.ts";

export const INBOX_TRIAGE_PATH = "/api/nordus/inbox/triage";
const TOKEN_FILE = "inbox-token";
const MIN_TOKEN = 32;

export function inboxToken(dataDir: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.NORDUS_INBOX_TOKEN?.trim();
  if (fromEnv) return fromEnv.length >= MIN_TOKEN ? fromEnv : null;
  const path = join(dataDir, TOKEN_FILE);
  try {
    if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("base64url") + "\n", { mode: 0o600, flag: "wx" });
    const token = readFileSync(path, "utf8").trim();
    return token.length >= MIN_TOKEN ? token : null;
  } catch {
    return null;
  }
}

const body = z.object({
  from: z.string().trim().min(1).max(500),
  to: z.string().trim().max(500).optional(),
  subject: z.string().max(1_000).default(""),
  text: z.string().max(50_000).default(""),
  source: z.enum(["email", "portal"]).default("email"),
  /** Bot ids that may take it; absent is every active bot. */
  bots: z.array(z.string().min(1).max(128)).max(50).optional(),
});

export type InboxTriageResponse =
  | { ok: true; category: "important" | "newsletter" | "spam" | "bot" | "unsure"; botId?: string; botName?: string; confidence: number; decidedBy: "jev" }
  | { ok: false; reason: "off" | "unavailable" };

export interface InboxRouteDeps {
  dataDir: string;
  ready(source: "email" | "portal"): boolean;
  decider: Pick<Decider, "choose" | "score" | "yesNo">;
  bots(): Array<DispatchMember & { hidden?: boolean }>;
  readBody(req: IncomingMessage, limit?: number): Promise<any>;
  json(res: ServerResponse, status: number, value: unknown): unknown;
}

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? "" : String(header ?? "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

/** Returns false when the path is not this route. */
export async function handleInboxTriage(req: IncomingMessage, res: ServerResponse, path: string, deps: InboxRouteDeps): Promise<boolean> {
  if (path !== INBOX_TRIAGE_PATH) return false;
  if (req.method !== "POST") {
    deps.json(res, 405, { error: "POST only" });
    return true;
  }
  const expected = inboxToken(deps.dataDir);
  const presented = Buffer.from(bearer(req));
  if (!expected || presented.length !== Buffer.byteLength(expected) || !timingSafeEqual(presented, Buffer.from(expected))) {
    deps.json(res, 401, { error: "unauthorized" });
    return true;
  }
  const parsed = body.safeParse(await deps.readBody(req, 64 * 1024).catch(() => null));
  if (!parsed.success) {
    deps.json(res, 400, { error: "Send from, subject and text (plain), optionally to, source (email or portal) and bots (ids)." });
    return true;
  }
  res.setHeader("cache-control", "no-store");
  if (!deps.ready(parsed.data.source)) {
    deps.json(res, 200, { ok: false, reason: "off" } satisfies InboxTriageResponse);
    return true;
  }
  const allowed = parsed.data.bots ? new Set(parsed.data.bots) : null;
  const bots = deps.bots().filter((bot) => !bot.hidden && (!allowed || allowed.has(bot.id)));
  const { bots: _ids, ...item } = parsed.data;
  const verdict = await triageInbox(deps.decider, { item, bots });
  if (!verdict) {
    deps.json(res, 200, { ok: false, reason: "unavailable" } satisfies InboxTriageResponse);
    return true;
  }
  const bot = verdict.botId ? bots.find((candidate) => candidate.id === verdict.botId) : undefined;
  deps.json(res, 200, {
    ok: true,
    category: verdict.category,
    ...(bot ? { botId: bot.id, botName: bot.name } : {}),
    confidence: Math.round(verdict.probability * 100) / 100,
    decidedBy: "jev",
  } satisfies InboxTriageResponse);
  return true;
}
