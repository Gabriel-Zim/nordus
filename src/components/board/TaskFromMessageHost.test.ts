// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { fakeBoard, makeBot, myEmail } from "@/testing/board";
import { choose, click, press, settle, submit, typeInto } from "@/testing/board-dom";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@/state/api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/api")>(), api: fixture.api }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/message-author", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/message-author")>(), useMe: () => ({ email: "rafael@nordus.test", name: "Rafael" }) }));
vi.mock("../Avatar", async () => {
  const { createElement: h } = await import("react");
  return {
    BotAvatar: ({ label }: { label?: string }) => h("span", { "data-avatar": label ?? "" }),
    InitialsAvatar: ({ initials }: { initials: string }) => h("span", { "data-avatar": initials }),
  };
});
const { TaskFromMessageHost } = await import("./TaskFromMessageHost");
const { CreateTaskDialog } = await import("../lazy-screens");
const { closeTaskDraft, openTaskFromMessage, takeBoardFocus } = await import("@/lib/board-compose");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let server: ReturnType<typeof fakeBoard>;

beforeEach(async () => {
  setLocale("en");
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.state = { bots: [makeBot("dev", "Dev"), makeBot("atlas", "Atlas")], groups: [], config: { profile: { name: "Rafael", email: myEmail } } };
  server = fakeBoard({ people: [{ id: "ada@nordus.test", name: "Ada Lovelace" }] });
  fixture.api.mockImplementation(server.handle);
  await CreateTaskDialog.preload();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(TaskFromMessageHost)));
});
afterEach(() => {
  act(() => closeTaskDraft());
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  takeBoardFocus();
});

const open = async (text = "Fix the login bug\nUsers cannot sign in on Safari.", extra: { groupId?: string } = {}) => {
  await act(async () => openTaskFromMessage({ threadId: "t1", messageId: "m9", text, ...extra }));
  await settle();
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label);
const created = () => host.querySelector<HTMLElement>("[data-task-created]");

describe("creating a task from a message", () => {
  it("opens a small dialog with the title and description taken from the message", async () => {
    expect(dialog()).toBeNull();
    await open();
    expect(dialog()!.getAttribute("aria-label")).toBe("Create task");
    expect(dialog()!.querySelector<HTMLInputElement>("input")!.value).toBe("Fix the login bug");
    expect(dialog()!.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Users cannot sign in on Safari.");
    expect(dialog()!.querySelector('button[role="combobox"]')!.textContent).toBe("No assignee");
    expect(button("Create task")!.disabled).toBe(false);
  });

  it("sends the task with the conversation and message it came from, then offers the board", async () => {
    await open("Fix the login bug\nUsers cannot sign in on Safari.", { groupId: "room-1" });
    await choose(dialog()!.querySelector('button[role="combobox"]'), "Dev");
    await submit(dialog()!.querySelector("form"));
    await settle();
    expect(server.requests("POST", "/api/board/tasks")[0]!.body).toEqual({
      title: "Fix the login bug",
      description: "Users cannot sign in on Safari.",
      assignee: "dev",
      source: { threadId: "t1", groupId: "room-1", messageId: "m9" },
    });
    expect(dialog()).toBeNull();
    expect(created()!.getAttribute("role")).toBe("status");
    expect(created()!.textContent).toContain("Task #1 created");
    expect(created()!.textContent).toContain("Sent to Dev");
    await click(button("Open board"));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showBoard" });
    expect(takeBoardFocus()).toEqual({ taskId: 1 });
    expect(created()).toBeNull();
  });

  it("sends a one-to-one chat message without a room, and an edited title as it was edited", async () => {
    await open("Call the bank");
    await typeInto(dialog()!.querySelector("input"), "  Call the bank today  ");
    await submit(dialog()!.querySelector("form"));
    await settle();
    expect(server.requests("POST", "/api/board/tasks")[0]!.body).toEqual({ title: "Call the bank today", source: { threadId: "t1", messageId: "m9" } });
    expect(created()!.textContent).toContain("Task #1 created");
    expect(created()!.textContent).not.toContain("Sent to");
  });

  it("gives the task to a person without telling any agent", async () => {
    await open();
    await choose(dialog()!.querySelector('button[role="combobox"]'), "Ada Lovelace");
    await submit(dialog()!.querySelector("form"));
    await settle();
    expect(server.requests("POST", "/api/board/tasks")[0]!.body).toMatchObject({ assignee: "ada@nordus.test" });
    expect(created()!.textContent).not.toContain("Sent to");
  });

  it("will not create a task without a title", async () => {
    await open();
    await typeInto(dialog()!.querySelector("input"), "   ");
    expect(button("Create task")!.disabled).toBe(true);
    await submit(dialog()!.querySelector("form"));
    expect(server.requests("POST")).toHaveLength(0);
  });

  it("keeps the dialog open and says why when the task could not be created", async () => {
    await open();
    server.fail("POST /api/board/tasks", "The board is full");
    await submit(dialog()!.querySelector("form"));
    await settle();
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe("Could not create the task: The board is full");
    expect(dialog()!.querySelector<HTMLInputElement>("input")!.value).toBe("Fix the login bug");
    expect(created()).toBeNull();
  });

  it("closes without asking the server, with Cancel or Escape", async () => {
    await open();
    await click(button("Cancel"));
    expect(dialog()).toBeNull();
    await open();
    await press("Escape", dialog()!);
    expect(dialog()).toBeNull();
    expect(server.requests("POST")).toHaveLength(0);
  });

  it("lets the notice be dismissed", async () => {
    await open();
    await submit(dialog()!.querySelector("form"));
    await settle();
    await click(document.querySelector('button[aria-label="Dismiss"]'));
    expect(created()).toBeNull();
  });

  it("takes the notice away by itself after a while", async () => {
    await open();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await submit(dialog()!.querySelector("form"));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(created()).not.toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(created()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
