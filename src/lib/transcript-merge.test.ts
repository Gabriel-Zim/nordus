import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { applyScrollbackPage, foldConfirmedMessage, mergeSnapshotTranscript, mergeTranscriptLeaf, mergeTranscriptRows, reconcileOptimisticRows } from "./transcript-merge";

const row = (id: string, at?: number, extra: Partial<Message> = {}): Message =>
  ({ id, at, role: "user", kind: "text", text: id, ...extra }) as Message;

const ids = (messages: readonly Message[]) => messages.map((message) => message.id);

const thread = (from: number, count: number, extra: (index: number) => Partial<Message> = () => ({})): Message[] =>
  Array.from({ length: count }, (_, index) => {
    const id = `m${from + index}`;
    return row(id, from + index, { parentId: from + index === 0 ? null : `m${from + index - 1}`, ...extra(from + index) });
  });

describe("mergeTranscriptRows", () => {
  it("keeps the server's insertion order for the ids a snapshot carries, whatever their timestamps say", () => {
    const merged = mergeTranscriptRows(
      [row("m1", 1), row("m3", 2)],
      [row("m3", 2), row("m2", 99)],
    );
    expect(ids(merged.messages)).toEqual(["m1", "m3", "m2"]);
    expect(merged.rebased).toBe(false);
  });

  it("keeps held rows the snapshot does not carry behind it", () => {
    const merged = mergeTranscriptRows([row("m1", 1), row("m3", 3), row("m4", 4)], [row("m1", 1), row("m2", 2)]);
    expect(ids(merged.messages)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(merged.rebased).toBe(false);
  });

  it("puts a held row before the snapshot when it sat before the first shared row", () => {
    const merged = mergeTranscriptRows([row("m1", 1), row("m2", 2), row("m3", 3)], [row("m2", 2), row("m3", 3)]);
    expect(ids(merged.messages)).toEqual(["m1", "m2", "m3"]);
    expect(merged.rebased).toBe(false);
  });

  it("overlaps by id, not by timestamp, and keeps the incoming copy", () => {
    const merged = mergeTranscriptRows(
      [row("m1", 9), row("m2", 1, { text: "old" }), row("m3", 40)],
      [row("m2", 1, { text: "new" }), row("m3", 0), row("m4", 5)],
    );
    expect(ids(merged.messages)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(merged.messages.find((message) => message.id === "m2")?.text).toBe("new");
  });

  it("drops every held row and takes the snapshot as the new base when the two share no id", () => {
    const merged = mergeTranscriptRows(thread(0, 300), thread(380, 60));
    expect(merged.rebased).toBe(true);
    expect(merged.messages).toHaveLength(60);
    expect(merged.messages[0].id).toBe("m380");
    expect(ids(merged.messages)).toEqual(ids(thread(380, 60)));
  });

  it("keeps an optimistic row the rebased snapshot does not confirm", () => {
    const held = [...thread(0, 5), row("optimistic-send", 9, { sendId: "send" })];
    const merged = mergeTranscriptRows(held, thread(80, 3));
    expect(ids(merged.messages)).toEqual(["m80", "m81", "m82", "optimistic-send"]);
    expect(merged.rebased).toBe(true);
  });

  it("drops a confirmed optimistic row when every incoming row is new", () => {
    const held = [row("optimistic-send", 2, { sendId: "send" })];
    const merged = mergeTranscriptRows(held, thread(80, 2, (index) => (index === 81 ? { sendId: "send" } : {})));
    expect(ids(merged.messages)).toEqual(["m80", "m81"]);
    expect(merged.rebased).toBe(false);
  });

  it("does not let a skewed timestamp reorder the incoming snapshot", () => {
    const merged = mergeTranscriptRows([row("old", 1)], [row("late", 20), row("early", 2)]);
    expect(ids(merged.messages)).toEqual(["late", "early"]);
  });

  it("does not call a first snapshot a rebase when nothing was held", () => {
    const merged = mergeTranscriptRows([], thread(380, 60));
    expect(merged.rebased).toBe(false);
    expect(merged.messages).toHaveLength(60);
  });

  it("drops a held optimistic row whose send the snapshot already confirms and keeps unmatched ones at the end", () => {
    const held = [
      row("root", 1),
      row("optimistic-confirmed", 9, { sendId: "confirmed" }),
      row("optimistic-pending", 10, { sendId: "pending" }),
    ];
    const incoming = [row("root", 1), row("server", 2, { sendId: "confirmed" })];
    expect(ids(mergeTranscriptRows(held, incoming).messages)).toEqual(["root", "server", "optimistic-pending"]);
  });
});

describe("mergeSnapshotTranscript", () => {
  it("keeps a held optimistic leaf when the snapshot predates the send", () => {
    const previous = { threadId: "thread", messages: [row("root", 1), row("optimistic-send", 2, { sendId: "send" })], activeLeafId: "optimistic-send" };
    const incoming = { threadId: "thread", messages: [row("root", 1)], activeLeafId: "root" };
    const merged = mergeSnapshotTranscript(previous, incoming);
    expect(merged.activeLeafId).toBe("optimistic-send");
    expect(ids(merged.messages)).toEqual(["root", "optimistic-send"]);
  });

  it("repoints the held optimistic leaf at the confirmed row in the snapshot", () => {
    const previous = { threadId: "thread", messages: [row("root", 1), row("optimistic-send", 2, { sendId: "send" })], activeLeafId: "optimistic-send" };
    const incoming = { threadId: "thread", messages: [row("root", 1), row("server", 2, { sendId: "send" })], activeLeafId: "root" };
    const merged = mergeSnapshotTranscript(previous, incoming);
    expect(merged.activeLeafId).toBe("server");
    expect(ids(merged.messages)).toEqual(["root", "server"]);
  });

  it("keeps a held leaf the window does not carry when it is newer than the window's own leaf", () => {
    const previous = {
      threadId: "thread",
      messages: [row("m1", 1), row("m2", 2), row("m3", 3, { parentId: "m2" })],
      activeLeafId: "m3",
    };
    const incoming = { threadId: "thread", messages: [row("m1", 1), row("m2", 2)], activeLeafId: "m2" };
    const merged = mergeSnapshotTranscript(previous, incoming);
    expect(merged.rebased).toBe(false);
    expect(merged.activeLeafId).toBe("m3");
  });

  it("repoints the optimistic leaf even when the snapshot confirms another send first", () => {
    const previous = {
      threadId: "thread",
      messages: [row("root", 1), row("optimistic-first", 2, { sendId: "first" }), row("optimistic-last", 3, { sendId: "last" })],
      activeLeafId: "optimistic-last",
    };
    const incoming = {
      threadId: "thread",
      messages: [row("root", 1), row("server-first", 2, { sendId: "first" }), row("server-last", 3, { sendId: "last" })],
      activeLeafId: "root",
    };
    const merged = mergeSnapshotTranscript(previous, incoming);
    expect(ids(merged.messages)).toEqual(["root", "server-first", "server-last"]);
    expect(merged.activeLeafId).toBe("server-last");
  });

  it("takes the snapshot's leaf when the held leaf is older than it", () => {
    const previous = {
      threadId: "thread",
      messages: [row("m1", 1), row("m2", 2)],
      activeLeafId: "m2",
    };
    const incoming = { threadId: "thread", messages: [row("m1", 1), row("m9", 9)], activeLeafId: "m9" };
    const merged = mergeSnapshotTranscript(previous, incoming);
    expect(merged.activeLeafId).toBe("m9");
  });

  it("adopts the snapshot's hasMore on a rebase and keeps paging open", () => {
    const previous = { threadId: "thread", messages: thread(0, 300), hasMore: false, activeLeafId: "m299" };
    const incoming = { threadId: "thread", messages: thread(380, 60), hasMore: true, activeLeafId: "m439" };
    const merged = mergeSnapshotTranscript(previous, incoming);
    expect(merged.rebased).toBe(true);
    expect(merged.hasMore).toBe(true);
    expect(merged.messages[0].id).toBe("m380");
    expect(merged.activeLeafId).toBe("m439");
  });
});

describe("mergeTranscriptLeaf", () => {
  it("keeps an optimistic leaf the snapshot predates", () => {
    const held = [row("root", 1), row("optimistic-send", 2, { sendId: "send" })];
    expect(mergeTranscriptLeaf("optimistic-send", "root", held, [row("root", 1)])).toBe("optimistic-send");
  });

  it("does not keep a held regular leaf once the snapshot replaced the list", () => {
    const held = thread(0, 4);
    const incoming = thread(80, 2);
    expect(mergeTranscriptLeaf("m3", "m81", held, incoming)).toBe("m81");
  });
});

describe("foldConfirmedMessage", () => {
  it("replaces the optimistic row in place", () => {
    const folded = foldConfirmedMessage(
      [row("root", 1), row("optimistic-send", 2, { sendId: "send" })],
      row("server", 3, { sendId: "send" }),
    );
    expect(ids(folded.messages)).toEqual(["root", "server"]);
    expect(folded.optimisticId).toBe("optimistic-send");
    expect(folded.duplicate).toBe(false);
  });

  it("removes the optimistic row even when the confirmed row is already held", () => {
    const folded = foldConfirmedMessage(
      [row("root", 1), row("optimistic-send", 2, { sendId: "send" }), row("server", 3, { sendId: "send" })],
      row("server", 3, { sendId: "send" }),
    );
    expect(ids(folded.messages)).toEqual(["root", "server"]);
    expect(folded.optimisticId).toBe("optimistic-send");
    expect(folded.duplicate).toBe(true);
  });

  it("appends when neither copy is held", () => {
    const folded = foldConfirmedMessage([row("root", 1)], row("server", 2));
    expect(ids(folded.messages)).toEqual(["root", "server"]);
    expect(folded.optimisticId).toBeNull();
    expect(folded.duplicate).toBe(false);
  });
});

describe("reconcileOptimisticRows", () => {
  it("moves a leaf that stood on the optimistic copy to the server row", () => {
    const held = [row("root", 1), row("optimistic-send", 2, { sendId: "send" })];
    const folded = reconcileOptimisticRows(held, [row("server", 3, { sendId: "send" })], "optimistic-send");
    expect(ids(folded.messages)).toEqual(["root"]);
    expect(folded.activeLeafId).toBe("server");
  });

  it("leaves a leaf that stood elsewhere alone", () => {
    const held = [row("root", 1), row("optimistic-send", 2, { sendId: "send" })];
    const folded = reconcileOptimisticRows(held, [row("server", 3, { sendId: "send" })], "root");
    expect(folded.activeLeafId).toBe("root");
  });
});

describe("applyScrollbackPage", () => {
  const state = {
    loadingOlder: { thread: true as const },
    olderFailed: {},
    transcriptGeneration: {},
    bots: [{ id: "bot", threadId: "thread", messages: [row("m3", 3), row("m4", 4)], hasMore: true }],
    groups: [],
  } as never as Parameters<typeof applyScrollbackPage>[0];

  it("prepends the page in server order so the before cursor stays the oldest row", () => {
    const next = applyScrollbackPage(state, {
      threadId: "thread", generation: 0, messages: [row("m1", 1), row("m2", 2)], hasMore: true,
    });
    expect(ids(next.bots![0].messages)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(next.bots![0].messages[0].id).toBe("m1");
    expect(next.bots![0].hasMore).toBe(true);
  });

  it("keeps hasMore and marks a retry when a page adds nothing", () => {
    const next = applyScrollbackPage(state, {
      threadId: "thread", generation: 0, messages: [row("m3", 3)], hasMore: true,
    });
    expect(ids(next.bots![0].messages)).toEqual(["m3", "m4"]);
    expect(next.bots![0].hasMore).toBe(true);
    expect(next.olderFailed).toEqual({ thread: true });
  });

  it("does not put a retry on a new branch for a stale page", () => {
    const next = applyScrollbackPage(state, {
      threadId: "thread", generation: 4, messages: [], hasMore: true, failed: true,
    });
    expect(next.olderFailed).toBeUndefined();
    expect(next.bots).toBeUndefined();
  });

  it("clears loading without touching a healthy page's flag", () => {
    const next = applyScrollbackPage(state, {
      threadId: "thread", generation: 0, messages: [row("m1", 1)], hasMore: false,
    });
    expect(next.loadingOlder).toEqual({});
    expect(next.olderFailed).toEqual({});
    expect(next.bots![0].hasMore).toBe(false);
  });

  it("folds a confirmation that arrives through the page instead of showing the message twice", () => {
    const confirming = {
      ...state,
      bots: [{
        id: "bot", threadId: "thread", hasMore: true,
        messages: [row("m3", 3), row("optimistic-send", 4, { sendId: "send" })],
        activeLeafId: "optimistic-send",
      }],
    } as never as Parameters<typeof applyScrollbackPage>[0];
    const next = applyScrollbackPage(confirming, {
      threadId: "thread", generation: 0, messages: [row("m1", 1), row("m2", 2), row("server", 5, { sendId: "send" })], hasMore: true,
    });
    expect(ids(next.bots![0].messages)).toEqual(["m1", "m2", "server", "m3"]);
    expect(next.bots![0].activeLeafId).toBe("server");
  });

  it("folds a confirmation that arrives through a room's page", () => {
    const roomState = {
      ...state,
      bots: [],
      groups: [{
        id: "room", threadId: "thread", hasMore: true,
        messages: [row("m3", 3), row("optimistic-send", 4, { sendId: "send" })],
      }],
    } as never as Parameters<typeof applyScrollbackPage>[0];
    const next = applyScrollbackPage(roomState, {
      threadId: "thread", generation: 0, messages: [row("server", 5, { sendId: "send" })], hasMore: false,
    });
    expect(ids(next.groups![0].messages)).toEqual(["server", "m3"]);
    expect(next.groups![0].hasMore).toBe(false);
  });
});
