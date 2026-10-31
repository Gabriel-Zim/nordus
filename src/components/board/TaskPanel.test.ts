// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { at, fakeBoard, makeBot, makeMission, makeTask, myEmail, person } from "@/testing/board";
import { choose, click, leave, press, settle, textOf, typeInto } from "@/testing/board-dom";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), openThread: vi.fn(), admin: false, state: {} as Record<string, unknown> }));
vi.mock("@/state/api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/api")>(), api: fixture.api }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  openThread: fixture.openThread,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));
vi.mock("../DesktopCapabilities", () => ({ useCaptionChrome: () => ({ dragProps: {}, noDragStyle: undefined }) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/lib/message-author", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/message-author")>(), useMe: () => ({ email: "rafael@nordus.test", name: "Rafael" }) }));
vi.mock("../Avatar", async () => {
  const { createElement: h } = await import("react");
  return {
    BotAvatar: ({ label }: { label?: string }) => h("span", { "data-avatar": label ?? "" }),
    InitialsAvatar: ({ initials }: { initials: string }) => h("span", { "data-avatar": initials }),
  };
});
const { BoardPage } = await import("../BoardPage");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let server: ReturnType<typeof fakeBoard>;

const ada = { kind: "person", id: "ada@nordus.test", name: "Ada Lovelace" } as const;
const seed = () => [
  makeTask(1, { title: "Write the brief", updatedAt: at(27, 9) }),
  makeTask(3, {
    title: "Review the budget",
    description: "Check every line",
    status: "doing",
    assignee: "dev",
    updatedAt: at(27, 11),
    source: { threadId: "thread-9", messageId: "msg-1" },
    history: [
      { at: at(27, 9), by: person, event: "created" },
      { at: at(27, 10), by: person, event: "assigned", assignee: "dev" },
      { at: at(27, 11), by: { kind: "bot", id: "dev" }, from: "todo", to: "doing" },
    ],
  }),
  makeTask(4, { title: "Written by Ada", createdBy: ada, updatedAt: at(27, 12) }),
  makeTask(5, { title: "Prepare the slides", assignee: "atlas", updatedAt: at(27, 8) }),
];

beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.openThread.mockReset();
  fixture.admin = false;
  fixture.state = {
    bots: [makeBot("dev", "Dev"), makeBot("atlas", "Atlas"), makeBot("nina", "Nina")],
    groups: [],
    config: { profile: { name: "Rafael", email: myEmail } },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function show(extra: Parameters<typeof fakeBoard>[0] = {}) {
  server = fakeBoard({ tasks: seed(), people: [{ id: "ada@nordus.test", name: "Ada Lovelace" }], ...extra });
  fixture.api.mockImplementation(server.handle);
  await act(async () => root.render(createElement(BoardPage)));
  await settle();
}
const opener = (id: number) => host.querySelector<HTMLElement>(`li[data-task-id="${id}"] [data-task-open]`)!;
const open = async (id: number) => {
  await click(opener(id));
  return host.querySelector<HTMLElement>('[data-testid="board-task-panel"]')!;
};
const panel = () => host.querySelector<HTMLElement>('[data-testid="board-task-panel"]');
const field = (label: string) => panel()!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const menu = (label: string) => panel()!.querySelector(`button[role="combobox"][aria-label="${label}"]`);
const button = (label: string) => [...panel()!.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label);
const notice = () => host.querySelector("[data-board-notice]")?.textContent;

describe("opening a task", () => {
  it("shows its title, owner, status, description and history in order", async () => {
    await show();
    const side = await open(3);
    expect(side.getAttribute("aria-label")).toBe("Task #3");
    expect(textOf(side.querySelectorAll("header span"))).toEqual(["#3"]);
    expect(field("Title").value).toBe("Review the budget");
    expect(menu("Assignee")!.textContent).toBe("Dev");
    expect(menu("Status")!.textContent).toBe("In progress");
    expect(side.querySelector("textarea")!.value).toBe("Check every line");
    expect(textOf(side.querySelectorAll("[data-task-history] li > span:first-child"))).toEqual([
      "You created the task", "You passed it to Dev", "Dev moved it from To do to In progress",
    ]);
    expect(side.querySelectorAll("[data-task-history] time")).toHaveLength(3);
    expect(host.querySelector('li[data-task-id="3"]')!.hasAttribute("data-selected")).toBe(true);
  });

  it("closes with Escape, with the Close button, and gives focus back to the card", async () => {
    await show();
    await open(3);
    await press("Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener(3));
    await open(1);
    await click(panel()!.querySelector('button[aria-label="Close"]'));
    expect(panel()).toBeNull();
  });

  it("opens from the keyboard with Enter on the card", async () => {
    await show();
    await act(async () => { opener(1).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(panel()!.getAttribute("aria-label")).toBe("Task #1");
  });

  it("closes by itself when the task is deleted somewhere else", async () => {
    await show();
    await open(3);
    const { publishLiveFrame } = await import("@/lib/live-events");
    await act(async () => publishLiveFrame({ kind: "board.task.deleted", id: 3 } as never));
    expect(panel()).toBeNull();
  });
});

describe("editing a task", () => {
  it("saves a new title when the field loses focus, and the card shows it", async () => {
    await show();
    await open(3);
    await typeInto(field("Title"), "  Review the new budget  ");
    expect(button("Save")).toBeDefined();
    await leave(field("Title"));
    await settle();
    expect(server.requests("PATCH")).toHaveLength(1);
    expect(server.requests("PATCH")[0]).toMatchObject({ path: "/api/board/tasks/3", body: { title: "Review the new budget" } });
    expect(host.querySelector('li[data-task-id="3"]')!.textContent).toContain("Review the new budget");
    expect(button("Save")).toBeUndefined();
  });

  it("saves with the Save button once, even if the field also loses focus", async () => {
    await show();
    await open(3);
    await typeInto(field("Title"), "Renamed");
    await click(button("Save"));
    await leave(field("Title"));
    await settle();
    expect(server.requests("PATCH")).toHaveLength(1);
  });

  it("saves the description and does nothing when nothing changed or the title is emptied", async () => {
    await show();
    await open(3);
    await typeInto(panel()!.querySelector("textarea"), "Check every line twice");
    await leave(panel()!.querySelector("textarea"));
    await settle();
    expect(server.requests("PATCH")[0]!.body).toEqual({ description: "Check every line twice" });
    await typeInto(field("Title"), "   ");
    await leave(field("Title"));
    await typeInto(field("Title"), "Review the budget");
    await leave(field("Title"));
    await settle();
    expect(server.requests("PATCH")).toHaveLength(1);
    expect(field("Title").value).toBe("Review the budget");
  });

  it("saves a draft that is still open when the panel is closed", async () => {
    await show();
    await open(3);
    await typeInto(field("Title"), "Closed while typing");
    await press("Escape");
    await settle();
    expect(panel()).toBeNull();
    expect(server.requests("PATCH")[0]!.body).toEqual({ title: "Closed while typing" });
  });

  it("says why a title could not be saved and keeps the old one", async () => {
    await show();
    server.fail("PATCH /api/board/tasks/3", "Only the owner can rename this task");
    await open(3);
    await typeInto(field("Title"), "Another name");
    await leave(field("Title"));
    await settle();
    expect(notice()).toBe("Could not save: Only the owner can rename this task");
    expect(host.querySelector('li[data-task-id="3"]')!.textContent).toContain("Review the budget");
  });

  it("changes the status from the panel and moves the card", async () => {
    await show();
    await open(3);
    await choose(menu("Status"), "In review");
    await settle();
    expect(server.requests("PATCH")[0]!.body).toEqual({ status: "review" });
    expect(host.querySelector('[data-board-column="review"] li[data-task-id="3"]')).not.toBeNull();
    expect(panel()!.querySelector("[data-task-dispatch]")).toBeNull();
  });

  it("tells whether the agent was reached when starting a task moves it into progress", async () => {
    await show();
    await open(5);
    await choose(menu("Status"), "In progress");
    await settle();
    expect(panel()!.querySelector("[data-task-dispatch]")!.textContent).toBe("Sent to Atlas");
  });
});

describe("giving a task to someone", () => {
  it("tells whether the agent was reached when the task goes to an agent", async () => {
    await show();
    await open(1);
    await choose(menu("Assignee"), "Nina");
    await settle();
    expect(server.requests("PATCH")[0]!.body).toEqual({ assignee: "nina" });
    expect(panel()!.querySelector("[data-task-dispatch]")!.textContent).toBe("Sent to Nina");
    expect(menu("Assignee")!.textContent).toBe("Nina");
    expect(host.querySelector('li[data-task-id="1"] [data-assignee]')!.getAttribute("data-assignee")).toBe("nina");
    expect(textOf(panel()!.querySelectorAll("[data-task-history] li > span:first-child")).at(-1)).toBe("You passed it to Nina");
  });

  it("says when the agent has a queue, and when it could not be told, and why", async () => {
    await show();
    server.store.dispatch = { status: "queued" };
    await open(1);
    await choose(menu("Assignee"), "Atlas");
    await settle();
    expect(panel()!.querySelector("[data-task-dispatch]")!.textContent).toBe("In Atlas's queue");
    server.store.dispatch = { status: "skipped", reason: "Nina is offline" };
    await choose(menu("Assignee"), "Nina");
    await settle();
    expect(panel()!.querySelector("[data-task-dispatch]")!.textContent).toBe("Could not tell Nina: Nina is offline");
    server.store.dispatch = { status: "skipped" };
    await choose(menu("Assignee"), "Dev");
    await settle();
    expect(panel()!.querySelector("[data-task-dispatch]")!.textContent).toBe("Could not tell Dev");
  });

  it("gives a task to a person without telling any agent, and takes it back", async () => {
    await show();
    await open(1);
    await choose(menu("Assignee"), "Ada Lovelace");
    await settle();
    expect(server.requests("PATCH")[0]!.body).toEqual({ assignee: "ada@nordus.test" });
    expect(panel()!.querySelector("[data-task-dispatch]")).toBeNull();
    await choose(menu("Assignee"), "No assignee");
    await settle();
    expect(server.requests("PATCH")[1]!.body).toEqual({ assignee: null });
    expect(menu("Assignee")!.textContent).toBe("No assignee");
  });

  it("offers agents and people in separate groups", async () => {
    await show();
    await open(1);
    await click(menu("Assignee"));
    const items = textOf(document.querySelectorAll("[data-nordus-select-menu] > div"));
    expect(items).toEqual(["No assignee", "Agents", "Dev", "Atlas", "Nina", "People", "Ada Lovelace"]);
  });
});

describe("links", () => {
  it("adds a web link with or without a name, and shows it as a safe link", async () => {
    await show();
    await open(1);
    await typeInto(field("Link address (https://…)"), "https://example.com/docs");
    await typeInto(field("Name (optional)"), "Docs");
    await click(button("Add link"));
    await settle();
    expect(server.requests("PATCH")[0]!.body).toEqual({ links: [{ url: "https://example.com/docs", label: "Docs" }] });
    await typeInto(field("Link address (https://…)"), "http://news.example.org");
    await click(button("Add link"));
    await settle();
    expect(server.requests("PATCH")[1]!.body).toEqual({ links: [{ url: "https://example.com/docs", label: "Docs" }, { url: "http://news.example.org/" }] });
    const links = [...panel()!.querySelectorAll<HTMLAnchorElement>("[data-task-link] a")];
    expect(links.map((link) => link.textContent)).toEqual(["Docs", "news.example.org"]);
    expect(links.map((link) => link.getAttribute("rel"))).toEqual(["noopener noreferrer", "noopener noreferrer"]);
    expect(links.map((link) => link.getAttribute("target"))).toEqual(["_blank", "_blank"]);
  });

  it.each(["javascript:alert(1)", "ftp://example.com/file", "example.com", "data:text/html,hi"])("refuses %s, which is not a web link", async (address) => {
    await show();
    await open(1);
    await typeInto(field("Link address (https://…)"), address);
    await click(button("Add link"));
    expect(panel()!.querySelector('[role="alert"]')!.textContent).toBe("Use a link that starts with http:// or https://");
    expect(server.requests("PATCH")).toHaveLength(0);
  });

  it("removes a link", async () => {
    await show({ tasks: [makeTask(1, { links: [{ url: "https://example.com/", label: "Docs" }, { url: "https://other.example.com/" }] })] });
    await open(1);
    await click(panel()!.querySelector('button[aria-label="Remove Docs"]'));
    await settle();
    expect(server.requests("PATCH")[0]!.body).toEqual({ links: [{ url: "https://other.example.com/" }] });
  });
});

describe("going to the conversation or the mission", () => {
  it("opens the conversation the task came from, with the agent it was given to", async () => {
    await show();
    await open(3);
    await click(button("Open conversation"));
    expect(fixture.openThread).toHaveBeenCalledWith(fixture.dispatch, { botId: "dev", threadId: "thread-9" }, fixture.state, true);
  });

  it("prefers the conversation an agent was sent to over the one the task came from", async () => {
    await show({ tasks: [makeTask(7, { assignee: "atlas", source: { threadId: "thread-9" }, thread: { threadId: "thread-atlas", botId: "atlas" } })] });
    await open(7);
    await click(button("Open conversation"));
    expect(fixture.openThread).toHaveBeenCalledWith(fixture.dispatch, { botId: "atlas", threadId: "thread-atlas" }, fixture.state, true);
  });

  it("hides the button when the task has no conversation", async () => {
    await show();
    await open(1);
    expect(button("Open conversation")).toBeUndefined();
  });

  it("opens the mission a task belongs to", async () => {
    await show({ tasks: [makeTask(8, { missionId: "m1" })], missions: [makeMission({ stepIds: [8] })] });
    await open(8);
    await click(button("Open mission: Launch the newsletter"));
    expect(host.querySelector('[data-testid="mission-view"]')).not.toBeNull();
    expect(panel()).toBeNull();
  });
});

describe("deleting a task", () => {
  it("asks first, and removes the task only after a yes", async () => {
    await show();
    await open(3);
    await click(button("Delete task"));
    const ask = panel()!.querySelector('[role="alert"]')!;
    expect(ask.textContent).toContain("Delete task #3?");
    expect(document.activeElement).toBe(button("Cancel"));
    await press("Escape");
    expect(panel()!.querySelector('[role="alert"]')).toBeNull();
    expect(panel()).not.toBeNull();
    await click(button("Delete task"));
    await click(button("Delete"));
    await settle();
    expect(server.requests("DELETE")[0]!.path).toBe("/api/board/tasks/3");
    expect(panel()).toBeNull();
    expect(host.querySelector('li[data-task-id="3"]')).toBeNull();
  });

  it("hides the button from someone who neither made the task nor runs the place, and shows it to an admin", async () => {
    await show();
    await open(4);
    expect(button("Delete task")).toBeUndefined();
    act(() => root.unmount());
    fixture.admin = true;
    root = createRoot(host);
    await show();
    await open(4);
    expect(button("Delete task")).toBeDefined();
  });

  it("explains a refusal from the server and keeps the task", async () => {
    await show();
    server.fail("DELETE /api/board/tasks/3", "Only an admin or its creator can delete it");
    await open(3);
    await click(button("Delete task"));
    await click(button("Delete"));
    await settle();
    expect(notice()).toBe("Could not delete: Only an admin or its creator can delete it");
    expect(panel()).not.toBeNull();
    expect(host.querySelector('li[data-task-id="3"]')).not.toBeNull();
    expect(panel()!.querySelector('[role="alert"]')).toBeNull();
  });
});
