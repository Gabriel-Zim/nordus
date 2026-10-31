// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestBoardFocus } from "@/lib/board-compose";
import { setLocale } from "@/lib/i18n";
import { at, fakeBoard, makeBot, makeMission, makeTask, myEmail } from "@/testing/board";
import { choose, click, dragAndDrop, press, settle, submit, textOf, typeInto } from "@/testing/board-dom";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn(), openThread: vi.fn(), admin: false, state: {} as Record<string, unknown> }));
vi.mock("@/state/api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/api")>(), api: fixture.api }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  openThread: fixture.openThread,
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }),
}));
vi.mock("./DesktopCapabilities", () => ({ useCaptionChrome: () => ({ dragProps: {}, noDragStyle: undefined }) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/lib/message-author", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/message-author")>(), useMe: () => ({ email: "rafael@nordus.test", name: "Rafael" }) }));
vi.mock("./Avatar", async () => {
  const { createElement: h } = await import("react");
  return {
    BotAvatar: ({ label }: { label?: string }) => h("span", { "data-avatar": label ?? "" }),
    InitialsAvatar: ({ initials }: { initials: string }) => h("span", { "data-avatar": initials }),
  };
});
const { BoardPage } = await import("./BoardPage");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let server: ReturnType<typeof fakeBoard>;

const tasks = () => [
  makeTask(1, { title: "Write the brief", updatedAt: at(27, 9) }),
  makeTask(2, { title: "Draft the email", updatedAt: at(27, 10) }),
  makeTask(3, { title: "Review the budget", status: "doing", assignee: "dev", updatedAt: at(27, 11) }),
  makeTask(4, { title: "Check the copy", status: "review", assignee: "atlas", updatedAt: at(27, 12) }),
  makeTask(5, { title: "Send the invoice", status: "done", updatedAt: at(27, 13) }),
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

async function show(seed: Parameters<typeof fakeBoard>[0] = { tasks: tasks() }) {
  server = fakeBoard(seed);
  fixture.api.mockImplementation(server.handle);
  await act(async () => root.render(createElement(BoardPage)));
  await settle();
}
const column = (status: string) => host.querySelector(`[data-board-column="${status}"]`)!;
const card = (id: number) => host.querySelector(`li[data-task-id="${id}"]`)!;
const titles = (status: string) => textOf(column(status).querySelectorAll("[data-task-open] > span:first-child"));
const notice = () => host.querySelector("[data-board-notice]")?.textContent;
const moveMenu = (id: number) => card(id).querySelector('button[role="combobox"][aria-label="Move to"]');
const tab = (name: string) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((node) => node.textContent === name)!;

describe("the task board", () => {
  it("shows the four columns with their counts and the newest cards first", async () => {
    await show();
    expect(textOf(host.querySelectorAll("[data-board-column] h2"))).toEqual(["To do", "In progress", "In review", "Done"]);
    expect(textOf(host.querySelectorAll("[data-column-count]"))).toEqual(["2", "1", "1", "1"]);
    expect(host.querySelector("[data-column-count]")!.getAttribute("aria-label")).toBe("Tasks in this column: 2");
    expect(titles("todo")).toEqual(["Draft the email", "Write the brief"]);
    expect(titles("doing")).toEqual(["Review the budget"]);
    expect(textOf(card(2).querySelectorAll("[data-task-number]"))).toEqual(["#2"]);
    expect(card(3).querySelector("[data-assignee]")!.getAttribute("data-assignee")).toBe("dev");
    expect(card(1).querySelector("[data-assignee]")!.getAttribute("aria-label")).toBe("No assignee");
    expect(card(3).querySelector("[data-avatar]")!.getAttribute("data-avatar")).toBe("Dev");
  });

  it("says so when a column has nothing in it", async () => {
    await show({ tasks: [makeTask(1)] });
    expect(textOf(host.querySelectorAll("[data-board-column] p"))).toEqual(["Nothing here yet", "Nothing here yet", "Nothing here yet"]);
  });

  it("moves a card with its Move to menu: it changes column at once and the server gets the new status", async () => {
    await show();
    const held = server.hold("PATCH /api/board/tasks/1");
    await choose(moveMenu(1), "In review");
    expect(titles("todo")).toEqual(["Draft the email"]);
    expect(titles("review")).toContain("Write the brief");
    expect(server.requests("PATCH")[0]).toMatchObject({ path: "/api/board/tasks/1", body: { status: "review" } });
    await act(async () => held.release({ task: makeTask(1, { title: "Write the brief", status: "review", updatedAt: at(27, 14) }) }));
    await settle();
    expect(column("review").querySelector('li[data-task-id="1"]')).not.toBeNull();
    expect(textOf(host.querySelectorAll("[data-column-count]"))).toEqual(["1", "1", "2", "1"]);
    expect(notice()).toBe("");
  });

  it("puts the card back and says why when the server refuses the move", async () => {
    await show();
    server.fail("PATCH /api/board/tasks/1", "Only Dev can move this task");
    await choose(moveMenu(1), "Done");
    await settle();
    expect(column("todo").querySelector('li[data-task-id="1"]')).not.toBeNull();
    expect(column("done").querySelector('li[data-task-id="1"]')).toBeNull();
    expect(notice()).toBe("Could not move task #1: Only Dev can move this task");
  });

  it("offers the same move to the keyboard: the menu opens on the trigger and picks with Enter", async () => {
    await show();
    const trigger = moveMenu(1)!;
    await click(trigger);
    const menu = document.querySelector<HTMLElement>("[data-nordus-select-menu]")!;
    expect(textOf(menu.querySelectorAll('[role="option"]'))).toEqual(["To do", "In progress", "In review", "Done"]);
    await press("ArrowDown", menu);
    await press("Enter", menu);
    await settle();
    expect(server.requests("PATCH")[0]!.body).toEqual({ status: "doing" });
  });

  it("moves a dragged card to the column it is dropped on, and ignores a drop on its own column", async () => {
    await show();
    await dragAndDrop(card(2), column("todo"));
    expect(server.requests("PATCH")).toHaveLength(0);
    await dragAndDrop(card(2), column("doing"));
    await settle();
    expect(server.requests("PATCH")[0]).toMatchObject({ path: "/api/board/tasks/2", body: { status: "doing" } });
    expect(titles("doing")).toContain("Draft the email");
    expect(card(2).hasAttribute("draggable")).toBe(true);
  });

  it("adds a task at the foot of a column with the column's status", async () => {
    await show();
    const input = () => column("doing").querySelector<HTMLInputElement>('input[aria-label="New task (In progress)"]')!;
    await typeInto(input(), "  Write the docs  ");
    await submit(input().closest("form"));
    await settle();
    expect(server.requests("POST", "/api/board/tasks")[0]!.body).toEqual({ title: "Write the docs", status: "doing" });
    expect(titles("doing")).toContain("Write the docs");
    expect(input().value).toBe("");
    expect(textOf(host.querySelectorAll("[data-column-count]"))).toEqual(["2", "2", "1", "1"]);
  });

  it("keeps what was typed and says why when a task cannot be added", async () => {
    await show();
    server.fail("POST /api/board/tasks", "The board is full");
    const input = () => column("todo").querySelector<HTMLInputElement>("input")!;
    await typeInto(input(), "One more");
    await submit(input().closest("form"));
    await settle();
    expect(input().value).toBe("One more");
    expect(notice()).toBe("Could not add the task: The board is full");
  });

  it("filters the board by assignee, or by tasks nobody has", async () => {
    await show();
    const filter = () => host.querySelector('button[role="combobox"][aria-label="Filter by assignee"]');
    await choose(filter(), "Dev");
    expect(textOf(host.querySelectorAll("[data-column-count]"))).toEqual(["0", "1", "0", "0"]);
    await choose(filter(), "No assignee");
    expect(textOf(host.querySelectorAll("[data-column-count]"))).toEqual(["2", "0", "0", "1"]);
    await choose(filter(), "Everyone");
    expect(textOf(host.querySelectorAll("[data-column-count]"))).toEqual(["2", "1", "1", "1"]);
  });

  it("follows a live change of the task list", async () => {
    await show();
    const { publishLiveFrame } = await import("@/lib/live-events");
    await act(async () => publishLiveFrame({ kind: "board.task", task: makeTask(6, { title: "Just arrived", status: "review", updatedAt: at(27, 15) }) } as never));
    expect(titles("review")[0]).toBe("Just arrived");
    await act(async () => publishLiveFrame({ kind: "board.task.deleted", id: 6 } as never));
    expect(titles("review")).toEqual(["Check the copy"]);
  });
});

describe("while the board loads", () => {
  it("waits for the list, then offers to try again when it cannot be loaded", async () => {
    server = fakeBoard({ tasks: tasks() });
    const held = server.hold("GET /api/board/tasks");
    fixture.api.mockImplementation(server.handle);
    await act(async () => root.render(createElement(BoardPage)));
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Loading");
    await act(async () => held.refuse("The server is not answering"));
    await settle();
    const problem = host.querySelector('[role="alert"]')!;
    expect(problem.textContent).toContain("Could not load: The server is not answering");
    fixture.api.mockImplementation(fakeBoard({ tasks: tasks() }).handle);
    await click([...problem.querySelectorAll("button")].find((button) => button.textContent === "Try again"));
    await settle();
    expect(host.querySelectorAll("[data-board-column]")).toHaveLength(4);
  });
});

describe("tasks and missions", () => {
  const mission = () => makeMission({ stepIds: [3, 4, 5], status: "running" });

  it("opens on Tasks with a tab for Missions, and the arrow keys switch between them", async () => {
    await show({ tasks: tasks(), missions: [mission()] });
    expect(tab("Tasks").getAttribute("aria-selected")).toBe("true");
    expect(tab("Missions").getAttribute("tabindex")).toBe("-1");
    await press("ArrowRight", tab("Tasks"));
    expect(tab("Missions").getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[data-testid="mission-list"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Filter by assignee"]')).toBeNull();
    await press("ArrowLeft", tab("Missions"));
    expect(host.querySelector('[data-testid="board-columns"]')).not.toBeNull();
  });

  it("lists each mission with its plain status, progress and lead, and opens it", async () => {
    await show({ tasks: tasks(), missions: [mission()] });
    await click(tab("Missions"));
    const item = host.querySelector('[data-mission-id="m1"]')!;
    expect(item.textContent).toContain("Launch the newsletter");
    expect(item.querySelector("[data-mission-status]")!.textContent).toBe("In progress");
    expect(item.textContent).toContain("Led by Dev");
    expect(item.textContent).toContain("1 of 3 steps");
    expect(item.querySelector('[role="progressbar"]')).not.toBeNull();
    await click(item);
    expect(host.querySelector('[data-testid="mission-view"]')).not.toBeNull();
    expect(host.querySelector("h2")!.textContent).toBe("Launch the newsletter");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "All missions"));
    expect(host.querySelector('[data-testid="mission-list"]')).not.toBeNull();
  });

  it("invites the first mission when there is none", async () => {
    await show({ tasks: tasks() });
    await click(tab("Missions"));
    expect(host.querySelector('[data-testid="mission-empty"]')!.textContent).toContain("No missions yet");
  });

  it("starts a mission with a lead and a team, then opens it", async () => {
    await show({ tasks: tasks() });
    await click(tab("Missions"));
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "New mission"));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("New mission");
    const create = () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Start mission")!;
    expect(create().disabled).toBe(true);
    await typeInto(dialog.querySelector("input"), "Plan the launch");
    await typeInto(dialog.querySelector("textarea"), "Have the launch plan ready by Friday");
    expect(create().disabled).toBe(false);
    await choose(dialog.querySelector('button[role="combobox"][aria-label="Lead agent"]'), "Atlas");
    await click(dialog.querySelector('[role="checkbox"][aria-label="Nina"]'));
    await submit(dialog.querySelector("form"));
    await settle();
    expect(server.requests("POST", "/api/missions")[0]!.body).toEqual({
      title: "Plan the launch", goal: "Have the launch plan ready by Friday", leadBotId: "atlas", teamBotIds: ["atlas", "nina"],
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="mission-view"]')!.textContent).toContain("Plan the launch");
  });

  it("explains a mission that could not be started and keeps the dialog open", async () => {
    await show({ tasks: tasks() });
    server.fail("POST /api/missions", "A mission needs at least one agent");
    await click(tab("Missions"));
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "New mission"));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await typeInto(dialog.querySelector("input"), "Plan the launch");
    await typeInto(dialog.querySelector("textarea"), "Goal");
    await submit(dialog.querySelector("form"));
    await settle();
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe("Could not start the mission: A mission needs at least one agent");
  });

  it("can be opened straight on a task or a mission by whoever sent the person here", async () => {
    requestBoardFocus({ taskId: 3 });
    await show({ tasks: tasks(), missions: [mission()] });
    expect(host.querySelector<HTMLInputElement>('[data-testid="board-task-panel"] input')!.value).toBe("Review the budget");
    act(() => root.unmount());
    root = createRoot(host);
    requestBoardFocus({ missionId: "m1" });
    await show({ tasks: tasks(), missions: [mission()] });
    expect(host.querySelector('[data-testid="mission-view"]')).not.toBeNull();
    expect(tab("Missions").getAttribute("aria-selected")).toBe("true");
  });
});
