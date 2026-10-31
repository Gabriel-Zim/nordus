// The reply a bot is writing right now, one per conversation. Every piece goes out with the reply's id, a revision and
// its position, so a phone can drop a repeat, notice a hole, and swap the draft for the saved message with the same id.
// Every draft ends in a saved reply under its id or in an explicit drop, so no phone keeps an orphan.
import { randomUUID } from "node:crypto";

import { dropBackstageLead, nordusModelNames } from "./backstage-text.ts";
import { redactSecretsInText } from "./redact.ts";
import type { ReplyDraftChunk, ReplyDraftEndFrame, ReplyDraftSnapshot, RuntimeEvent } from "../shared/runtime-events.ts";
import type { Store } from "./store.ts";

type Stream = { streamId: string; turnId: string | undefined; raw: string; sent: string; rev: number; render: (raw: string) => string };

export interface ReplyStreamDeps {
  store: Pick<Store, "activePath" | "botByThread" | "groupByThread" | "messagesFor" | "patchMessage">;
  broadcast(frame: ReplyDraftEndFrame): void;
  /** `${threadId}:${itemId}` to the activity message of each tool call still open. */
  openTools: Map<string, string>;
  newStreamId?: () => string;
  heldWords?: number;
}

// A rename spans up to three words and a secret is masked only once it is whole, so the last words wait for the next
// ones; a key block waits for its END line. What is sent then only grows.
const HELD_WORDS = 4;

function withoutOpenKeyBlock(raw: string): string {
  const block = raw.lastIndexOf("-----BEGIN");
  return block >= 0 && !raw.includes("-----END", block) ? raw.slice(0, block) : raw;
}

function settled(raw: string, heldWords: number): string {
  const text = withoutOpenKeyBlock(raw);
  let cut = text.length;
  for (let words = 0; words < heldWords && cut > 0; words++) {
    while (cut > 0 && /\s/u.test(text[cut - 1]!)) cut--;
    while (cut > 0 && !/\s/u.test(text[cut - 1]!)) cut--;
  }
  return text.slice(0, cut);
}

export class ReplyStreams {
  private readonly streams = new Map<string, Stream>();
  private readonly deps: ReplyStreamDeps;

  constructor(deps: ReplyStreamDeps) {
    this.deps = deps;
  }

  /** The event as the live wire carries it: in a bot's or room's conversation the reply text is the public draft text,
   * never the raw piece, which every client and the replay ring would otherwise hold. */
  stamp(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== "content.delta" || event.streamKind !== "assistant_text") return event;
    const { store } = this.deps;
    if (!store.botByThread(event.threadId) && !store.groupByThread(event.threadId)) return event;
    const draft = this.append(event.threadId, event.turnId, event.delta);
    return { ...event, delta: draft?.delta ?? "", ...(draft ? { draft } : {}) };
  }

  /** The next piece of the public draft, or null while the new text is still held back. */
  append(threadId: string, turnId: string | undefined, delta: string): ReplyDraftChunk | null {
    let stream = this.streams.get(threadId);
    if (!stream || (turnId && stream.turnId && stream.turnId !== turnId)) {
      stream = { streamId: (this.deps.newStreamId ?? randomUUID)(), turnId, raw: "", sent: "", rev: 0, render: this.publicText(threadId) };
      this.streams.set(threadId, stream);
    }
    stream.turnId ??= turnId;
    stream.raw += delta;
    const next = stream.render(settled(stream.raw, this.deps.heldWords ?? HELD_WORDS));
    if (next === stream.sent) return null;
    if (next.startsWith(stream.sent)) {
      const offset = stream.sent.length;
      stream.sent = next;
      return { streamId: stream.streamId, rev: stream.rev, offset, delta: next.slice(offset) };
    }
    // A rename reached back into text already shown: send the whole draft again under a new revision.
    stream.rev += 1;
    stream.sent = next;
    return { streamId: stream.streamId, rev: stream.rev, offset: 0, delta: next };
  }

  current(threadId: string): ReplyDraftSnapshot | null {
    const stream = this.streams.get(threadId);
    return stream ? { streamId: stream.streamId, rev: stream.rev, text: stream.sent } : null;
  }

  /** The id the saved reply carries; the draft is over. */
  saved(threadId: string, turnId: string | undefined): string | undefined {
    return this.take(threadId, turnId)?.streamId;
  }

  /** The draft ends with no saved reply under its id: phones drop it. */
  end(threadId: string, turnId: string | undefined): void {
    const draft = this.take(threadId, turnId);
    if (draft) this.deps.broadcast({ kind: "reply.draft.end", threadId, streamId: draft.streamId });
  }

  /** Stop keeps what the bot had written, through `save`, and the tools it left open read as cancelled by the person.
   * `abortText` is a provider's own "request was cancelled" sentence, which never belongs to the kept text. */
  stop(threadId: string, turnId: string | undefined, save: (text: string, streamId: string) => void, abortText = ""): void {
    // A stopped turn can settle after its replacement started writing: that one's draft and tools are not this stop's.
    const stream = this.ownedBy(threadId, turnId) ? this.streams.get(threadId) : undefined;
    const abort = abortText.trim();
    const written = stream?.render(withoutOpenKeyBlock(stream.raw)).trimEnd() ?? "";
    const partial = abort && written.endsWith(abort) ? written.slice(0, -abort.length).trimEnd() : written;
    if (stream && partial.trim()) {
      this.streams.delete(threadId);
      save(partial, stream.streamId);
    } else this.end(threadId, turnId);
    const { store, openTools } = this.deps;
    for (const [key, messageId] of openTools) {
      if (!key.startsWith(`${threadId}:`)) continue;
      const row = store.messagesFor(threadId).find((m) => m.id === messageId);
      if (turnId && row?.turnId && row.turnId !== turnId) continue;
      if (row?.tool) store.patchMessage(threadId, messageId, { tool: { ...row.tool, ok: false, cancelled: true } });
      openTools.delete(key);
    }
  }

  private ownedBy(threadId: string, turnId: string | undefined): boolean {
    const own = this.streams.get(threadId)?.turnId;
    return !turnId || !own || own === turnId;
  }

  private take(threadId: string, turnId: string | undefined): ReplyDraftSnapshot | null {
    if (!this.ownedBy(threadId, turnId)) return null;
    const draft = this.current(threadId);
    this.streams.delete(threadId);
    return draft;
  }

  // The same lead drop, renames and secret scrub as the saved reply: a draft must never show what the saved text will not.
  private publicText(threadId: string): (raw: string) => string {
    const asked = this.deps.store.activePath(threadId).findLast((m) => m.role === "user" && m.kind === "text")?.text;
    return (raw) => redactSecretsInText(nordusModelNames(dropBackstageLead(raw), asked));
  }
}
