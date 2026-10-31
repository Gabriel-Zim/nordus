// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { at, fakeBoard, makeMission, makeTask, person } from "@/testing/board";
import type { ServerFrame } from "../../shared/wire";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/api")>(), api: fixture.api }));
const { boardReducer, frameAction, initialBoardState, useBoard } = await import("./board");
const { publishLiveFrame, publishMissedFrames } = await import("@/lib/live-events");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => setLocale("en"));

const ready = { ...initialBoardState, tasksLoad: "ready" as const, missionsLoad: "ready" as const };

describe("the board reducer", () => {
  it("keeps what is on screen when the list it loads is older", () => {
    const state = { ...ready, tasks: [makeTask(1, { updatedAt: 300, title: "Edited here" })] };
    const next = boardReducer(state, { type: "tasksLoaded", tasks: [makeTask(1, { updatedAt: 100, title: "Stale" }), makeTask(2, { updatedAt: 50 })] });
    expect(next.tasks.map((task) => task.title)).toEqual(["Edited here", "Task 2"]);
    expect(next.tasksLoad).toBe("ready");
  });

  it("drops a task the server no longer lists", () => {
    const next = boardReducer({ ...ready, tasks: [makeTask(1), makeTask(2)] }, { type: "tasksLoaded", tasks: [makeTask(2)] });
    expect(next.tasks.map((task) => task.id)).toEqual([2]);
  });

  it("fails loudly only while there is nothing to show", () => {
    const failed = boardReducer(initialBoardState, { type: "tasksFailed", error: "Offline" });
    expect(failed).toMatchObject({ tasksLoad: "error", tasksError: "Offline" });
    expect(boardReducer(failed, { type: "retry" }).tasksLoad).toBe("loading");
    const later = boardReducer({ ...ready, tasks: [makeTask(1)] }, { type: "tasksFailed", error: "Offline" });
    expect(later).toMatchObject({ tasksLoad: "ready", tasksError: "Offline" });
    expect(later.tasks).toHaveLength(1);
    expect(boardReducer(later, { type: "tasksLoaded", tasks: [] }).tasksError).toBeNull();
  });

  it("applies a task frame only when it is not older than the task on screen", () => {
    const state = { ...ready, tasks: [makeTask(1, { updatedAt: 200, status: "doing" })] };
    expect(boardReducer(state, { type: "taskPut", task: makeTask(1, { updatedAt: 100, status: "todo" }) })).toBe(state);
    expect(boardReducer(state, { type: "taskPut", task: makeTask(1, { updatedAt: 300, status: "done" }) }).tasks[0]!.status).toBe("done");
    expect(boardReducer(state, { type: "taskPut", task: makeTask(5) }).tasks.map((task) => task.id)).toEqual([1, 5]);
  });

  it("puts a task back only if nothing newer arrived meanwhile", () => {
    const before = makeTask(1, { updatedAt: 100, status: "todo" });
    const moved = boardReducer({ ...ready, tasks: [before] }, { type: "taskEdited", id: 1, patch: { status: "done" } });
    expect(moved.tasks[0]!.status).toBe("done");
    expect(boardReducer(moved, { type: "taskRestored", task: before }).tasks[0]!.status).toBe("todo");
    const newer = boardReducer(moved, { type: "taskPut", task: makeTask(1, { updatedAt: 200, status: "review" }) });
    expect(boardReducer(newer, { type: "taskRestored", task: before }).tasks[0]!.status).toBe("review");
  });

  it("removes a deleted task or mission and merges a mission frame by its latest event", () => {
    const state = { ...ready, tasks: [makeTask(1), makeTask(2)], missions: [makeMission({ id: "a" }), makeMission({ id: "b" })] };
    expect(boardReducer(state, { type: "taskDeleted", id: 1 }).tasks.map((task) => task.id)).toEqual([2]);
    expect(boardReducer(state, { type: "missionDeleted", id: "a" }).missions.map((mission) => mission.id)).toEqual(["b"]);
    const newer = makeMission({ id: "a", status: "waiting", feed: [{ at: at(27, 11), author: person, kind: "progress", text: "Now" }] });
    expect(boardReducer(state, { type: "missionPut", mission: newer }).missions[0]!.status).toBe("waiting");
    const same = boardReducer({ ...state, missions: [newer] }, { type: "missionPut", mission: makeMission({ id: "a" }) });
    expect(same.missions[0]!.status).toBe("waiting");
  });
});

describe("live frames", () => {
  it("turns each board frame into an action and ignores the rest", () => {
    const task = makeTask(3);
    const mission = makeMission();
    expect(frameAction({ kind: "board.task", task } as never)).toEqual({ type: "taskPut", task });
    expect(frameAction({ kind: "board.task.deleted", id: 3 } as never)).toEqual({ type: "taskDeleted", id: 3 });
    expect(frameAction({ kind: "board.mission", mission } as never)).toEqual({ type: "missionPut", mission });
    expect(frameAction({ kind: "board.mission.deleted", id: "m1" } as never)).toEqual({ type: "missionDeleted", id: "m1" });
    expect(frameAction({ kind: "ping" })).toBeNull();
    expect(frameAction({ kind: "board.task" })).toBeNull();
    expect(frameAction({ kind: "board.task.deleted", id: "3" } as never)).toBeNull();
    expect(frameAction({ kind: "board.mission.deleted", id: 3 } as never)).toBeNull();
  });
});

describe("the board hook", () => {
  let host: HTMLDivElement;
  let root: Root;
  let board: ReturnType<typeof useBoard>;
  let server: ReturnType<typeof fakeBoard>;

  const Probe = () => {
    board = useBoard();
    return null;
  };
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const frame = (value: unknown) => act(async () => { publishLiveFrame(value as ServerFrame); });
  async function mount(seed: Parameters<typeof fakeBoard>[0]) {
    server = fakeBoard(seed);
    fixture.api.mockImplementation(server.handle);
    await act(async () => root.render(createElement(Probe)));
    await settle();
  }

  beforeEach(() => {
    fixture.api.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("loads tasks, missions and people once it opens", async () => {
    await mount({ tasks: [makeTask(1), makeTask(2)], missions: [makeMission()], people: [{ id: "ada@nordus.test", name: "Ada" }] });
    expect(board).toMatchObject({ tasksLoad: "ready", missionsLoad: "ready" });
    expect(board.tasks.map((task) => task.id)).toEqual([1, 2]);
    expect(board.missions).toHaveLength(1);
    expect(board.people).toEqual([{ id: "ada@nordus.test", name: "Ada" }]);
    expect(server.requests("GET").map((call) => call.path).sort()).toEqual(["/api/board/people", "/api/board/tasks", "/api/missions"]);
  });

  it("shows the problem, and tries again on request, when the first load fails", async () => {
    server = fakeBoard({ tasks: [makeTask(1)] });
    server.fail("GET /api/board/tasks", "Could not reach the server");
    fixture.api.mockImplementation(server.handle);
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(board).toMatchObject({ tasksLoad: "error", tasksError: "Could not reach the server" });
    fixture.api.mockImplementation(fakeBoard({ tasks: [makeTask(1)] }).handle);
    await act(async () => board.actions.reload());
    await settle();
    expect(board.tasksLoad).toBe("ready");
  });

  it("merges live task frames by id and ignores one older than the screen", async () => {
    await mount({ tasks: [makeTask(1, { updatedAt: at(27, 10) }), makeTask(2, { updatedAt: at(27, 11) })] });
    await frame({ kind: "board.task", task: makeTask(3, { updatedAt: at(27, 12), title: "Brand new" }) });
    await frame({ kind: "board.task", task: makeTask(1, { updatedAt: at(27, 13), status: "doing" }) });
    await frame({ kind: "board.task", task: makeTask(2, { updatedAt: at(27, 8), status: "done" }) });
    expect(board.tasks.map((task) => [task.id, task.status, task.title])).toEqual([[1, "doing", "Task 1"], [2, "todo", "Task 2"], [3, "todo", "Brand new"]]);
    await frame({ kind: "board.task.deleted", id: 2 });
    expect(board.tasks.map((task) => task.id)).toEqual([1, 3]);
  });

  it("merges live mission frames and drops a deleted mission", async () => {
    await mount({ missions: [makeMission({ id: "a" })] });
    await frame({ kind: "board.mission", mission: makeMission({ id: "b", title: "Second" }) });
    await frame({ kind: "board.mission", mission: makeMission({ id: "a", status: "waiting", feed: [{ at: at(27, 10), author: person, kind: "decision", text: "Pick one" }] }) });
    expect(board.missions.map((mission) => [mission.id, mission.status])).toEqual([["a", "waiting"], ["b", "running"]]);
    await frame({ kind: "board.mission.deleted", id: "a" });
    expect(board.missions.map((mission) => mission.id)).toEqual(["b"]);
  });

  it("reloads the lists when frames were missed and when the window is focused again", async () => {
    await mount({ tasks: [makeTask(1)] });
    expect(server.requests("GET", "/api/board/tasks")).toHaveLength(1);
    server.store.tasks = [makeTask(1), makeTask(2)];
    await act(async () => publishMissedFrames());
    await settle();
    expect(board.tasks.map((task) => task.id)).toEqual([1, 2]);
    server.store.tasks = [makeTask(1), makeTask(2), makeTask(3)];
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(board.tasks.map((task) => task.id)).toEqual([1, 2, 3]);
    expect(server.requests("GET", "/api/board/tasks")).toHaveLength(3);
  });

  it("stops listening when it closes", async () => {
    await mount({ tasks: [makeTask(1)] });
    act(() => root.unmount());
    const before = server.calls.length;
    await act(async () => { publishMissedFrames(); window.dispatchEvent(new Event("focus")); });
    expect(server.calls.length).toBe(before);
    root = createRoot(host);
  });

  it("moves a task on screen at once and keeps the server's answer", async () => {
    await mount({ tasks: [makeTask(1, { updatedAt: at(27, 10) })] });
    const held = server.hold("PATCH /api/board/tasks/1");
    let pending!: ReturnType<typeof board.actions.moveTask>;
    await act(async () => { pending = board.actions.moveTask(1, "doing"); });
    expect(board.tasks[0]!.status).toBe("doing");
    expect(server.requests("PATCH")[0]!.body).toEqual({ status: "doing" });
    await act(async () => held.release({ task: makeTask(1, { status: "doing", updatedAt: at(27, 12), title: "Server copy" }) }));
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(board.tasks[0]).toMatchObject({ status: "doing", title: "Server copy" });
  });

  it("puts the task back and reports the problem when the move fails", async () => {
    await mount({ tasks: [makeTask(1, { updatedAt: at(27, 10) })] });
    const held = server.hold("PATCH /api/board/tasks/1");
    let pending!: ReturnType<typeof board.actions.moveTask>;
    await act(async () => { pending = board.actions.moveTask(1, "review"); });
    expect(board.tasks[0]!.status).toBe("review");
    await act(async () => held.refuse("You cannot move this task"));
    expect(await pending).toEqual({ ok: false, error: "You cannot move this task" });
    expect(board.tasks[0]!.status).toBe("todo");
  });

  it("does not undo a move when a newer copy of the task arrived while it was failing", async () => {
    await mount({ tasks: [makeTask(1, { updatedAt: at(27, 10) })] });
    const held = server.hold("PATCH /api/board/tasks/1");
    let pending!: ReturnType<typeof board.actions.moveTask>;
    await act(async () => { pending = board.actions.moveTask(1, "review"); });
    await frame({ kind: "board.task", task: makeTask(1, { updatedAt: at(27, 11), status: "done" }) });
    await act(async () => held.refuse("Too late"));
    await pending;
    expect(board.tasks[0]!.status).toBe("done");
  });

  it("creates, edits and deletes tasks and answers a mission through the server", async () => {
    const waiting = makeMission({ status: "waiting", pendingDecision: { question: "Ship it?", options: ["Yes", "No"], askedAt: at(27, 10), askedBy: "dev" } });
    await mount({ tasks: [makeTask(1)], missions: [waiting] });
    await act(async () => { await board.actions.createTask({ title: "New one", status: "review" }); });
    expect(board.tasks.find((task) => task.title === "New one")).toMatchObject({ id: 2, status: "review" });
    await act(async () => { await board.actions.updateTask(1, { title: "Renamed" }); });
    expect(board.tasks.find((task) => task.id === 1)!.title).toBe("Renamed");
    expect(server.requests("PATCH")[0]!.body).toEqual({ title: "Renamed" });
    await act(async () => { await board.actions.deleteTask(2); });
    expect(board.tasks.map((task) => task.id)).toEqual([1]);
    await act(async () => { await board.actions.answerMission("m1", "Yes"); });
    expect(server.requests("POST", "/api/missions/m1/answer")[0]!.body).toEqual({ answer: "Yes" });
    expect(board.missions[0]).toMatchObject({ status: "running", pendingDecision: { answer: "Yes" } });
    await act(async () => { await board.actions.pauseMission("m1"); });
    expect(board.missions[0]!.status).toBe("paused");
    await act(async () => { await board.actions.resumeMission("m1"); });
    expect(board.missions[0]!.status).toBe("running");
    await act(async () => { await board.actions.deleteMission("m1"); });
    expect(board.missions).toEqual([]);
  });

  it("explains a refused delete without removing the task", async () => {
    await mount({ tasks: [makeTask(1)] });
    server.fail("DELETE /api/board/tasks/1", "Only an admin or its creator can delete it");
    let result: Awaited<ReturnType<typeof board.actions.deleteTask>> | undefined;
    await act(async () => { result = await board.actions.deleteTask(1); });
    expect(result).toEqual({ ok: false, error: "Only an admin or its creator can delete it" });
    expect(board.tasks).toHaveLength(1);
  });
});
