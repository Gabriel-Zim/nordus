import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), showThreads: true }));
const scout: Bot = {
  id: "scout", threadId: "scout-main", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [
    { threadId: "scout-main", title: "Main", createdAt: 1 },
    { threadId: "qa-245", title: "QA PR 245", createdAt: 2, openedBy: { botId: "ada", name: "Ada", at: 2 } },
  ],
};
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: [scout] }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));
import { setLocale } from "@/lib/i18n";
import { ThreadChip } from "./ThreadChip";

const receipt = (threadId = "qa-245"): Message => ({
  id: "receipt", role: "bot", kind: "activity", at: 3,
  tool: { name: "Opened thread #QA PR 245 on Scout", ok: true },
  threadRef: { botId: "scout", threadId, title: "QA PR 245" },
});

type ElementProps = { children?: ReactNode; onClick?: () => void; [key: string]: unknown };
function findElement(tree: ReactNode, attribute: string): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (attribute in child.props) return child;
    const found = findElement(child.props.children, attribute);
    if (found) return found;
  }
}

beforeEach(() => { fixture.dispatch.mockClear(); fixture.showThreads = true; });

describe("ThreadChip", () => {
  it("renders the receipt as a pill named for the thread it opens", () => {
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }));
    expect(markup).toContain("<button");
    expect(markup).toContain("Opened thread #QA PR 245 on Scout");
    expect(markup).toContain('title="Open #QA PR 245"');
    expect(markup).toContain('data-thread-chip="qa-245"');
  });

  it("renders a task the bot opened on itself as one balloon card: avatar, Opened the task, the title, its status line", () => {
    const opened: Message = {
      id: "opened", role: "bot", kind: "activity", at: 3,
      tool: { name: "Opened thread #QA PR 245", ok: true },
      threadRef: { botId: "scout", threadId: "qa-245", title: "QA PR 245", statusLine: "I'll call you when the light version is ready" },
    };
    const markup = renderToStaticMarkup(createElement(ThreadChip, { message: opened }));
    expect(markup).toContain('data-task-card="qa-245"');
    expect(markup).toContain('data-thread-chip="qa-245"');
    expect(markup).toContain("Opened the task");
    expect(markup).toMatch(/data-task-card-title="[^"]*"[^>]*>QA PR 245</);
    expect(markup).toContain("I&#x27;ll call you when the light version is ready");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("Opened thread #");
  });

  it("speaks Portuguese on the card and on a task opened on a teammate", () => {
    setLocale("pt-br");
    try {
      const opened: Message = { ...receipt(), tool: { name: "Opened thread #QA PR 245", ok: true } };
      expect(renderToStaticMarkup(createElement(ThreadChip, { message: opened }))).toContain("Abriu a tarefa");
      expect(renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }))).toContain("Abriu a tarefa #QA PR 245 para Scout");
    } finally {
      setLocale("en");
    }
  });

  it("keeps a handoff receipt as a pill, not a task card", () => {
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: receipt() }))).not.toContain("data-task-card");
  });

  it("renders nothing without a thread reference", () => {
    expect(renderToStaticMarkup(createElement(ThreadChip, { message: { ...receipt(), threadRef: undefined } }))).toBe("");
  });

  it("clicking shows that thread: select the bot, switch the view, reveal the row", () => {
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt() }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "switchTask", botId: "scout", threadId: "qa-245" },
      { type: "revealThread", threadId: "qa-245" },
    ]);
  });

  it("with threads hidden, the switch alone shows it, so the thread the bot was on stays unread", () => {
    fixture.showThreads = false;
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt() }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "switchTask", botId: "scout", threadId: "qa-245" },
      { type: "revealThread", threadId: "qa-245" },
    ]);
  });

  it("falls back to the bot with a notice when the thread was deleted", () => {
    let tree: ReactNode;
    function Capture() { tree = ThreadChip({ message: receipt("gone") }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    findElement(tree, "data-thread-chip")!.props.onClick!();
    expect(fixture.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "notice", notice: { kind: "thread-gone", botName: "Scout" } },
    ]);
  });
});
