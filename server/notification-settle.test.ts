import { describe, expect, it } from "vitest";
import { notificationSettlement, settles } from "./notification-settle.ts";
import type { Message } from "./store.ts";

const message = (extra: Partial<Message>): Message => ({ id: "m1", role: "bot", kind: "text", text: "", at: 1, ...extra } as Message);

describe("what settles an open notification", () => {
  it("an answered, dismissed or expired card settles its own request, and an open card nothing", () => {
    const card = { title: "Publicar?", subtitle: "", options: ["Allow", "Deny"], requestId: "req-1" };
    for (const done of [{ answered: "Allow" }, { dismissed: true }, { expired: true }]) {
      expect(notificationSettlement({ type: "message.patch", threadId: "t", message: message({ kind: "options", card: { ...card, ...done } }) }))
        .toEqual({ requestId: "req-1" });
    }
    expect(notificationSettlement({ type: "message.patch", threadId: "t", message: message({ kind: "options", card }) })).toBeNull();
  });

  it("the person's reply settles questions and failures; the bot writing again settles failures only", () => {
    expect(notificationSettlement({ type: "message", threadId: "t", message: message({ role: "user" }) }))
      .toEqual({ threadId: "t", kinds: expect.arrayContaining(["question", "turn-failed", "incident"]) });
    const progress = notificationSettlement({ type: "message", threadId: "t", message: message({}) });
    expect(progress).toEqual({ threadId: "t", kinds: expect.arrayContaining(["turn-failed", "routine-failed", "incident"]) });
    expect(progress && "kinds" in progress && progress.kinds).not.toContain("question");
    expect(notificationSettlement({ type: "message", threadId: "t", message: message({ kind: "activity" }) })).toBeNull();
    expect(notificationSettlement({ type: "bot", botId: "b" })).toBeNull();
  });
});

describe("a settlement's reach", () => {
  it("leaves bot asks and relayed lines alone, and keeps a room's progress to the bot that wrote", () => {
    expect(notificationSettlement({ type: "message", threadId: "t", message: message({ role: "user", peerAsk: { botId: "b2", name: "Dot" } }) })).toBeNull();
    expect(notificationSettlement({ type: "message", threadId: "t", message: message({ role: "user", relayed: true }) })).toBeNull();
    const roomProgress = notificationSettlement({ type: "message", threadId: "room", message: message({ from: { botId: "b2", name: "Dot", color: "" } }) })!;
    expect(roomProgress).toMatchObject({ threadId: "room", botId: "b2" });
    expect(settles(roomProgress, { threadId: "room", kind: "turn-failed", botId: "b2" })).toBe(true);
    expect(settles(roomProgress, { threadId: "room", kind: "turn-failed", botId: "b1" })).toBe(false);
  });

  it("never lets a conversation settle a notification tied to a card", () => {
    expect(settles({ threadId: "t", kinds: ["question"] }, { threadId: "t", kind: "question", botId: "b", requestId: "req-1" })).toBe(false);
    expect(settles({ requestId: "req-1" }, { threadId: "t", kind: "question", botId: "b", requestId: "req-1" })).toBe(true);
  });
});
