// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestBoardFocus } from "@/lib/board-compose";
import { setLocale } from "@/lib/i18n";
import { at, fakeBoard, makeBot, makeMission, makeTask, myEmail } from "@/testing/board";
import { click, settle, submit, textOf, typeInto } from "@/testing/board-dom";
import { listNames } from "../../../shared/place-view";
import type { BoardMission, MissionReceipt } from "../../../shared/board";

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

const dev = { kind: "bot", id: "dev", name: "Dev" } as const;
const stepTasks = () => [
  makeTask(11, { title: "Write the copy", status: "done", assignee: "dev", missionId: "m1" }),
  makeTask(12, { title: "Design the banner", status: "doing", assignee: "atlas", missionId: "m1" }),
  makeTask(13, { title: "Review everything", status: "review", assignee: "nina", missionId: "m1" }),
  makeTask(14, { title: "Publish", missionId: "m1" }),
];
const running = (overrides: Partial<BoardMission> = {}) => makeMission({
  stepIds: [11, 12, 13, 14],
  feed: [
    { at: at(27, 9, 12), author: dev, kind: "plan", text: "Plano montado: 7 passos, 3 agentes." },
    { at: at(27, 10, 30), author: { kind: "bot", id: "atlas", name: "Atlas" }, kind: "progress", text: "Banner 50% pronto." },
    { at: at(28, 8, 5), author: { kind: "bot", id: "nina" }, kind: "progress", text: "A revisão começou." },
  ],
  ...overrides,
});
const receipt = (withCost = false): MissionReceipt => ({
  from: at(27, 9),
  to: at(27, 11, 30),
  agents: [
    { botId: "dev", name: "Dev", turns: 12, input: 12_000, output: 3_000, ...(withCost ? { costUsd: 0.42 } : {}) },
    { botId: "atlas", name: "Atlas", turns: 5, input: 4_000, output: 1_000, ...(withCost ? { costUsd: 0.33 } : {}) },
  ],
  total: { turns: 17, input: 16_000, output: 4_000, ...(withCost ? { costUsd: 0.75 } : {}) },
});

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

async function show(mission: BoardMission, extra: Parameters<typeof fakeBoard>[0] = {}) {
  server = fakeBoard({ tasks: stepTasks(), missions: [mission], ...extra });
  fixture.api.mockImplementation(server.handle);
  requestBoardFocus({ missionId: mission.id });
  await act(async () => root.render(createElement(BoardPage)));
  await settle();
}
const view = () => host.querySelector<HTMLElement>('[data-testid="mission-view"]')!;
const feed = () => host.querySelector<HTMLElement>('[data-testid="mission-feed"]')!;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label);
const notice = () => host.querySelector("[data-board-notice]")?.textContent;
const cells = (rows: NodeListOf<Element>) => [...rows].map((row) => [...row.children].map((cell) => cell.textContent));

describe("a running mission", () => {
  it("says who opened it and who is on it, in plain words", async () => {
    await show(running());
    expect(view().querySelector("h2")!.textContent).toBe("Launch the newsletter");
    expect(view().querySelector("[data-mission-status]")!.textContent).toBe("In progress");
    expect(view().querySelector("[data-mission-subtitle]")!.textContent).toBe(`Mission · opened by you · ${listNames(["Dev", "Atlas", "Nina"], "en")}`);
  });

  it("lists the steps in order with a mark for each state and the agent on the right", async () => {
    await show(running());
    const steps = [...view().querySelectorAll<HTMLElement>("[data-step-id]")];
    expect(steps.map((step) => step.getAttribute("data-step-id"))).toEqual(["11", "12", "13", "14"]);
    expect(steps.map((step) => step.querySelector("span:nth-child(2)")!.textContent)).toEqual(["Write the copy", "Design the banner", "Review everything", "Publish"]);
    expect(steps.map((step) => step.querySelector("[data-step-mark]")!.getAttribute("data-step-mark"))).toEqual(["done", "active", "active", "todo"]);
    expect(steps.map((step) => step.querySelector("[data-step-mark]")!.getAttribute("aria-label"))).toEqual(["Done", "In progress", "In review", "To do"]);
    expect(steps.map((step) => step.querySelector("[data-agent-chip]")?.getAttribute("data-agent-chip") ?? null)).toEqual(["dev", "atlas", "nina", null]);
    expect(steps.map((step) => step.querySelector("[data-agent-chip]")?.textContent ?? null)).toEqual(["Dev", "Atlas", "Nina", null]);
  });

  it("draws one segment per step: filled when done, highlighted when in progress", async () => {
    await show(running());
    const bar = view().querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-label")).toBe("1 of 4 steps");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("4");
    expect([...bar.querySelectorAll("[data-step-state]")].map((segment) => segment.getAttribute("data-step-state"))).toEqual(["done", "active", "active", "todo"]);
    expect(view().textContent).toContain("1 of 4 steps");
  });

  it("follows a step: it shows how the task stands and opens that task", async () => {
    await show(running({ stepIds: [11, 12, 99] }));
    const missing = view().querySelector<HTMLButtonElement>('[data-step-id="99"]')!;
    expect(missing.disabled).toBe(true);
    expect(missing.textContent).toContain("Task #99 is no longer on the board");
    await click(view().querySelector('[data-step-id="12"]'));
    const panel = host.querySelector('[data-testid="board-task-panel"]')!;
    expect(panel.getAttribute("aria-label")).toBe("Task #12");
    expect(panel.querySelector<HTMLInputElement>('input[aria-label="Title"]')!.value).toBe("Design the banner");
  });

  it("changes as the live frames arrive", async () => {
    await show(running());
    const { publishLiveFrame } = await import("@/lib/live-events");
    await act(async () => publishLiveFrame({ kind: "board.task", task: makeTask(14, { title: "Publish", status: "done", missionId: "m1", updatedAt: at(27, 20) }) } as never));
    expect(view().querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("2");
    const more = { at: at(28, 9), author: dev, kind: "progress" as const, text: "Tudo pronto para publicar." };
    await act(async () => publishLiveFrame({ kind: "board.mission", mission: running({ feed: [...running().feed, more] }) } as never));
    expect(textOf(feed().querySelectorAll("[data-mission-feed] li p")).at(-1)).toBe("Dev · Tudo pronto para publicar.");
  });
});

describe("the progress panel", () => {
  it("lists what happened in order, with who said it, what kind it was and the day and time", async () => {
    await show(running());
    expect(feed().querySelector("h3")!.textContent).toBe("Progress");
    const items = [...feed().querySelectorAll("[data-mission-feed] li")];
    expect(items.map((item) => item.querySelector("p")!.textContent)).toEqual([
      "Dev · Plano montado: 7 passos, 3 agentes.", "Atlas · Banner 50% pronto.", "Nina · A revisão começou.",
    ]);
    expect(items.map((item) => item.querySelector("time")!.textContent)).toEqual(["Day 1 · 09:12", "Day 1 · 10:30", "Day 2 · 08:05"]);
    expect(items.map((item) => item.getAttribute("data-feed-kind"))).toEqual(["plan", "progress", "progress"]);
    expect(items.map((item) => item.querySelector('[role="img"]')!.getAttribute("aria-label"))).toEqual(["Plan", "Progress", "Progress"]);
    expect(feed().querySelector("[data-mission-decision]")).toBeNull();
    expect(feed().querySelector("[data-mission-end]")).toBeNull();
  });

  it("says so while nothing has happened yet", async () => {
    await show(running({ feed: [] }));
    expect(feed().textContent).toContain("Nothing has happened yet.");
  });
});

describe("a decision waiting for the person", () => {
  const waiting = () => running({
    status: "waiting",
    pendingDecision: { question: "Which audience goes first?", options: ["Customers", "Partners"], askedAt: at(27, 11), askedBy: "dev" },
  });
  const decision = () => feed().querySelector<HTMLElement>("[data-mission-decision]")!;
  const options = () => [...decision().querySelectorAll<HTMLButtonElement>("[data-decision-option]")];

  it("shows the question with one button per option", async () => {
    await show(waiting());
    expect(view().querySelector("[data-mission-status]")!.textContent).toBe("Waiting for you");
    expect(decision().querySelector("h4")!.textContent).toBe("Dev needs your decision");
    expect(decision().querySelector("p")!.textContent).toBe("Which audience goes first?");
    expect(options().map((option) => option.textContent)).toEqual(["Customers", "Partners"]);
  });

  it("answers with an option, and the question goes away", async () => {
    await show(waiting());
    await click(options()[1]);
    await settle();
    expect(server.requests("POST", "/api/missions/m1/answer")[0]!.body).toEqual({ answer: "Partners" });
    expect(feed().querySelector("[data-mission-decision]")).toBeNull();
    expect(view().querySelector("[data-mission-status]")!.textContent).toBe("In progress");
  });

  it("answers in the person's own words, and only when something is written", async () => {
    await show(waiting());
    const send = () => [...decision().querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "Send")!;
    expect(send().disabled).toBe(true);
    await typeInto(decision().querySelector("input"), "  Start with partners next week  ");
    expect(send().disabled).toBe(false);
    await submit(decision().querySelector("form"));
    await settle();
    expect(server.requests("POST", "/api/missions/m1/answer")[0]!.body).toEqual({ answer: "Start with partners next week" });
    expect(feed().querySelector("[data-mission-decision]")).toBeNull();
  });

  it("keeps the question and the text when the answer cannot be sent", async () => {
    await show(waiting());
    server.fail("POST /api/missions/m1/answer", "The mission is not waiting any more");
    await typeInto(decision().querySelector("input"), "Partners");
    await submit(decision().querySelector("form"));
    await settle();
    expect(notice()).toBe("Could not do that: The mission is not waiting any more");
    expect(decision().querySelector("input")!.value).toBe("Partners");
  });

  it("does not ask again once the question has an answer", async () => {
    await show(running({ pendingDecision: { question: "Done?", askedAt: at(27, 11), askedBy: "dev", answer: "Yes", answeredAt: at(27, 12) } }));
    expect(feed().querySelector("[data-mission-decision]")).toBeNull();
  });
});

describe("pausing and resuming", () => {
  it("pauses a running mission and says it only goes on when asked", async () => {
    await show(running());
    expect(button("Resume")).toBeUndefined();
    await click(button("Pause"));
    await settle();
    expect(server.requests("POST", "/api/missions/m1/pause")).toHaveLength(1);
    expect(view().querySelector("[data-mission-status]")!.textContent).toBe("Paused");
    expect(view().querySelector("[data-mission-stopped]")!.textContent).toBe("This mission is paused.It only goes on when you resume it.");
    expect(button("Pause")).toBeUndefined();
    await click(button("Resume"));
    await settle();
    expect(server.requests("POST", "/api/missions/m1/resume")).toHaveLength(1);
    expect(view().querySelector("[data-mission-status]")!.textContent).toBe("In progress");
    expect(view().querySelector("[data-mission-stopped]")).toBeNull();
  });

  it("explains a pause the system made, and that it can end by itself", async () => {
    await show(running({ status: "paused", pausedReason: "Atlas ran out of credit", pausedBy: "system" }));
    expect(view().querySelector("[data-mission-stopped]")!.textContent).toBe("Paused: Atlas ran out of creditIt starts again by itself when this is sorted out.");
    expect(button("Resume")).toBeDefined();
  });

  it("tells an administrator the exact limit behind a pause, and everyone else only the general words", async () => {
    await show(running({ status: "paused", pausedReason: "A usage limit was reached.", pausedDetail: "The monthly spend limit was reached.", pausedBy: "system" }));
    expect(view().querySelector("[data-mission-stopped]")!.textContent).toContain("Paused: The monthly spend limit was reached.");
    act(() => root.unmount());
    root = createRoot(host);
    await show(running({ status: "paused", pausedReason: "A usage limit was reached.", pausedBy: "system" }));
    expect(view().querySelector("[data-mission-stopped]")!.textContent).toContain("Paused: A usage limit was reached.");
  });

  it("can pause a mission that is waiting for the person, and not one that has ended", async () => {
    await show(running({ status: "waiting", pendingDecision: { question: "Go?", askedAt: at(27, 11), askedBy: "dev" } }));
    expect(button("Pause")).toBeDefined();
    act(() => root.unmount());
    root = createRoot(host);
    await show(running({ status: "done", finishedAt: at(27, 12) }), { receipt: receipt() });
    expect(button("Pause")).toBeUndefined();
    expect(button("Resume")).toBeUndefined();
  });

  it("says why it could not pause", async () => {
    await show(running());
    server.fail("POST /api/missions/m1/pause", "Only the person who opened it can pause it");
    await click(button("Pause"));
    await settle();
    expect(notice()).toBe("Could not do that: Only the person who opened it can pause it");
    expect(view().querySelector("[data-mission-status]")!.textContent).toBe("In progress");
  });

  it("opens the mission's room", async () => {
    await show(running());
    await click(button("Open room"));
    expect(fixture.openThread).toHaveBeenCalledWith(fixture.dispatch, { botId: "dev", threadId: "room-thread" }, fixture.state, true);
  });
});

describe("a finished mission", () => {
  it("ends the progress with a line and a receipt per agent, without money when the server sends none", async () => {
    await show(running({ status: "done", finishedAt: at(27, 11, 30) }), { receipt: receipt() });
    expect(view().querySelector("[data-mission-status]")!.textContent).toBe("Done");
    expect(feed().querySelector("[data-mission-end]")!.textContent).toBe("Mission complete.");
    expect(server.requests("GET", "/api/missions/m1")).toHaveLength(1);
    const table = feed().querySelector("[data-mission-receipt] table")!;
    expect(textOf(table.querySelectorAll("thead th"))).toEqual(["Agent", "Replies", "Usage"]);
    expect(cells(table.querySelectorAll("tbody tr"))).toEqual([["Dev", "12", "15,000"], ["Atlas", "5", "5,000"]]);
    expect(cells(table.querySelectorAll("tfoot tr"))).toEqual([["Total", "17", "20,000"]]);
    expect(feed().querySelector("[data-mission-receipt]")!.textContent).toContain("Took 2 h 30 m");
    expect(feed().querySelector("[data-mission-receipt]")!.textContent).not.toContain("$");
    expect(table.querySelector('[data-receipt-agent="dev"] td:nth-child(3)')!.getAttribute("title")).toBe("12,000 in · 3,000 out");
  });

  it("does not say it twice when the feed already closes with the server's own line", async () => {
    const closing = (kind: "done" | "error", text: string) => ({ at: at(27, 11, 30), author: dev, kind, text });
    await show(running({ status: "done", feed: [...running().feed, closing("done", "Produção virada. Nenhum erro em 1 hora. Missão concluída.")] }));
    expect(feed().querySelector("[data-mission-end]")).toBeNull();
    expect([...feed().querySelectorAll("[data-mission-feed] li")].at(-1)!.querySelector("p")!.textContent).toBe("Dev · Produção virada. Nenhum erro em 1 hora. Missão concluída.");
    act(() => root.unmount());
    root = createRoot(host);
    await show(running({ status: "failed", feed: [...running().feed, closing("error", "A missão não pode continuar: a sala da missão foi apagada.")] }));
    expect(feed().querySelector("[data-mission-end]")).toBeNull();
  });

  it("adds what each agent cost, as money, when the server sends it", async () => {
    await show(running({ status: "done", finishedAt: at(27, 11, 30) }), { receipt: receipt(true) });
    const table = feed().querySelector("[data-mission-receipt] table")!;
    expect(textOf(table.querySelectorAll("thead th"))).toEqual(["Agent", "Replies", "Usage", "Cost"]);
    expect(cells(table.querySelectorAll("tbody tr"))).toEqual([["Dev", "12", "15,000", "$0.42"], ["Atlas", "5", "5,000", "$0.33"]]);
    expect(cells(table.querySelectorAll("tfoot tr"))).toEqual([["Total", "17", "20,000", "$0.75"]]);
  });

  it("shows no receipt when the server has none, and says when a mission failed", async () => {
    await show(running({ status: "failed", pausedReason: "The banner tool stopped working" }));
    expect(feed().querySelector("[data-mission-receipt]")).toBeNull();
    expect(feed().querySelector("[data-mission-end]")!.textContent).toBe("The mission failed.");
    expect(view().querySelector("[data-mission-stopped]")!.textContent).toBe("Failed: The banner tool stopped working");
  });
});

describe("deleting a mission", () => {
  it("asks first, then removes it and goes back to the list", async () => {
    await show(running());
    await click(button("Delete mission"));
    expect(view().querySelector('[role="alert"]')!.textContent).toContain("Delete this mission?");
    await click(button("Cancel"));
    expect(view().querySelector('[role="alert"]')).toBeNull();
    await click(button("Delete mission"));
    await click(button("Delete"));
    await settle();
    expect(server.requests("DELETE")[0]!.path).toBe("/api/missions/m1");
    expect(host.querySelector('[data-testid="mission-list"]')).not.toBeNull();
    expect(host.querySelector('[data-mission-id="m1"]')).toBeNull();
  });

  it("is offered to whoever opened the mission or runs the place, and to nobody else", async () => {
    const other = { kind: "person", id: "ada@nordus.test", name: "Ada" } as const;
    await show(running({ createdBy: other }));
    expect(button("Delete mission")).toBeUndefined();
    act(() => root.unmount());
    fixture.admin = true;
    root = createRoot(host);
    await show(running({ createdBy: other }));
    expect(button("Delete mission")).toBeDefined();
  });

  it("goes back to the list with the back button", async () => {
    await show(running());
    await click(button("All missions"));
    expect(host.querySelector('[data-testid="mission-list"]')).not.toBeNull();
  });
});
