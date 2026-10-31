// What a live frame from the server does to the app outside the main reducer.
import type { RuntimeEvent } from "../../shared/runtime-events";
import type { ServerFrame } from "../../shared/wire";
import type { Action } from "./store";
import { replyDrafts, type DraftStore } from "./streaming-drafts";

export function runtimeFrameAction(event: RuntimeEvent): Action | null {
  return event.type === "turn.started" || event.type === "session.model-variants" || event.type === "turn.completed"
    ? { type: "modelVariantRuntime", event }
    : null;
}

/** A new snapshot replaces whatever drafts were on screen; one still being written comes back with its next piece. */
export function clearDrafts(drafts: DraftStore = replyDrafts): void {
  drafts.apply({ type: "clear" });
}

/** Pieces of a reply reach only the open conversation; another one asks for its draft when it opens mid-reply. A
 * draft ends for any conversation, when its saved message or the server's drop arrives. */
export function applyDraftFrame(frame: ServerFrame, openThread: string | null, drafts: DraftStore = replyDrafts): void {
  if (frame.kind === "reply.draft.end") drafts.apply({ type: "end", threadId: frame.threadId, streamId: frame.streamId });
  else if (frame.kind === "bot") {
    // A server restart or a lost end frame would otherwise leave "Escrevendo" on screen after the bot stopped.
    if (!frame.bot.busy && frame.bot.threadId) drafts.apply({ type: "clear", threadId: frame.bot.threadId });
    for (const task of frame.bot.tasks ?? []) if (!task.busy) drafts.apply({ type: "clear", threadId: task.threadId });
  }
  else if (frame.kind === "message" && typeof frame.message?.streamId === "string") {
    drafts.apply({ type: "end", threadId: frame.threadId, streamId: frame.message.streamId });
  } else if (frame.kind === "runtime" && frame.event.type === "content.delta" && frame.event.draft && frame.event.threadId === openThread) {
    drafts.apply({ type: "chunk", threadId: frame.event.threadId, chunk: frame.event.draft });
  }
}
