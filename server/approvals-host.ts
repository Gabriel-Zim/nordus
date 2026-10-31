// Nordus: the approvals inbox, assembled once: its routes, the push decoration and the start-up call.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { NotificationLogEntry } from "../shared/notification.ts";
import { createApprovalExpiry } from "./approval-expiry.ts";
import { createActionTokens, createApprovalPush } from "./approval-push.ts";
import { respondAsClick } from "./approval-respond.ts";
import { createApprovalSettings } from "./approval-settings.ts";
import { createApprovalsIndex, type ApprovalsStore, type IndexedCard } from "./approvals-index.ts";
import type { VisibleSet } from "./bot-visibility.ts";
import { json, readBody } from "./harness/http.ts";
import { waitingCardRows } from "./message-db.ts";
import type { RequestAuth } from "./request-auth.ts";
import { approvalsViewer, createApprovalRoutes } from "./routes/approvals.ts";
import { createInboxRoutes } from "./routes/inbox.ts";
import { dispatchRoutes, type RouteContext, type RouteHandler } from "./routes/table.ts";
import type { PublicSession, SessionRecord } from "./sessions.ts";
import type { Message } from "./store.ts";

const BOOT_WINDOW_MS = 30 * 24 * 60 * 60_000;

export interface ApprovalsHostDeps {
  store: ApprovalsStore & {
    patchMessage(threadId: string, messageId: string, patch: Partial<Message>): unknown;
    appendMessage(threadId: string, message: Omit<Message, "id" | "at">): Message;
  };
  dataDir: string;
  routes: readonly RouteHandler[];
  visibleFor: (auth: RequestAuth) => VisibleSet;
  cardRefusal: (auth: RequestAuth, threadId: string, requestId: string) => string | null;
  sessions: { list(): PublicSession[]; isLive(id: string): boolean };
  profile: () => { name?: string; email?: string } | undefined;
  personName: (auth: RequestAuth) => string;
  recentLog: () => NotificationLogEntry[];
  recordShown: (row: { threadId: string; requestId: string; botId: string; botName: string; summary: string }) => void;
  now?: () => number;
}

const OWNER_AUTH: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
/** What declines a request that ran out: the answer route lets a local service only decline, and the decision log names it "Local service", never the machine's owner. */
const SERVICE_AUTH: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };

export function createApprovalsHost(deps: ApprovalsHostDeps) {
  const settings = createApprovalSettings(deps.dataDir);
  const tokens = createActionTokens({ now: deps.now });

  const nameOf = (email: string): string | undefined => {
    const profile = deps.profile();
    if (profile?.email?.trim().toLowerCase() === email && profile.name?.trim()) return profile.name.trim();
    return deps.sessions.list().find((session) => session.email?.trim().toLowerCase() === email && session.name?.trim())?.name?.trim();
  };

  const index = createApprovalsIndex({ store: deps.store, ttlMs: settings.ttlMs, nameOf });
  const dispatch = (ctx: RouteContext) => dispatchRoutes(deps.routes, ctx);
  const routeDeps = {
    index,
    tokens,
    settings,
    visibleFor: deps.visibleFor,
    refusal: (auth: RequestAuth, card: IndexedCard) =>
      card.message.card?.requestId ? deps.cardRefusal(auth, card.threadId, card.message.card.requestId) : null,
    dispatch,
    personName: deps.personName,
    lessons: { appendMessage: (threadId: string, message: Omit<Message, "id" | "at">) => deps.store.appendMessage(threadId, message), recordShown: deps.recordShown },
    store: deps.store,
  };

  const systemContext = (): RouteContext => ({
    req: { headers: {} } as IncomingMessage, res: undefined as unknown as ServerResponse, url: new URL("http://127.0.0.1/"),
    path: "", method: "POST", auth: SERVICE_AUTH, json, readBody,
  });

  const expiry = createApprovalExpiry({
    index,
    store: deps.store,
    ttlMs: settings.ttlMs,
    now: deps.now,
    decline: async (card, reason) => {
      const requestId = card.message.card?.requestId;
      if (!requestId) return false;
      const answered = await respondAsClick(dispatch, systemContext(), card.threadId, { requestId, behavior: "deny", message: reason });
      return answered.status === 200 && answered.body.outcome !== "unavailable";
    },
  });

  function authOfOwner(owner: string): RequestAuth | null {
    if (owner === "loopback") return OWNER_AUTH;
    const session = deps.sessions.list().find((candidate) => candidate.id === owner);
    if (!session || !deps.sessions.isLive(session.id)) return null;
    return { kind: "session", session: { ...session, tokenHash: "" } as SessionRecord, via: "cookie", scopes: session.scopes };
  }

  const decorate = createApprovalPush({
    tokens,
    itemFor(notification, owner) {
      const card = notification.requestId ? index.byRequest(notification.requestId) : undefined;
      const auth = authOfOwner(owner);
      if (!card || !auth) return null;
      const item = index.visibleItem(card, approvalsViewer(routeDeps, auth));
      if (!item) return null;
      const email = auth.kind === "session" ? auth.session.email?.trim().toLowerCase() : deps.profile()?.email?.trim().toLowerCase();
      const bot = index.owner(card);
      return { item, asked: Boolean(bot && email && bot === email) };
    },
  });

  return {
    index,
    settings,
    tokens,
    expiry,
    decorate,
    routes: [createApprovalRoutes(routeDeps), createInboxRoutes({ index, visibleFor: deps.visibleFor, refusal: routeDeps.refusal, log: deps.recentLog })] as RouteHandler[],
    start(): void {
      let rows: ReturnType<typeof waitingCardRows> = [];
      try {
        rows = waitingCardRows((deps.now ?? Date.now)() - BOOT_WINDOW_MS);
      } catch (error) {
        console.error("approvals: could not read what waits on a person:", error);
      }
      index.start(rows);
      expiry.start();
    },
  };
}

export type ApprovalsHost = ReturnType<typeof createApprovalsHost>;
