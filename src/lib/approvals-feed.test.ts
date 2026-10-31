// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalId, type ApprovalItem } from "../../shared/approvals";
import type { ServerFrame } from "../../shared/wire";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  listeners: new Set<{ onFrame: (frame: unknown) => void; onMissedFrames?: () => void }>(),
}));
vi.mock("@/state/api", () => ({ api: fixture.api }));
vi.mock("@/lib/live-events", () => ({
  listenLiveFrames: (listener: { onFrame: (frame: unknown) => void; onMissedFrames?: () => void }) => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
}));
const { decidableCount, frameTouchesApprovals, itemFor, loadApprovals, useApprovalsFeed } = await import("./approvals-feed");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string, extra: Partial<ApprovalItem> = {}): ApprovalItem => ({
  id: approvalId("t-1", id), kind: "permission", botId: "atlas", botName: "Atlas", threadId: "t-1", messageId: id, requestId: `req-${id}`,
  title: "Atlas quer rodar", summary: "", fields: [], risk: "normal", requestedAt: 1, decider: "Administradores", canDecide: true, action: "decide", ...extra,
});
const frame = (value: object) => value as ServerFrame;

describe("what touches the list of what waits", () => {
  it.each(["options", "signin", "secret", "connector"] as const)("a %s line arriving or changing does", (kind) => {
    expect(frameTouchesApprovals(frame({ kind: "message", threadId: "t", message: { kind } }))).toBe(true);
    expect(frameTouchesApprovals(frame({ kind: "message.patch", threadId: "t", message: { kind } }))).toBe(true);
  });

  it("ignores ordinary chat lines, and answers to notifications and deletions matter", () => {
    expect(frameTouchesApprovals(frame({ kind: "message", threadId: "t", message: { kind: "text" } }))).toBe(false);
    expect(frameTouchesApprovals(frame({ kind: "message.patch", threadId: "t", message: { kind: "activity" } }))).toBe(false);
    for (const kind of ["notify", "notify.resolved", "bot.deleted", "group.deleted"]) expect(frameTouchesApprovals(frame({ kind })), kind).toBe(true);
    for (const kind of ["ping", "bot", "typing"]) expect(frameTouchesApprovals(frame({ kind })), kind).toBe(false);
  });
});

describe("reading the list", () => {
  it("counts only what this person may decide, and finds an item by its card", () => {
    const items = [item("a"), item("b", { canDecide: false }), item("c")];
    expect(decidableCount(items)).toBe(2);
    expect(itemFor(items, "t-1", "b")?.id).toBe("t-1.b");
    expect(itemFor(items, "t-1", "zz")).toBeUndefined();
    expect(itemFor(items, undefined, "a")).toBeUndefined();
  });
});

describe("the shared feed", () => {
  let host: HTMLDivElement;
  let root: Root;
  let seen: Array<{ items: readonly ApprovalItem[]; loaded: boolean; failed: boolean }> = [];
  const Probe = () => {
    const snapshot = useApprovalsFeed();
    seen.push(snapshot);
    return null;
  };
  const latest = () => seen.at(-1)!;
  const emit = (value: object) => act(async () => { for (const listener of fixture.listeners) listener.onFrame(value); });

  beforeEach(() => {
    vi.useFakeTimers();
    fixture.api.mockReset();
    fixture.listeners.clear();
    seen = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("loads on first use, follows live frames with one ask for a burst, and stops listening when no one is looking", async () => {
    fixture.api.mockResolvedValue({ items: [item("a")] });
    await act(async () => root.render(createElement(Probe)));
    expect(fixture.api).toHaveBeenCalledWith("/api/approvals", expect.objectContaining({ background: true }));
    expect(latest()).toMatchObject({ loaded: true, failed: false });
    expect(latest().items.map((one) => one.id)).toEqual(["t-1.a"]);
    expect(fixture.listeners.size).toBe(1);

    fixture.api.mockResolvedValue({ items: [item("a"), item("b")] });
    fixture.api.mockClear();
    await emit({ kind: "message", threadId: "t-1", message: { kind: "options" } });
    await emit({ kind: "message.patch", threadId: "t-1", message: { kind: "options" } });
    await emit({ kind: "notify", notification: {} });
    expect(fixture.api).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fixture.api).toHaveBeenCalledTimes(1);
    expect(latest().items.map((one) => one.id)).toEqual(["t-1.a", "t-1.b"]);

    fixture.api.mockClear();
    await emit({ kind: "ping" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fixture.api).not.toHaveBeenCalled();

    act(() => root.unmount());
    expect(fixture.listeners.size).toBe(0);
    root = createRoot(host);
  });

  it("keeps what it last knew and says so when an ask fails, then recovers", async () => {
    fixture.api.mockResolvedValue({ items: [item("a")] });
    await act(async () => root.render(createElement(Probe)));
    fixture.api.mockRejectedValue(new Error("offline"));
    await act(async () => { await loadApprovals(); });
    expect(latest()).toMatchObject({ loaded: true, failed: true });
    expect(latest().items.map((one) => one.id)).toEqual(["t-1.a"]);
    fixture.api.mockResolvedValue({ items: [] });
    await act(async () => { await loadApprovals(false); });
    expect(fixture.api).toHaveBeenLastCalledWith("/api/approvals", expect.objectContaining({ background: false }));
    expect(latest()).toMatchObject({ loaded: true, failed: false, items: [] });
  });

  it("does not wake the page for an answer that changes nothing", async () => {
    fixture.api.mockResolvedValue({ items: [item("a")] });
    await act(async () => root.render(createElement(Probe)));
    const renders = seen.length;
    await act(async () => { await loadApprovals(); });
    await act(async () => { await loadApprovals(); });
    expect(seen.length).toBe(renders);
  });
});
