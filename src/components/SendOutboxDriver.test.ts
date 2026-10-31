import { describe, expect, it, vi } from "vitest";
import { outboxDelivery, outboxSendAction, outboxTargetLoaded } from "./SendOutboxDriver";
import type { OutboxEntry } from "@/lib/send-outbox";

const base: OutboxEntry & { requestText: string } = {
  sendId: "send-aaaaaaaaaaaaaaaa", draftId: "d", threadId: "task-7", text: "oi", requestText: "oi",
  target: { kind: "bot", botId: "designergrafico" }, createdAt: 0, expiresAt: 1, status: "sending", replyToId: "m1",
};

describe("the outbox send", () => {
  it("reaches a conversation or a task through the bot route, with the device's sendId and no error toast", () => {
    const settle = { onSent: vi.fn(), onError: vi.fn() };
    expect(outboxSendAction(base, settle)).toEqual({
      type: "send", botId: "designergrafico", text: "oi", sendId: base.sendId, replyToId: "m1", threadId: "task-7", quiet: true, ...settle,
    });
  });

  it("reaches a room through the room route, keeping goal mode", () => {
    const settle = { onSent: vi.fn(), onError: vi.fn() };
    expect(outboxSendAction({ ...base, target: { kind: "group", groupId: "hq", mode: "goal" } }, settle)).toMatchObject({
      type: "sendGroup", groupId: "hq", mode: "goal", sendId: base.sendId, threadId: "task-7", quiet: true,
    });
  });

  it("waits until the bot or room it writes to is loaded", () => {
    expect(outboxTargetLoaded({ bots: [], groups: [] }, base)).toBe(false);
    expect(outboxTargetLoaded({ bots: [{ id: "designergrafico" }] as never, groups: [] }, base)).toBe(true);
    expect(outboxTargetLoaded({ bots: [{ id: "designergrafico" }] as never, groups: [] }, { ...base, target: { kind: "group", groupId: "hq", mode: "chat" } })).toBe(false);
  });

  it("gives up on a request that never answers, so the outbox can try again", async () => {
    vi.useFakeTimers();
    try {
      const deliver = outboxDelivery(() => undefined, 90_000);
      const outcome = deliver(base).then(() => "sent", (error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(await outcome).toBe("send timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles with the store's answer", async () => {
    const sent = outboxDelivery((action) => (action as { onSent: () => void }).onSent());
    await expect(sent(base)).resolves.toBeUndefined();
    const refused = outboxDelivery((action) => (action as { onError: (error: unknown) => void }).onError(Object.assign(new Error("no"), { status: 403 })));
    await expect(refused(base)).rejects.toMatchObject({ status: 403 });
  });
});
