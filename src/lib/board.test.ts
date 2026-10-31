import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { at, makeBot, makeMission, makeTask, person } from "@/testing/board";
import type { Bot } from "@/state/store";
import {
  FILTER_ALL, FILTER_NONE, filterFor, groupByColumn, makeDirectory, mergeMission, mergeTask, missionSteps, missionStamp, normalizeTask,
  sortMissions, sortTasks,
} from "./board";

beforeEach(() => setLocale("en"));

describe("ordering and columns", () => {
  it("puts the most recently touched task first and breaks ties by id", () => {
    const tasks = [makeTask(1, { updatedAt: 10 }), makeTask(2, { updatedAt: 30 }), makeTask(3, { updatedAt: 30 }), makeTask(4, { updatedAt: 20 })];
    expect(sortTasks(tasks).map((task) => task.id)).toEqual([3, 2, 4, 1]);
    expect(tasks.map((task) => task.id)).toEqual([1, 2, 3, 4]);
  });

  it("splits tasks into the four columns, newest first, and filters by assignee", () => {
    const tasks = [
      makeTask(1, { status: "todo", updatedAt: 1 }),
      makeTask(2, { status: "doing", assignee: "dev", updatedAt: 2 }),
      makeTask(3, { status: "todo", assignee: "dev", updatedAt: 3 }),
      makeTask(4, { status: "done", assignee: "ada@nordus.test", updatedAt: 4 }),
      makeTask(5, { status: "review", updatedAt: 5 }),
    ];
    const ids = (filter: string) => Object.values(groupByColumn(tasks, filter)).map((column) => column.map((task) => task.id));
    expect(Object.keys(groupByColumn(tasks))).toEqual(["todo", "doing", "review", "done"]);
    expect(ids(FILTER_ALL)).toEqual([[3, 1], [2], [5], [4]]);
    expect(ids(FILTER_NONE)).toEqual([[1], [], [5], []]);
    expect(ids(filterFor("dev"))).toEqual([[3], [2], [], []]);
    expect(ids(filterFor("ada@nordus.test"))).toEqual([[], [], [], [4]]);
  });

  it("ignores a task whose status the app does not know instead of crashing", () => {
    const odd = { ...makeTask(9), status: "blocked" } as unknown as ReturnType<typeof makeTask>;
    expect(groupByColumn([odd, makeTask(1)]).todo.map((task) => task.id)).toEqual([1]);
  });
});

describe("merging what the server says", () => {
  it("adds a new task and replaces one with the same or a newer stamp", () => {
    const first = makeTask(1, { updatedAt: 100, title: "Old" });
    const added = mergeTask([first], makeTask(2, { updatedAt: 50 }));
    expect(added.map((task) => task.id)).toEqual([1, 2]);
    expect(mergeTask(added, makeTask(1, { updatedAt: 100, title: "Same stamp" }))[0]!.title).toBe("Same stamp");
    expect(mergeTask(added, makeTask(1, { updatedAt: 200, title: "Newer" }))[0]!.title).toBe("Newer");
  });

  it("keeps the very same list when the frame is older than what is on screen", () => {
    const current = [makeTask(1, { updatedAt: 200, title: "Fresh" })];
    expect(mergeTask(current, makeTask(1, { updatedAt: 100, title: "Stale" }))).toBe(current);
  });

  it("gives a task with no history an empty one", () => {
    const bare = { ...makeTask(1), history: undefined } as unknown as ReturnType<typeof makeTask>;
    expect(normalizeTask(bare).history).toEqual([]);
    expect(mergeTask([], bare)[0]!.history).toEqual([]);
  });

  it("dates a mission by its latest event, since missions carry no updatedAt", () => {
    const quiet = makeMission();
    const busy = makeMission({ feed: [{ at: at(27, 11), author: person, kind: "progress", text: "Halfway" }] });
    const decided = makeMission({ pendingDecision: { question: "Ship?", askedAt: at(27, 12), askedBy: "dev", answeredAt: at(27, 13), answer: "Yes" } });
    expect(missionStamp(quiet)).toBe(at(27, 9));
    expect(missionStamp(busy)).toBe(at(27, 11));
    expect(missionStamp(decided)).toBe(at(27, 13));
  });

  it("never lets an older mission frame replace a newer one", () => {
    const newer = makeMission({ status: "waiting", feed: [{ at: at(27, 11), author: person, kind: "progress", text: "Now" }] });
    const older = makeMission({ status: "running" });
    const current = [newer];
    expect(mergeMission(current, older)).toBe(current);
    expect(mergeMission([older], newer)[0]!.status).toBe("waiting");
    expect(mergeMission([], older)).toHaveLength(1);
  });
});

describe("mission steps and order", () => {
  it("reads each step from its task: done, in flight or still to do", () => {
    const tasks = [makeTask(1, { status: "done" }), makeTask(2, { status: "doing" }), makeTask(3, { status: "review" }), makeTask(4, { status: "todo" })];
    const steps = missionSteps(makeMission({ stepIds: [1, 2, 3, 4, 99] }), tasks);
    expect(steps.map((step) => step.state)).toEqual(["done", "active", "active", "todo", "todo"]);
    expect(steps.map((step) => step.id)).toEqual([1, 2, 3, 4, 99]);
    expect(steps[4]!.task).toBeUndefined();
  });

  it("lists what waits for you first, then what runs, then what stopped", () => {
    const missions = [
      makeMission({ id: "done", status: "done", createdAt: 5 }),
      makeMission({ id: "failed", status: "failed", createdAt: 5 }),
      makeMission({ id: "paused", status: "paused", createdAt: 5 }),
      makeMission({ id: "older", status: "running", createdAt: 1 }),
      makeMission({ id: "newer", status: "planning", createdAt: 9 }),
      makeMission({ id: "waiting", status: "waiting", createdAt: 2 }),
    ];
    expect(sortMissions(missions).map((mission) => mission.id)).toEqual(["waiting", "newer", "older", "paused", "failed", "done"]);
  });
});

describe("who is who", () => {
  const bots = [makeBot("dev", "Dev")] as unknown as Bot[];
  const people = [{ id: "ada@nordus.test", name: "Ada Lovelace" }, { id: "rafael@nordus.test" }];
  const directory = makeDirectory({ bots, people, me: { email: "Rafael@Nordus.test", name: "Rafael Silva" } });

  it("names agents and people, falling back to the email's first part", () => {
    expect(directory.assigneeName("dev")).toBe("Dev");
    expect(directory.assigneeName("ghost")).toBe("Agent");
    expect(directory.assigneeName("ada@nordus.test")).toBe("Ada Lovelace");
    expect(directory.assigneeName("rafael@nordus.test")).toBe("Rafael Silva");
    expect(directory.assigneeName("grace@nordus.test")).toBe("grace");
  });

  it("says You for the signed-in person and spells out everyone else", () => {
    expect(directory.actorName(person)).toBe("You");
    expect(directory.isMe(person)).toBe(true);
    expect(directory.actorName({ kind: "person", id: "ada@nordus.test" })).toBe("Ada Lovelace");
    expect(directory.actorName({ kind: "bot", id: "dev" })).toBe("Dev");
    expect(directory.actorName({ kind: "bot", id: "dev", name: "Dev (old name)" })).toBe("Dev (old name)");
    expect(directory.actorName({ kind: "system" })).toBe("System");
    expect(directory.isMe({ kind: "bot", id: "rafael@nordus.test" })).toBe(false);
  });

  it("treats the machine's owner as you only while no email is known", () => {
    const alone = makeDirectory({ bots, people: [], me: {} });
    expect(alone.isMe({ kind: "person", id: "owner" })).toBe(true);
    expect(alone.actorName({ kind: "person", id: "owner" })).toBe("You");
    expect(directory.isMe({ kind: "person", id: "owner" })).toBe(false);
    expect(directory.actorName({ kind: "person", id: "owner" })).toBe("Owner");
  });
});
