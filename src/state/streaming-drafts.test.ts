import { describe, expect, it, vi } from "vitest";

import type { ServerFrame } from "../../shared/wire";
import { applyDraftFrame } from "./runtime-frames";
import { createDraftStore, EMPTY_DRAFTS, reduceDrafts, type DraftEvent, type DraftsState } from "./streaming-drafts";

const chunk = (offset: number, delta: string, rev = 0, streamId = "s1"): DraftEvent =>
  ({ type: "chunk", threadId: "t1", chunk: { streamId, rev, offset, delta } });

function run(events: DraftEvent[], start: DraftsState = EMPTY_DRAFTS) {
  let state = start;
  const reloads: string[] = [];
  for (const event of events) {
    const outcome = reduceDrafts(state, event);
    state = outcome.state;
    if (outcome.reload) reloads.push(outcome.reload);
  }
  return { text: state.drafts.t1?.text, state, reloads };
}

describe("reduceDrafts", () => {
  it("grows the draft piece by piece", () => {
    expect(run([chunk(0, "Olá, "), chunk(5, "tudo "), chunk(10, "bem?")]).text).toBe("Olá, tudo bem?");
  });

  it("drops a repeated piece by its position", () => {
    const { text, reloads } = run([chunk(0, "Olá, "), chunk(5, "tudo "), chunk(5, "tudo "), chunk(0, "Olá, ")]);
    expect(text).toBe("Olá, tudo ");
    expect(reloads).toEqual([]);
  });

  it("keeps only the new part of a piece that overlaps what is shown", () => {
    expect(run([chunk(0, "Olá, tu"), chunk(5, "tudo bem")]).text).toBe("Olá, tudo bem");
  });

  it("asks for the conversation again when a piece leaves a hole, and keeps what it has", () => {
    const { text, reloads } = run([chunk(0, "Olá, "), chunk(10, "bem?")]);
    expect(text).toBe("Olá, ");
    expect(reloads).toEqual(["t1"]);
  });

  it("treats a piece out of order as a hole, then a late earlier piece as a repeat after the fetch", () => {
    const first = run([chunk(0, "Olá, "), chunk(10, "bem?")]);
    const healed = run([
      { type: "loaded", threadId: "t1", draft: { streamId: "s1", rev: 0, text: "Olá, tudo bem?" } },
      chunk(5, "tudo "),
    ], first.state);
    expect(healed.text).toBe("Olá, tudo bem?");
    expect(healed.reloads).toEqual([]);
  });

  it("asks for the conversation when it opens in the middle of a reply", () => {
    expect(run([chunk(42, "meio")]).reloads).toEqual(["t1"]);
  });

  it("replaces the draft with a newer revision and ignores an older one", () => {
    const { text } = run([chunk(0, "Uso o Claude"), chunk(0, "Uso o Opus", 1), chunk(12, " de novo", 0)]);
    expect(text).toBe("Uso o Opus");
  });

  it("ends the draft and never lets a late piece of it come back", () => {
    const { state } = run([chunk(0, "Olá"), { type: "end", threadId: "t1", streamId: "s1" }, chunk(3, "!"), chunk(0, "Olá")]);
    expect(state.drafts.t1).toBeUndefined();
  });

  it("starts the next reply of the same conversation fresh", () => {
    const { text } = run([chunk(0, "primeira"), { type: "end", threadId: "t1", streamId: "s1" }, chunk(0, "segunda", 0, "s2")]);
    expect(text).toBe("segunda");
  });

  it("keeps pieces newer than a slow fetch", () => {
    const { text } = run([
      chunk(0, "Olá, tudo bem?"),
      { type: "loaded", threadId: "t1", draft: { streamId: "s1", rev: 0, text: "Olá, " } },
    ]);
    expect(text).toBe("Olá, tudo bem?");
  });
});

describe("clearing drafts", () => {
  it("drops one conversation's draft, or every draft for a fresh snapshot", () => {
    const two = run([chunk(0, "Olá"), { type: "chunk", threadId: "t2", chunk: { streamId: "x", rev: 0, offset: 0, delta: "Oi" } }]).state;
    expect(Object.keys(reduceDrafts(two, { type: "clear", threadId: "t1" }).state.drafts)).toEqual(["t2"]);
    expect(reduceDrafts(two, { type: "clear" }).state.drafts).toEqual({});
  });

  it("brings a draft still being written back with its next piece", () => {
    const cleared = reduceDrafts(run([chunk(0, "Olá, ")]).state, { type: "clear" }).state;
    expect(reduceDrafts(cleared, chunk(5, "tudo")).reload).toBe("t1");
  });
});

describe("applyDraftFrame", () => {
  const bot = (busy: boolean, taskBusy: boolean) => ({
    kind: "bot", bot: { id: "b", threadId: "t1", busy, tasks: [{ threadId: "t2", busy: taskBusy }] },
  }) as unknown as ServerFrame;

  it("clears the drafts of conversations whose bot has stopped working", () => {
    const store = createDraftStore(async () => null);
    store.apply(chunk(0, "Olá"));
    store.apply({ type: "chunk", threadId: "t2", chunk: { streamId: "x", rev: 0, offset: 0, delta: "Oi" } });
    applyDraftFrame(bot(true, false), "t1", store);
    expect(store.draft("t1")?.text).toBe("Olá");
    expect(store.draft("t2")).toBeNull();
    applyDraftFrame(bot(false, false), "t1", store);
    expect(store.draft("t1")).toBeNull();
  });

  it("feeds pieces only to the open conversation", () => {
    const store = createDraftStore(async () => null);
    const piece = (threadId: string) => ({
      kind: "runtime", event: { type: "content.delta", streamKind: "assistant_text", delta: "Oi", threadId, draft: { streamId: "s", rev: 0, offset: 0, delta: "Oi" } },
    }) as unknown as ServerFrame;
    applyDraftFrame(piece("t9"), "t1", store);
    applyDraftFrame(piece("t1"), "t1", store);
    expect(store.draft("t9")).toBeNull();
    expect(store.draft("t1")?.text).toBe("Oi");
  });
});

describe("createDraftStore", () => {
  it("fetches a conversation once per hole, however many pieces arrive meanwhile", async () => {
    let resolve!: (draft: { streamId: string; rev: number; text: string }) => void;
    const fetchDraft = vi.fn(() => new Promise<{ streamId: string; rev: number; text: string }>((r) => { resolve = r; }));
    const store = createDraftStore(fetchDraft);
    store.apply(chunk(5, "tudo "));
    store.apply(chunk(10, "bem?"));
    expect(fetchDraft).toHaveBeenCalledTimes(1);
    resolve({ streamId: "s1", rev: 0, text: "Olá, tudo bem?" });
    await vi.waitFor(() => expect(store.draft("t1")?.text).toBe("Olá, tudo bem?"));
  });
});
