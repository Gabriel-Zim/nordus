// Nordus: approve or decline from the phone's banner. A banner carries a token that is good for one tap, by one person,
// on one approval, for a short while, and the server checks all of that before it lets the tap decide anything.
import { createHash, randomBytes } from "node:crypto";
import { approvalId, decidableOutsideCard, type ApprovalItem } from "../shared/approvals.ts";
import type { Notification } from "../shared/notification.ts";
import { ADMINS } from "./approval-decider.ts";
import type { PushDecoration } from "./web-push.ts";

/** Long enough to tap a banner that sat on a locked phone for a while; short enough that a lost one is worthless. */
export const ACTION_TOKEN_TTL_MS = 30 * 60_000;
const MAX_TOKENS = 2_000;

export type TokenVerdict = "ok" | "unknown" | "expired" | "wrong-person" | "wrong-approval";

interface TokenRecord {
  approvalId: string;
  owner: string;
  expiresAt: number;
}

export interface ActionTokens {
  issue(input: { approvalId: string; owner: string }): string;
  /** Spends the token: it works once, whatever the answer. */
  consume(token: string, input: { approvalId: string; owner: string }): TokenVerdict;
  readonly size: number;
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export function createActionTokens(options: { ttlMs?: number; now?: () => number } = {}): ActionTokens {
  const ttl = options.ttlMs ?? ACTION_TOKEN_TTL_MS;
  const now = options.now ?? Date.now;
  const records = new Map<string, TokenRecord>();

  function prune(at: number): void {
    for (const [key, record] of records) if (record.expiresAt <= at) records.delete(key);
    while (records.size >= MAX_TOKENS) {
      const oldest = records.keys().next().value;
      if (oldest === undefined) break;
      records.delete(oldest);
    }
  }

  return {
    issue({ approvalId: approval, owner }) {
      const at = now();
      prune(at);
      const token = randomBytes(24).toString("base64url");
      records.set(digest(token), { approvalId: approval, owner, expiresAt: at + ttl });
      return token;
    },
    consume(token, { approvalId: approval, owner }) {
      const key = digest(token);
      const record = records.get(key);
      if (!record) return "unknown";
      records.delete(key);
      if (record.expiresAt <= now()) return "expired";
      if (record.owner !== owner) return "wrong-person";
      if (record.approvalId !== approval) return "wrong-approval";
      return "ok";
    },
    get size() {
      return records.size;
    },
  };
}

export function ownerOfRequest(auth: { kind: "loopback" } | { kind: "session"; session: { id: string } }): string {
  return auth.kind === "session" ? auth.session.id : "loopback";
}

export function askedPhrase(decider: string, asked: { you: boolean }): string {
  if (asked.you) return "Pediu a você.";
  if (decider === ADMINS) return "Pediu aos administradores.";
  return `Pediu a ${decider}.`;
}

function firstSentences(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const cut = flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
  return /[.!?…]$/.test(cut) ? cut : `${cut}.`;
}

export interface ApprovalPushDeps {
  tokens: ActionTokens;
  itemFor(notification: Notification, owner: string): { item: ApprovalItem; asked: boolean } | null;
}

const RESTYLED = new Set<ApprovalItem["kind"]>(["permission", "outbound"]);

/** Restyles a tool or outbound-send banner and, for a plain approval the person may decide, adds Approve and Decline.
 * Any other banner keeps its own words, and a critical action only opens its card. */
export function createApprovalPush(deps: ApprovalPushDeps): (notification: Notification, row: { owner: string }) => PushDecoration | undefined {
  return (notification, row) => {
    if (notification.kind !== "approval" || !notification.requestId) return undefined;
    const found = deps.itemFor(notification, row.owner);
    if (!found) return undefined;
    const { item, asked } = found;
    const decoration: PushDecoration = {};
    if (RESTYLED.has(item.kind)) {
      decoration.title = item.title;
      decoration.body = [firstSentences(item.summary, 160), askedPhrase(item.decider, { you: asked })].filter(Boolean).join(" ");
    }
    if (decidableOutsideCard(item, "banner")) {
      const id = approvalId(item.threadId, item.messageId);
      decoration.actions = [{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }];
      decoration.approval = {
        id,
        token: deps.tokens.issue({ approvalId: id, owner: row.owner }),
        done: { approve: "Aprovado por você · enviado", decline: "Recusado por você" },
      };
    }
    return Object.keys(decoration).length ? decoration : undefined;
  };
}
