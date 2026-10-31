import { describe, expect, it, vi } from "vitest";

import { openNotificationTarget, visibleNotificationThread } from "./thread-navigation";

const state = { bots: [], groups: [] } as unknown as Parameters<typeof openNotificationTarget>[2];

describe("a notification about a direct message", () => {
  it("opens the conversation and nothing else", () => {
    const dispatch = vi.fn();
    openNotificationTarget(dispatch, { botId: "", threadId: "dm:abc" } as Parameters<typeof openNotificationTarget>[1], state, true);
    expect(dispatch.mock.calls).toEqual([[{ type: "showDirect", id: "abc" }]]);
  });

  it("leaves other threads to the usual navigation", () => {
    const dispatch = vi.fn();
    openNotificationTarget(dispatch, { botId: "missing", threadId: "t1" } as Parameters<typeof openNotificationTarget>[1], state, true);
    expect(dispatch.mock.calls.some(([action]) => action.type === "showDirect")).toBe(false);
  });
});

describe("the thread a person is looking at", () => {
  it("is the open direct message, so its own banner stays quiet", () => {
    expect(visibleNotificationThread({ bots: [], groups: [], activeView: "direct", selectedId: "", directId: "abc" })).toBe("dm:abc");
    expect(visibleNotificationThread({ bots: [], groups: [], activeView: "direct", selectedId: "", directId: null })).toBeNull();
  });

  it("is still nothing on the other screens", () => {
    expect(visibleNotificationThread({ bots: [], groups: [], activeView: "routines", selectedId: "", directId: "abc" })).toBeNull();
  });
});
