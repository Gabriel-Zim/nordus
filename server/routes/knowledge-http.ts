import type { IncomingMessage } from "node:http";

import type { KnowledgeSpaceId } from "../../shared/knowledge.ts";
import type { KnowledgeActor } from "../knowledge/actors.ts";
import type { KnowledgeAccess } from "../knowledge/audience.ts";
import { isKnowledgeError, KnowledgeError } from "../knowledge/errors.ts";
import type { KnowledgeService, KnowledgeSession } from "../knowledge/service.ts";
import type { Requester } from "../knowledge/wire.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { RouteContext } from "./table.ts";

export interface KnowledgeHttpDeps {
  service: KnowledgeService;
  /** The spaces this request may use, and whose work in them it may see. */
  access: (auth: RequestAuth) => KnowledgeAccess;
  /** The person behind this request, as the Drive and the Wiki record them. */
  person: (auth: RequestAuth) => KnowledgeActor;
  /** The one space a conversation's files belong to, or none and why. */
  conversationSpace: (threadId: string) => { space: KnowledgeSpaceId | null; closed?: string };
}

/** A page is at most 512 KiB of text; JSON escaping can nearly double that. */
export const JSON_BODY_LIMIT = 2 * 1024 * 1024;

export function requesterFor(deps: KnowledgeHttpDeps, ctx: RouteContext): Requester {
  return { access: deps.access(ctx.auth), actor: deps.person(ctx.auth) };
}

export function sessionFor(deps: KnowledgeHttpDeps, ctx: RouteContext, requested: unknown): KnowledgeSession {
  return deps.service.use(requesterFor(deps, ctx), requested);
}

/** A file saved from a chat goes to the space the server gives that conversation: the browser only says which conversation it is. */
export function sessionForConversation(deps: KnowledgeHttpDeps, ctx: RouteContext, threadId: string): KnowledgeSession {
  const decided = deps.conversationSpace(threadId);
  if (!decided.space) throw new KnowledgeError("no_space", decided.closed ?? "this conversation has no Drive of its own, so its files cannot be saved there");
  return deps.service.useDecided(requesterFor(deps, ctx), decided.space);
}

export function adminOnly(deps: KnowledgeHttpDeps, ctx: RouteContext): void {
  if (!requesterFor(deps, ctx).access.admin) throw new KnowledgeError("forbidden", "only an admin can choose who opens the company's space");
}

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeError("bad_input", "send a JSON object");
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") throw new KnowledgeError("bad_input", `${name} is required`);
  return value;
}

export function versionNumber(value: unknown, name = "version"): number {
  const parsed = typeof value === "string" && value !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 1) throw new KnowledgeError("bad_input", `${name} must be a whole number`);
  return parsed;
}

export function optionalVersion(value: string | null): number | undefined {
  return value === null || value === "" ? undefined : versionNumber(value);
}

export function declaredLength(req: IncomingMessage): number | undefined {
  const raw = req.headers["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length < 0) throw new KnowledgeError("bad_input", "content-length must be a non-negative integer");
  return length;
}

/** Answers a refusal from the Drive or the Wiki; anything else is not ours to answer. */
export function answerKnowledgeError(ctx: RouteContext, error: unknown): boolean {
  if (!isKnowledgeError(error)) return false;
  ctx.json(ctx.res, error.status, { error: error.message, code: error.code, ...error.detail });
  return true;
}
