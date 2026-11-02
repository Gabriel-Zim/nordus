// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message, Task } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: {}, dispatch: fixture.dispatch }),
}));
const viewer = { ownerOrAdmin: false };
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => viewer.ownerOrAdmin }));

const { OtherThreadApproval } = await import("./OtherThreadApproval");

const approval = (extra: Partial<NonNullable<Message["card"]>> = {}): Message => ({
  id: "approval-1", role: "bot", kind: "options", at: 1,
  card: {
    title: "Approval needed", subtitle: "pnpm build", options: ["Allow", "Deny"],
    requestId: "req-1", tool: "Bash", allowKey: "Bash:pnpm", intent: "publicar o carrossel", ...extra,
  },
});
const task = (threadId: string, extra: Partial<Task> = {}): Task => ({ threadId, title: threadId, createdAt: 1, ...extra });
const designer = (tasks: Task[], threadId = "main"): Bot => ({
  id: "designer", threadId, name: "Designer", title: "", description: "", color: "blue", notifications: false,
  unread: false, messages: [], modelSelection: { instanceId: "fake", model: "fake" }, tasks,
});
const carousel = task("carousel", { title: "Carrossel Built to Endure", activity: "waiting-on-you", updatedAt: 7 });
const main = task("main", { title: "Conversa", activity: "working" });

describe("the approval pinned above the message box when the bot waits in another thread", () => {
  let root: Root;
  let container: HTMLDivElement;
  const show = async (bot: Bot) => {
    flushSync(() => root.render(createElement(OtherThreadApproval, { bot })));
    await vi.waitFor(() => expect(fixture.api.mock.settledResults.every((result) => result.type !== "incomplete")).toBe(true));
    await Promise.resolve();
    flushSync(() => {});
  };
  const button = (label: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    fixture.api.mockReset();
  });

  it("shows who asks, the sentence and the answers, read from the waiting thread, with no task around it", async () => {
    fixture.api.mockResolvedValue({ messages: [approval()] });
    await show(designer([main, carousel]));
    expect(fixture.api).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\/api\/threads\/carousel\/messages\?limit=\d+$/));
    const text = container.textContent ?? "";
    expect(text).toContain("Designer asks for your approval");
    expect(text).toContain("I want to publicar o carrossel.");
    expect(text).not.toContain("Carrossel Built to Endure");
    for (const label of ["Allow once", "Always allow", "Deny"]) expect(button(label)).toBeDefined();
    expect(button("Open task")).toBeUndefined();
  });

  it("answers the request in the waiting thread, not the open one", async () => {
    fixture.api.mockResolvedValue({ messages: [approval()] });
    await show(designer([main, carousel]));
    button("Allow once")!.click();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "decideRequest", threadId: "carousel", requestId: "req-1", behavior: "allow" }));
    button("Deny")!.click();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "decideRequest", threadId: "carousel", requestId: "req-1", behavior: "deny" }));
  });

  it("releases that other task from its pinned card, for the owner or an admin only", async () => {
    fixture.api.mockResolvedValue({ messages: [approval({ canReleaseTask: true })] });
    await show(designer([main, carousel]));
    expect(button("Allow everything in this task")).toBeUndefined();
    viewer.ownerOrAdmin = true;
    try {
      await show(designer([main, carousel]));
    } finally {
      viewer.ownerOrAdmin = false;
    }
    button("Allow everything in this task")!.click();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "decideRequest", threadId: "carousel", requestId: "req-1", behavior: "allow", releaseTask: true }));
  });

  it("offers no release around the hold on a critical action, even to the owner or an admin", async () => {
    fixture.api.mockResolvedValue({ messages: [approval({ heldCode: "approval.held.sensitive", canReleaseTask: true })] });
    viewer.ownerOrAdmin = true;
    try {
      await show(designer([main, carousel]));
    } finally {
      viewer.ownerOrAdmin = false;
    }
    expect(container.querySelector("[data-hold-to-approve]")).not.toBeNull();
    expect(button("Allow everything in this task")).toBeUndefined();
    expect(button("Always allow")).toBeUndefined();
  });

  it("offers no Always allow for a critical action", async () => {
    fixture.api.mockResolvedValue({ messages: [approval({ heldCode: "approval.held.sensitive", held: "Sensitive" })] });
    await show(designer([main, carousel]));
    expect(container.querySelector("[data-hold-to-approve]")).not.toBeNull();
    expect(button("Allow once")).toBeUndefined();
    expect(button("Always allow")).toBeUndefined();
  });

  it("shows nothing when the approval was already answered", async () => {
    fixture.api.mockResolvedValue({ messages: [approval({ answered: "allow" })] });
    await show(designer([main, carousel]));
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing when the waiting thread holds no open request, as after a restart", async () => {
    fixture.api.mockResolvedValue({ messages: [] });
    await show(designer([main, carousel]));
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing when the messages cannot be read", async () => {
    fixture.api.mockRejectedValue(new Error("offline"));
    await show(designer([main, carousel]));
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing when the open thread is the one waiting, so the timeline card is not doubled", async () => {
    await show(designer([{ ...main, activity: "waiting-on-you" }, task("idle")]));
    expect(container.innerHTML).toBe("");
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("shows nothing when no task waits on the person", async () => {
    await show(designer([main, task("quiet", { activity: "idle" })]));
    expect(container.innerHTML).toBe("");
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("reads the thread again when the waiting task changes", async () => {
    fixture.api.mockResolvedValue({ messages: [approval()] });
    await show(designer([main, carousel]));
    await show(designer([main, { ...carousel, updatedAt: 8 }]));
    expect(fixture.api).toHaveBeenCalledTimes(2);
  });
});
