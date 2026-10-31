import { describe, expect, it } from "vitest";
import type { BoardTask } from "../../shared/board.ts";
import { boardFixture } from "../testing/board-fixture.ts";
import { botMayChange, botSeesTask, botsTiedTo, personSeesMission, personSeesTask } from "./directory.ts";

const base = (extra: Partial<BoardTask>): BoardTask => ({
  id: 1, title: "t", status: "todo", createdBy: { kind: "person", id: "rafael@zorg.com" }, createdAt: 1, updatedAt: 1, history: [], ...extra,
});

describe("who sees a task: people", () => {
  it("shows an admin everything", () => {
    const f = boardFixture();
    expect(personSeesTask(base({}), f.person("boss@zorg.com", { admin: true }), f.dir)).toBe(true);
  });

  it("shows a member their own tasks, tasks assigned to them, and tasks from conversations they can see", () => {
    const f = boardFixture();
    f.addBot("dev");
    const nina = f.person("nina@zorg.com", { visible: { threads: ["th-dev"] } });
    expect(personSeesTask(base({ createdBy: { kind: "person", id: "nina@zorg.com" } }), nina, f.dir)).toBe(true);
    expect(personSeesTask(base({ assignee: "nina@zorg.com" }), nina, f.dir)).toBe(true);
    expect(personSeesTask(base({ source: { threadId: "th-dev" } }), nina, f.dir)).toBe(true);
  });

  it("hides another person's loose task and tasks from conversations the member cannot see", () => {
    const f = boardFixture();
    f.addBot("dev");
    const nina = f.person("nina@zorg.com", { visible: {} });
    expect(personSeesTask(base({}), nina, f.dir)).toBe(false);
    expect(personSeesTask(base({ source: { threadId: "th-dev" } }), nina, f.dir)).toBe(false);
  });

  it("shows a member the tasks of agents and rooms they can see, and nothing of hidden ones", () => {
    const f = boardFixture();
    f.addBot("dev");
    f.addBot("atlas");
    f.addRoom("sala", ["dev", "atlas"]);
    const nina = f.person("nina@zorg.com", { visible: { bots: ["dev"], groups: ["sala"] } });
    expect(personSeesTask(base({ assignee: "dev" }), nina, f.dir)).toBe(true);
    expect(personSeesTask(base({ assignee: "atlas" }), nina, f.dir)).toBe(false);
    expect(personSeesTask(base({ source: { threadId: "th-sala", groupId: "sala" } }), nina, f.dir)).toBe(true);
    expect(personSeesTask(base({ createdBy: { kind: "bot", id: "atlas" } }), nina, f.dir)).toBe(false);
  });

  it("hides a card from a conversation the member cannot see, even when the member sees the agent it belongs to", () => {
    const f = boardFixture();
    f.addBot("dev");
    f.addBot("atlas");
    const nina = f.person("nina@zorg.com", { visible: { bots: ["dev"] } });
    expect(personSeesTask(base({ assignee: "dev", source: { threadId: "th-atlas" } }), nina, f.dir)).toBe(false);
    expect(personSeesTask(base({ createdBy: { kind: "bot", id: "dev" }, source: { threadId: "th-atlas" } }), nina, f.dir)).toBe(false);
    expect(personSeesTask(base({ assignee: "dev", thread: { threadId: "th-atlas", botId: "atlas" } }), nina, f.dir)).toBe(false);
  });

  it("needs every conversation a card is tied to, not just one of them", () => {
    const f = boardFixture();
    f.addBot("dev");
    f.addBot("atlas");
    const card = base({ source: { threadId: "th-dev" }, thread: { threadId: "th-atlas", botId: "atlas" } });
    expect(personSeesTask(card, f.person("a@zorg.com", { visible: { threads: ["th-dev"] } }), f.dir)).toBe(false);
    expect(personSeesTask(card, f.person("b@zorg.com", { visible: { threads: ["th-atlas"] } }), f.dir)).toBe(false);
    expect(personSeesTask(card, f.person("c@zorg.com", { visible: { threads: ["th-dev", "th-atlas"] } }), f.dir)).toBe(true);
  });

  it("still shows a loose card through the agent it is tied to", () => {
    const f = boardFixture();
    f.addBot("dev");
    const nina = f.person("nina@zorg.com", { visible: { bots: ["dev"] } });
    expect(personSeesTask(base({ assignee: "dev" }), nina, f.dir)).toBe(true);
    expect(personSeesTask(base({ createdBy: { kind: "bot", id: "dev" } }), nina, f.dir)).toBe(true);
  });

  it("shows a mission to its creator, to admins, and to people who see its room", () => {
    const f = boardFixture();
    const mission = { createdBy: { kind: "person", id: "rafael@zorg.com" }, groupId: "sala", threadId: "th-sala" } as Parameters<typeof personSeesMission>[0];
    expect(personSeesMission(mission, f.person("rafael@zorg.com"))).toBe(true);
    expect(personSeesMission(mission, f.person("boss@zorg.com", { admin: true }))).toBe(true);
    expect(personSeesMission(mission, f.person("nina@zorg.com", { visible: { groups: ["sala"] } }))).toBe(true);
    expect(personSeesMission(mission, f.person("outra@zorg.com", { visible: {} }))).toBe(false);
  });
});

describe("who sees a task: agents", () => {
  it("reaches only tasks assigned to it or from its own conversations and rooms", () => {
    const f = boardFixture();
    f.addBot("dev");
    f.addBot("atlas");
    f.addRoom("sala", ["dev"]);
    const dev = f.botCaller("dev");
    expect(botSeesTask(base({ assignee: "dev" }), dev, f.dir)).toBe(true);
    expect(botSeesTask(base({ source: { threadId: "th-dev" } }), dev, f.dir)).toBe(true);
    expect(botSeesTask(base({ source: { threadId: "th-sala", groupId: "sala" } }), dev, f.dir)).toBe(true);
    expect(botSeesTask(base({ assignee: "atlas" }), dev, f.dir)).toBe(false);
    expect(botSeesTask(base({ source: { threadId: "th-atlas" } }), dev, f.dir)).toBe(false);
    expect(botSeesTask(base({}), dev, f.dir)).toBe(false);
  });

  it("keeps a client's agent away from anything tied to another client or to the house", () => {
    const f = boardFixture();
    f.addBot("acme-bot", "client:acme");
    f.addBot("beta-bot", "client:beta");
    f.addBot("atlas", "internal");
    f.addRoom("sala", ["acme-bot", "atlas"]);
    const acme = f.botCaller("acme-bot");
    expect(botSeesTask(base({ assignee: "acme-bot", createdBy: { kind: "bot", id: "acme-bot" } }), acme, f.dir)).toBe(true);
    expect(botSeesTask(base({ assignee: "acme-bot", createdBy: { kind: "bot", id: "atlas" } }), acme, f.dir)).toBe(false);
    expect(botSeesTask(base({ assignee: "acme-bot", source: { threadId: "th-beta-bot" } }), acme, f.dir)).toBe(false);
    expect(botSeesTask(base({ source: { threadId: "th-sala", groupId: "sala" } }), acme, f.dir)).toBe(false);
  });

  it("lets a house agent keep working with a task a person made in a client's conversation", () => {
    const f = boardFixture();
    f.addBot("acme-bot", "client:acme");
    f.addBot("atlas", "internal");
    expect(botSeesTask(base({ assignee: "atlas", source: { threadId: "th-acme-bot" } }), f.botCaller("atlas"), f.dir)).toBe(true);
  });

  it("lets an agent change its own card, its own creations, loose cards it can see and the cards of the mission it leads", () => {
    const f = boardFixture();
    f.addBot("dev");
    f.addBot("atlas");
    f.addRoom("sala", ["dev", "atlas"]);
    const dev = f.botCaller("dev");
    const source = { threadId: "th-sala", groupId: "sala" };
    const lead = (missionId: string) => (missionId === "m1" ? "dev" : undefined);
    expect(botMayChange(base({ assignee: "dev", source }), dev, f.dir, lead)).toBe(true);
    expect(botMayChange(base({ assignee: "atlas", source }), dev, f.dir, lead)).toBe(false);
    expect(botMayChange(base({ source }), dev, f.dir, lead)).toBe(true);
    expect(botMayChange(base({ assignee: "atlas", source, missionId: "m1" }), dev, f.dir, lead)).toBe(true);
    expect(botMayChange(base({ assignee: "atlas", source, missionId: "m2" }), dev, f.dir, lead)).toBe(false);
  });

  it("lists every agent a task is tied to", () => {
    const f = boardFixture();
    f.addBot("dev");
    f.addBot("atlas");
    f.addRoom("sala", ["dev", "atlas"]);
    const tied = botsTiedTo(base({ assignee: "dev", source: { threadId: "th-sala", groupId: "sala" } }), f.dir);
    expect([...tied].sort()).toEqual(["atlas", "dev"]);
  });
});
