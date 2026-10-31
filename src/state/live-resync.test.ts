// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, BotAnnouncement, Message } from "./store";

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() { this.closed = true; }
  send(frame: object, id?: string) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}

const line = (id: string): Message => ({ id, at: 1, role: "bot", kind: "text", text: id });
const bot = (messages?: Message[]): BotAnnouncement => ({
  id: "bot", threadId: "thread", name: "Fixture", title: "", description: "", notifications: true, unread: false, color: "green",
  modelSelection: { instanceId: "fake", model: "m" }, tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask" }],
  ...(messages ? { messages } : {}),
});
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
const peripherals: Record<string, unknown> = {
  "/api/instances": { instances: [] },
  "/api/config": {},
  "/api/routines": { routines: [], runs: [] },
  "/api/webhooks": { webhooks: [], attempts: [] },
  "/api/notifications": { notifications: [] },
};

const { StoreProvider, useStore } = await import("./store");

let seen!: AppState;
function Probe() {
  seen = useStore().state;
  return null;
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const latest = () => FixtureEventSource.opened.at(-1)!;

let root: Root;
let snapshots: string[];
let answer: (path: string) => Promise<Response>;

beforeEach(async () => {
  FixtureEventSource.opened = [];
  snapshots = [];
  answer = () => json({ cursor: "s:1", bots: [bot([line("first")])], groups: [] });
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string) => {
    if (!path.startsWith("/api/bots?")) return json(peripherals[path] ?? {});
    snapshots.push(path);
    return answer(path);
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
});
afterEach(() => {
  root.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function connected() {
  latest().send({ kind: "hello", resumed: false, cursor: "s:1" });
  await settle();
  expect(seen.bots[0]!.messages.map((message) => message.id)).toEqual(["first"]);
}

async function dropAndReturn(hello: object) {
  latest().onerror?.();
  await new Promise((resolve) => setTimeout(resolve, 600));
  latest().send(hello);
  await settle();
}

describe("coming back to a live stream", () => {
  it("asks only for what changed and keeps the conversation it already shows", async () => {
    await connected();
    latest().send({ kind: "message", threadId: "thread", message: line("second") }, "s:2");
    await settle();
    const shown = seen.bots[0]!.messages;

    answer = () => json({ cursor: "s:9", delta: true, bots: [{ ...bot(), busy: true }], groups: [] });
    await dropAndReturn({ kind: "hello", resumed: false, cursor: "s:9" });

    const asked = new URL(snapshots.at(-1)!, "http://x").searchParams;
    expect(asked.get("since")).toBe("s:2");
    expect(asked.get("held")).toBe("thread");
    expect(seen.bots[0]!.busy).toBe(true);
    expect(seen.bots[0]!.messages).toBe(shown);
  });

  it("keeps applying live frames when a snapshot fails and the stream then replays the gap", async () => {
    await connected();
    answer = () => Promise.reject(new TypeError("network down"));
    await dropAndReturn({ kind: "hello", resumed: false, cursor: "s:5" });

    // The failed snapshot drops that stream; the transport reconnects from the cursor it never advanced.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(FixtureEventSource.opened).toHaveLength(3);
    expect(new URL(latest().url, "http://x").searchParams.get("since")).toBe("s:1");
    latest().send({ kind: "hello", resumed: true, cursor: "s:5" });
    latest().send({ kind: "message", threadId: "thread", message: line("replayed") }, "s:2");
    await settle();
    expect(seen.bots[0]!.messages.map((message) => message.id)).toEqual(["first", "replayed"]);
  });

  it("does not download everything twice when the stream says hello after the start-up fallback", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(snapshots).toEqual(["/api/bots?messages=60&preview=6&focus=bot"]);
    answer = () => json({ cursor: "s:3", delta: true, bots: [bot()], groups: [] });
    latest().send({ kind: "hello", resumed: false, cursor: "s:3" });
    await settle();
    expect(snapshots).toHaveLength(2);
    expect(new URL(snapshots[1]!, "http://x").searchParams.get("since")).toBe("s:1");
    expect(seen.bots[0]!.messages.map((message) => message.id)).toEqual(["first"]);
  });
});
