// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, Message, Task } from "@/state/store";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/store")>(), api: fixture.api }));

const { useNotchFeed } = await import("./use-notch-feed");

const card = (extra: Partial<NonNullable<Message["card"]>> = {}): Message => ({
  id: "approval-1", role: "bot", kind: "options", at: 1,
  card: { title: "Approval needed", subtitle: "pnpm build", options: ["Allow", "Deny"], requestId: "req-1", tool: "Bash", intent: "publicar o carrossel", ...extra },
});
const task = (threadId: string, extra: Partial<Task> = {}): Task => ({ threadId, title: threadId, createdAt: 1, ...extra });
const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-main`, name: id[0]!.toUpperCase() + id.slice(1), title: "", description: "", color: "blue", notifications: false,
  unread: false, messages: [], modelSelection: { instanceId: "fake", model: "fake" }, tasks: [task(`${id}-main`)], ...extra,
});

function Probe({ bots, dispatch }: { bots: Bot[]; dispatch: (action: never) => void }) {
  useNotchFeed({ bots }, dispatch as never);
  return null;
}

describe("the notch feed", () => {
  let root: Root;
  let container: HTMLDivElement;
  const publish = vi.fn();
  const stop = vi.fn();
  let decide: ((decision: { id: string; decision: "approve" | "decline" }) => void) | undefined;
  const dispatch = vi.fn();

  const show = async (bots: Bot[]) => {
    flushSync(() => root.render(createElement(Probe, { bots, dispatch })));
    await vi.waitFor(() => expect(fixture.api.mock.settledResults.every((result) => result.type !== "incomplete")).toBe(true));
    await Promise.resolve();
    flushSync(() => {});
  };
  const lastFeed = () => publish.mock.calls.at(-1)![0] as { agents: Array<{ id: string }>; approvals: Array<{ id: string; decidable: boolean; text: string }> };

  beforeEach(() => {
    setLocale("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    publish.mockReset().mockResolvedValue(true);
    stop.mockReset();
    decide = undefined;
    (window as unknown as { ogb?: unknown }).ogb = { notch: { publish, onDecision: (cb: typeof decide) => { decide = cb; return stop; } } };
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    delete (window as unknown as { ogb?: unknown }).ogb;
    fixture.api.mockReset();
    dispatch.mockReset();
  });

  it("does nothing where there is no notch bridge", async () => {
    delete (window as unknown as { ogb?: unknown }).ogb;
    await show([bot("maya", { tasks: [task("maya-main", { activity: "waiting-on-you" }), task("maya-report", { activity: "waiting-on-you" })] })]);
    expect(publish).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("tells the desktop who is working, and says it again only when something changed", async () => {
    const maya = bot("maya", { tasks: [task("maya-main", { activity: "working", turnStartedAt: 1 })] });
    await show([maya]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(lastFeed().agents.map((agent) => agent.id)).toEqual(["maya"]);

    await show([{ ...maya, messages: [...maya.messages] }]);
    expect(publish).toHaveBeenCalledTimes(1);

    await show([maya, bot("caio", { tasks: [task("caio-main", { activity: "working", turnStartedAt: 2 })] })]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(lastFeed().agents.map((agent) => agent.id)).toEqual(["caio", "maya"]);

    await show([]);
    expect(lastFeed()).toMatchObject({ agents: [], approvals: [] });
  });

  it("reads a request waiting in another conversation and offers it once it is known", async () => {
    fixture.api.mockResolvedValue({ messages: [card({ requestId: "req-9" })] });
    const maya = bot("maya", { tasks: [task("maya-main", { activity: "working" }), task("maya-report", { activity: "waiting-on-you", updatedAt: 9 })] });

    await show([maya]);

    expect(fixture.api).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\/api\/threads\/maya-report\/messages\?limit=\d+$/));
    await vi.waitFor(() => expect(lastFeed().approvals).toEqual([expect.objectContaining({ id: "maya-report:req-9", decidable: true, text: "I want to publicar o carrossel." })]));
  });

  it("answers the request the notch names, as the card in the conversation would", async () => {
    const maya = bot("maya", { messages: [card()], tasks: [task("maya-main", { activity: "waiting-on-you" })] });
    await show([maya]);
    expect(lastFeed().approvals[0]!.id).toBe("maya-main:req-1");

    decide!({ id: "maya-main:req-1", decision: "approve" });
    expect(dispatch).toHaveBeenLastCalledWith({ type: "decideRequest", threadId: "maya-main", requestId: "req-1", behavior: "allow", message: undefined });

    decide!({ id: "maya-main:req-1", decision: "decline" });
    expect(dispatch).toHaveBeenLastCalledWith({ type: "decideRequest", threadId: "maya-main", requestId: "req-1", behavior: "deny", message: "Denied by the user." });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("answers nothing it did not offer", async () => {
    const critical = bot("maya", { messages: [card({ heldCode: "approval.held.sensitive" })], tasks: [task("maya-main", { activity: "waiting-on-you" })] });
    await show([critical]);

    decide!({ id: "maya-main:req-1", decision: "approve" });
    decide!({ id: "elsewhere:req-2", decision: "approve" });
    decide!({ id: "maya-main:req-1", decision: "allow" as never });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("goes quiet when the page closes", async () => {
    await show([bot("maya", { tasks: [task("maya-main", { activity: "working" })] })]);
    publish.mockClear();

    flushSync(() => root.unmount());

    expect(stop).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toMatchObject({ agents: [], approvals: [] });
    root = createRoot(container);
  });
});
