import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearReplyDraft,
  replyDraft,
  getDraft,
  getDraftAttachments,
  rememberReplyDraft,
  setDraft,
  setDraftAttachments,
} from "../src/lib/drafts.ts";
import { fileAttachment, pasteAttachment } from "../src/lib/composer-attachments.ts";

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("composer drafts", () => {
  it("keeps text and attachments isolated per bot or room", () => {
    const store = memoryStore();
    const paste = pasteAttachment("bot paste");
    const file = fileAttachment("notes.txt", "/tmp/notes.txt", 12);
    setDraft(store, "bot:one", "hello");
    setDraftAttachments(store, "bot:one", [paste, file]);
    setDraft(store, "group:two", "room text");

    expect(getDraft(store, "bot:one")).toBe("hello");
    expect(getDraftAttachments(store, "bot:one")).toEqual([paste, file]);
    expect(getDraft(store, "group:two")).toBe("room text");
    expect(getDraftAttachments(store, "group:two")).toEqual([]);
  });

  it("clears empty entries and ignores malformed stored attachments", () => {
    const store = memoryStore();
    setDraft(store, "bot:one", "hello");
    setDraft(store, "bot:one", "");
    store.setItem(
      "nordus-draft-attachments",
      JSON.stringify({ "bot:one": [{ kind: "paste", id: "broken" }] }),
    );

    expect(getDraft(store, "bot:one")).toBe("");
    expect(getDraftAttachments(store, "bot:one")).toEqual([]);
  });

  it("keeps reply targets isolated by task", () => {
    rememberReplyDraft("thread-reply-a", "message-a");
    rememberReplyDraft("thread-reply-b", "message-b");
    expect(replyDraft("thread-reply-a")).toBe("message-a");
    expect(replyDraft("thread-reply-b")).toBe("message-b");
    clearReplyDraft("thread-reply-a");
    expect(replyDraft("thread-reply-a")).toBeUndefined();
    expect(replyDraft("thread-reply-b")).toBe("message-b");
    clearReplyDraft("thread-reply-b");
  });
});
