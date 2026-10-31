// Nordus: the approvals inbox's routes. A list of what waits on the person, and approve or decline by id, which answer
// the card through the answer route, as a click on it would.
import { APPROVAL_TTL_MAX_MS, APPROVAL_TTL_MIN_MS, APPROVALS_PATH, parseApprovalId, PLAIN_DECLINE_REASON } from "../../shared/approvals.ts";
import { deciderOf } from "../approval-decider.ts";
import { proposeLessonFromRefusal, tidyReason, type RefusalLessonDeps } from "../approval-lessons.ts";
import { ownerOfRequest, type ActionTokens } from "../approval-push.ts";
import { respondAsClick, type Dispatch } from "../approval-respond.ts";
import type { ApprovalSettings } from "../approval-settings.ts";
import type { ApprovalsIndex, ApprovalsViewer, IndexedCard } from "../approvals-index.ts";
import type { VisibleSet } from "../bot-visibility.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Message } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ApprovalRoutesDeps {
  index: ApprovalsIndex;
  tokens: ActionTokens;
  settings: ApprovalSettings;
  visibleFor: (auth: RequestAuth) => VisibleSet;
  refusal: (auth: RequestAuth, card: IndexedCard) => string | null;
  dispatch: Dispatch;
  personName: (auth: RequestAuth) => string;
  lessons: RefusalLessonDeps;
  store: {
    messagesFor(threadId: string): Message[];
    patchMessage(threadId: string, messageId: string, patch: Partial<Message>): unknown;
  };
}

export function approvalsViewer(deps: Pick<ApprovalRoutesDeps, "visibleFor" | "refusal">, auth: RequestAuth): ApprovalsViewer {
  return { who: deciderOf(auth), visible: deps.visibleFor(auth), refusal: (card) => deps.refusal(auth, card) };
}

const TEACHES: ReadonlySet<string> = new Set(["permission", "peer", "outbound"]);

const DECISION = new RegExp(`^${APPROVALS_PATH}/([\\w-]+\\.[\\w-]+)/(approve|decline)$`);

export function createApprovalRoutes(deps: ApprovalRoutesDeps): RouteHandler {
  return async (ctx) => {
    const { req, res, path, method, auth, json, readBody } = ctx;
    if (path === APPROVALS_PATH) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { items: deps.index.items(approvalsViewer(deps, auth)) });
    }
    if (path === `${APPROVALS_PATH}/settings`) {
      if (method === "GET") return json(res, 200, { ttlMs: deps.settings.ttlMs(), minMs: APPROVAL_TTL_MIN_MS, maxMs: APPROVAL_TTL_MAX_MS });
      if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Só quem administra muda o prazo." });
      const body = await readBody(req, 1_024).catch(() => null);
      const ttlMs = body && typeof body === "object" ? (body as { ttlMs?: unknown }).ttlMs : undefined;
      if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) return json(res, 400, { error: "ttlMs must be a number of milliseconds" });
      return json(res, 200, { ttlMs: deps.settings.setTtlMs(ttlMs), minMs: APPROVAL_TTL_MIN_MS, maxMs: APPROVAL_TTL_MAX_MS });
    }
    const match = DECISION.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const approve = match[2] === "approve";
    const target = parseApprovalId(match[1]!);
    const card = target ? deps.index.find(target.threadId, target.messageId) : undefined;
    const item = card ? deps.index.visibleItem(card, approvalsViewer(deps, auth)) : null;
    if (!card || !item) return json(res, 404, { error: "Isso já foi respondido ou não existe mais." });
    if (!item.canDecide) return json(res, 403, { error: `Quem decide aqui é ${item.decider}.` });
    if (item.action !== "decide" || !item.requestId) {
      return json(res, 409, { error: "Abra a conversa para decidir isso.", code: "open-the-card" });
    }
    const raw = await readBody(req, 8_192).catch(() => null);
    const body: { token?: unknown; reason?: unknown } = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    if (body.token !== undefined) {
      if (typeof body.token !== "string") return json(res, 400, { error: "token must be text" });
      if (item.risk === "critical") {
        return json(res, 403, { error: "Uma ação crítica só se aprova no cartão, segurando o botão.", code: "critical" });
      }
      const verdict = deps.tokens.consume(body.token, { approvalId: item.id, owner: ownerOfRequest(auth) });
      if (verdict !== "ok") return json(res, 403, { error: "Esse toque não vale mais. Abra o cartão para decidir.", code: `token-${verdict}` });
    }
    const reason = approve ? "" : tidyReason(body.reason);
    const answered = await respondAsClick(deps.dispatch, ctx, item.threadId, {
      requestId: item.requestId,
      behavior: approve ? "allow" : "deny",
      ...(approve ? {} : { message: reason || PLAIN_DECLINE_REASON }),
    });
    if (answered.status !== 200) {
      return json(res, answered.status || 502, typeof answered.body.error === "string" ? answered.body : { error: "Não deu para entregar a resposta." });
    }
    if (answered.body.outcome === "unavailable") {
      return json(res, 409, { error: "O pedido não está mais aberto. Nada foi feito.", outcome: "unavailable" });
    }
    if (approve || !reason) return json(res, 200, { ok: true, outcome: answered.body.outcome });
    const lesson = settleRefusal(deps, auth, card, item.threadId, reason);
    return json(res, 200, { ok: true, outcome: answered.body.outcome, ...(lesson ? { lesson } : {}) });
  };
}

function settleRefusal(deps: ApprovalRoutesDeps, auth: RequestAuth, card: IndexedCard, threadId: string, reason: string): { messageId: string; requestId: string } | null {
  const current = deps.store.messagesFor(threadId).find((message) => message.id === card.message.id);
  if (current?.card) {
    deps.store.patchMessage(threadId, current.id, { card: { ...current.card, approval: { ...current.card.approval, declinedWhy: reason } } });
  }
  const voice = deps.index.voice(card);
  if (!voice || !TEACHES.has(card.kind)) return null;
  const made = proposeLessonFromRefusal(deps.lessons, {
    threadId, bot: voice.bot, speaker: voice.speaker, person: deps.personName(auth), intent: card.message.card?.intent, reason,
  });
  return made ? { messageId: made.messageId, requestId: made.requestId } : null;
}
