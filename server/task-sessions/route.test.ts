import { describe, expect, it } from "vitest";

import { routeDeskMessage } from "./route.ts";

const desk = { origin: "balcao", title: "X", state: "running" as const };

describe("routeDeskMessage", () => {
  it("a conversation with a desk continues itself", () => {
    expect(routeDeskMessage({ thread: { desk }, threadId: "t1", taskExists: () => false }))
      .toEqual({ action: "continue", taskThreadId: "t1" });
  });
  it("a reply to a task that exists continues that task", () => {
    expect(routeDeskMessage({ thread: {}, threadId: "balcao", replyTo: { threadRef: { threadId: "t2" } }, taskExists: (id) => id === "t2" }))
      .toEqual({ action: "continue", taskThreadId: "t2" });
  });
  it("a reply to a task that no longer exists opens a new task", () => {
    expect(routeDeskMessage({ thread: {}, threadId: "balcao", replyTo: { threadRef: { threadId: "gone" } }, taskExists: () => false }))
      .toEqual({ action: "new-task" });
  });
  it("no reply and no desk opens a new task", () => {
    expect(routeDeskMessage({ thread: null, threadId: "balcao", taskExists: () => true })).toEqual({ action: "new-task" });
  });
});
