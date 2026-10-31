import type { BoardActor, BoardMission, BoardPerson, BoardTask, BoardTaskResponse, MissionReceipt } from "../../shared/board";

export const myEmail = "rafael@nordus.test";
export const person: BoardActor = { kind: "person", id: myEmail, name: "Rafael" };

export const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

export function makeTask(id: number, overrides: Partial<BoardTask> = {}): BoardTask {
  const stamp = overrides.updatedAt ?? overrides.createdAt ?? at(27, 8, id);
  return {
    id,
    title: `Task ${id}`,
    status: "todo",
    createdBy: person,
    createdAt: stamp,
    updatedAt: stamp,
    history: [{ at: stamp, by: person, event: "created" }],
    ...overrides,
  };
}

export function makeMission(overrides: Partial<BoardMission> = {}): BoardMission {
  const created = at(27, 9);
  return {
    id: "m1",
    title: "Launch the newsletter",
    goal: "Ship the first issue",
    createdBy: person,
    createdAt: created,
    status: "running",
    leadBotId: "dev",
    teamBotIds: ["dev", "atlas", "nina"],
    groupId: "room-group",
    threadId: "room-thread",
    stepIds: [],
    feed: [],
    startedAt: created,
    ...overrides,
  };
}

export function makeBot(id: string, name: string) {
  return { id, name, threadId: `${id}-main`, color: "#4f46e5", tasks: [] };
}

export interface FakeCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

type Dispatch = NonNullable<BoardTaskResponse["dispatch"]>;
type Handler = (call: FakeCall) => unknown;

const BOT_ID = /^[^@]+$/;

export function fakeBoard(seed: { tasks?: BoardTask[]; missions?: BoardMission[]; people?: BoardPerson[]; receipt?: MissionReceipt } = {}) {
  let clock = at(27, 12);
  const tick = () => (clock += 1_000);
  const store = {
    tasks: [...(seed.tasks ?? [])],
    missions: [...(seed.missions ?? [])],
    people: [...(seed.people ?? [])],
    receipt: seed.receipt,
    dispatch: { status: "sent" } as Dispatch,
  };
  const calls: FakeCall[] = [];
  const overrides = new Map<string, Handler>();
  const copy = <T>(value: T): T => structuredClone(value);

  function patchTask(task: BoardTask, body: Record<string, unknown>): BoardTaskResponse {
    const now = tick();
    const next: BoardTask = { ...task, history: [...task.history], updatedAt: now };
    if (typeof body.title === "string") next.title = body.title;
    if (typeof body.description === "string") next.description = body.description;
    if (Array.isArray(body.links)) next.links = body.links as BoardTask["links"];
    if (typeof body.status === "string" && body.status !== task.status) {
      next.history.push({ at: now, by: person, from: task.status, to: body.status as BoardTask["status"] });
      next.status = body.status as BoardTask["status"];
    }
    let dispatch: Dispatch | undefined;
    if (next.status === "doing" && task.status !== "doing" && next.assignee && BOT_ID.test(next.assignee)) dispatch = store.dispatch;
    if ("assignee" in body) {
      if (typeof body.assignee === "string") {
        next.assignee = body.assignee;
        next.history.push({ at: now, by: person, event: "assigned", assignee: body.assignee });
        if (BOT_ID.test(body.assignee)) dispatch = store.dispatch;
      } else {
        delete next.assignee;
        next.history.push({ at: now, by: person, event: "unassigned" });
      }
    }
    store.tasks = store.tasks.map((candidate) => (candidate.id === task.id ? next : candidate));
    return { task: copy(next), ...(dispatch ? { dispatch } : {}) };
  }

  function changeMission(mission: BoardMission, change: Partial<BoardMission>): { mission: BoardMission } {
    const next = { ...mission, ...change };
    store.missions = store.missions.map((candidate) => (candidate.id === mission.id ? next : candidate));
    return { mission: copy(next) };
  }

  async function handle(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
    const method = init.method ?? "GET";
    const call: FakeCall = { method, path, ...(init.body ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}) };
    calls.push(call);
    const override = overrides.get(`${method} ${path}`);
    if (override) return override(call);

    if (path === "/api/board/tasks") {
      if (method === "GET") return { tasks: copy(store.tasks) };
      const now = tick();
      const body = call.body ?? {};
      const task = makeTask(Math.max(0, ...store.tasks.map((candidate) => candidate.id)) + 1, {
        title: String(body.title ?? ""), status: (body.status as BoardTask["status"]) ?? "todo", createdAt: now, updatedAt: now,
        ...(typeof body.description === "string" ? { description: body.description } : {}),
        ...(typeof body.assignee === "string" ? { assignee: body.assignee } : {}),
        ...(body.source ? { source: body.source as BoardTask["source"] } : {}),
      });
      store.tasks = [...store.tasks, task];
      const dispatch = task.assignee && BOT_ID.test(task.assignee) ? store.dispatch : undefined;
      return { task: copy(task), ...(dispatch ? { dispatch } : {}) };
    }
    if (path === "/api/board/people") return { people: copy(store.people) };
    const taskRoute = path.match(/^\/api\/board\/tasks\/(\d+)$/);
    if (taskRoute) {
      const task = store.tasks.find((candidate) => candidate.id === Number(taskRoute[1]));
      if (!task) throw new Error("Task not found");
      if (method === "DELETE") {
        store.tasks = store.tasks.filter((candidate) => candidate.id !== task.id);
        return { ok: true };
      }
      return patchTask(task, call.body ?? {});
    }
    if (path === "/api/missions") {
      if (method === "GET") return { missions: copy(store.missions) };
      const body = call.body ?? {};
      const mission = makeMission({
        id: `m${store.missions.length + 1}`, title: String(body.title ?? ""), goal: String(body.goal ?? ""), status: "planning",
        leadBotId: String(body.leadBotId ?? ""), teamBotIds: (body.teamBotIds as string[] | undefined) ?? [], createdAt: tick(),
      });
      store.missions = [...store.missions, mission];
      return { mission: copy(mission) };
    }
    const missionRoute = path.match(/^\/api\/missions\/([^/]+)(?:\/(pause|resume|answer))?$/);
    if (missionRoute) {
      const mission = store.missions.find((candidate) => candidate.id === decodeURIComponent(missionRoute[1]!));
      if (!mission) throw new Error("Mission not found");
      const action = missionRoute[2];
      if (method === "DELETE") {
        store.missions = store.missions.filter((candidate) => candidate.id !== mission.id);
        return { ok: true };
      }
      if (action === "pause") return changeMission(mission, { status: "paused", pausedBy: "person" });
      if (action === "resume") return changeMission(mission, { status: "running", pausedReason: undefined, pausedBy: undefined });
      if (action === "answer" && mission.pendingDecision) {
        return changeMission(mission, { status: "running", pendingDecision: { ...mission.pendingDecision, answer: String(call.body?.answer ?? ""), answeredAt: tick() } });
      }
      return { mission: copy(mission), ...(mission.status === "done" && store.receipt ? { receipt: copy(store.receipt) } : {}) };
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  }

  return {
    store,
    calls,
    handle,
    tick,
    fail(key: string, message: string) {
      overrides.set(key, () => { throw new Error(message); });
    },
    hold(key: string) {
      let release!: (value: unknown) => void;
      let refuse!: (error: Error) => void;
      const pending = new Promise<unknown>((resolve, reject) => { release = resolve; refuse = reject; });
      overrides.set(key, () => pending);
      return { release, refuse: (message: string) => refuse(new Error(message)) };
    },
    requests(method: string, path?: string | RegExp) {
      return calls.filter((call) => call.method === method && (path === undefined || (typeof path === "string" ? call.path === path : path.test(call.path))));
    },
  };
}
