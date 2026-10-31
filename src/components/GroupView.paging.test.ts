// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), olderFailed: {} as Record<string, true> }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: { ...original.initialState, olderFailed: fixture.olderFailed }, dispatch: fixture.dispatch }),
  };
});
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { homeDir: "/home/me" } } }),
  useCaptionChrome: () => ({ dragProps: {}, noDragStyle: undefined, controlsShiftStyle: undefined }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { GroupView } = await import("./GroupView");
const { t } = await import("@/lib/i18n");

const room: Group = {
  id: "room",
  threadId: "room-thread",
  name: "Room",
  memberIds: [],
  defaultResponder: { kind: "everyone" },
  bulletin: "",
  unread: false,
  createdAt: 1,
  setupCompletedAt: 1,
  messages: [],
};

let host: HTMLDivElement;
let root: Root;

const retryButton = () =>
  [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(t("chat.loadEarlier")));

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.olderFailed = { "room-thread": true };
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(GroupView, { group: room })));
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("room older-page retry", () => {
  it("shows the retry control instead of an invisible top sentinel", () => {
    expect(host.textContent).toContain(t("chat.loadEarlierFailed"));
    expect(host.querySelector(".h-2.w-full")).toBeNull();
  });

  it("asks for the older page when a member presses retry", () => {
    const retry = retryButton();
    expect(retry).toBeDefined();
    flushSync(() => retry!.click());
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toContainEqual({ type: "loadOlderMessages", threadId: "room-thread" });
  });
});
