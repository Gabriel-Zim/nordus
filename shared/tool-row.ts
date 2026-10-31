import type { PlaceRow } from "./place-view.ts";
import type { TurnError } from "./turn-error.ts";

/** An activity message's tool call and its outcome. */
export interface ToolRow {
  name: string; ok?: boolean; spoken?: string; setup?: boolean; terminal?: boolean; summary?: string; input?: string; output?: string;
  /** An approval chip: the tool call it names was allowed (by a rule, Full Access or a lead), not a tool call itself. */
  approved?: boolean;
  /** A chip that says the tool call it names waits for a yes (the team's leader, the person), not a tool call itself. */
  awaitingApproval?: boolean;
  /** The person pressed Stop while this tool call was still open. */
  cancelled?: boolean;
  /** error rows: the installed Claude Code is too old for the model, and
   * the UI can offer to update it in place. */
  claudeUpdate?: boolean;
  /** error rows: the place this turn could not use. */
  place?: PlaceRow;
  /** error rows: what kind of failure it was and how much of the turn ran. */
  error?: TurnError;
  /** error rows: epoch ms when the usage limit that stopped the turn resets (upstream's field; `error.retryAt` is the Nordus one). */
  limitResetsAt?: number;
  /** Provider item identity, scoped to the owning turn. */
  itemId?: string;
  /** Whether the harness captured the full redacted result. Private
   * server-local spill paths are not exposed to clients. */
  fullResult?: boolean;
}
