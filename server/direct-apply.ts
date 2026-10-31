// A change a bot asks for (its own or a teammate's skills, profile, model, team setup or team memory) applies at once at
// every level, with an Undo notice where undoing means something: Nordus adds no card of its own on top of the level
// the person chose. The one exception is a Cloud home turn its owner did not drive (a guest's, or one a webhook started):
// that turn runs at Ask and nothing in it may reach the owner's turns, so its changes wait for the owner.
// Trigger (routine) changes apply in every turn, a guest's included, where they run confined; directApply only names why.
// Nordus policy on top: standing instructions (SOUL.md) are the exception to "applies at once": a new soul, its own or
// another bot's, always waits for the person (profileGrant).
import type { ProfileRequestChanges } from "../shared/profile-request.ts";

/** Why a change applied without a person: the conversation's Full access, any other level, or (routines only) the bot's
 * own routine. Also the decision log's source. */
export type DirectApply = "full-access" | "level" | "self";

/** Server-owned and decided per request, never from request input. Null: the owner confirms on a card. */
export type DirectApplyCheck = (botId: string, threadId: string, targetBotId: string) => DirectApply | null;

/** What Undo says, applying nothing, once the thing changed since. */
export const UNDO_STALE = "Changed since, so it can't be undone here.";

export function appliesNow(args: { fullAccess: boolean; ownerMustConfirm: boolean }): DirectApply | null {
  if (args.ownerMustConfirm) return null;
  return args.fullAccess ? "full-access" : "level";
}

/** Trigger (routine) requests only: why a change applied, for the decision log. Every trigger change applies since
 * Triggers v2; this no longer decides whether a card waits. */
export function directApply(args: {
  fullAccess: boolean;
  botId: string;
  targetBotId: string;
  blocked: boolean;
}): DirectApply | null {
  if (args.fullAccess) return "full-access";
  return args.targetBotId === args.botId && !args.blocked ? "self" : null;
}

/** Nordus: whatever the level grants, a bot never rewrites standing instructions (the soul) on its own, and a new
 * working folder widens what its tools reach, so below Full access it keeps the card. */
export function profileGrant(grant: DirectApply | null, changes: ProfileRequestChanges): DirectApply | null {
  if (changes.soul !== undefined) return null;
  if (grant !== null && grant !== "full-access" && changes.cwd !== undefined) return null;
  return grant;
}
