import { describe, expect, it } from "vitest";
import type { BoardMission } from "../../shared/board.ts";
import { boardFixture } from "../testing/board-fixture.ts";

const mission = (extra: Partial<BoardMission> = {}): BoardMission => ({
  id: "m1", title: "Virar produção", goal: "g", createdBy: { kind: "person", id: "rafael@zorg.com" }, createdAt: 1, status: "running",
  leadBotId: "dev", teamBotIds: ["dev"], groupId: "sala", threadId: "th-sala", stepIds: [], feed: [], ...extra,
});

describe("what a member's live stream carries", () => {
  it("passes a task the member may see, the very same frame", async () => {
    const f = boardFixture();
    f.addBot("dev");
    f.visibility.set("nina@zorg.com", { bots: ["dev"] });
    const { task } = await f.feature.tasks.create(f.person("boss@zorg.com", { admin: true }), { title: "Do dev", assignee: "dev" });
    const frame = { kind: "board.task", task };
    expect(f.feature.memberFrame("nina@zorg.com", frame)).toBe(frame);
  });

  it("drops a task the member may not see, even when the member sees everything else", async () => {
    const f = boardFixture();
    f.addBot("dev");
    f.addBot("atlas");
    f.visibility.set("nina@zorg.com", { bots: ["dev"] });
    const { task } = await f.feature.tasks.create(f.person("boss@zorg.com", { admin: true }), { title: "Do atlas", assignee: "atlas" });
    expect(f.feature.memberFrame("nina@zorg.com", { kind: "board.task", task })).toBeUndefined();
    expect(f.feature.memberFrame("nina@zorg.com", { kind: "board.task.deleted", id: task.id })).toBeUndefined();
  });

  it("withdraws a task once, from a member who had it and no longer may see it", async () => {
    const f = boardFixture();
    f.addBot("dev");
    f.addBot("atlas");
    f.visibility.set("nina@zorg.com", { bots: ["dev"] });
    const boss = f.person("boss@zorg.com", { admin: true });
    const { task } = await f.feature.tasks.create(boss, { title: "Do dev", assignee: "dev" });
    f.feature.frames.noteListed("nina@zorg.com", [task], []);
    const { task: moved } = await f.feature.tasks.update(boss, task.id, { assignee: "atlas" });
    expect(f.feature.memberFrame("nina@zorg.com", { kind: "board.task", task: moved })).toEqual({ kind: "board.task.deleted", id: task.id });
    expect(f.feature.memberFrame("nina@zorg.com", { kind: "board.task", task: moved })).toBeUndefined();
  });

  it("tells a member about a deleted task only when the member had been shown it", async () => {
    const f = boardFixture();
    f.addBot("dev");
    f.visibility.set("nina@zorg.com", { bots: ["dev"] });
    const { task } = await f.feature.tasks.create(f.person("boss@zorg.com", { admin: true }), { title: "Do dev", assignee: "dev" });
    f.feature.memberFrame("nina@zorg.com", { kind: "board.task", task });
    expect(f.feature.memberFrame("nina@zorg.com", { kind: "board.task.deleted", id: task.id })).toEqual({ kind: "board.task.deleted", id: task.id });
    expect(f.feature.memberFrame("nina@zorg.com", { kind: "board.task.deleted", id: task.id })).toBeUndefined();
  });

  it("keeps the people apart: what one member was shown says nothing about another", async () => {
    const f = boardFixture();
    f.addBot("dev");
    f.visibility.set("nina@zorg.com", { bots: ["dev"] });
    f.visibility.set("carla@cliente.com", {});
    const { task } = await f.feature.tasks.create(f.person("boss@zorg.com", { admin: true }), { title: "Do dev", assignee: "dev" });
    f.feature.memberFrame("nina@zorg.com", { kind: "board.task", task });
    expect(f.feature.memberFrame("carla@cliente.com", { kind: "board.task", task })).toBeUndefined();
    expect(f.feature.memberFrame("carla@cliente.com", { kind: "board.task.deleted", id: task.id })).toBeUndefined();
  });

  it("filters missions by who may see the room", () => {
    const f = boardFixture();
    f.visibility.set("nina@zorg.com", { groups: ["sala"] });
    f.visibility.set("carla@cliente.com", {});
    expect(f.feature.memberFrame("nina@zorg.com", { kind: "board.mission", mission: mission() })).toMatchObject({ kind: "board.mission" });
    expect(f.feature.memberFrame("carla@cliente.com", { kind: "board.mission", mission: mission() })).toBeUndefined();
    expect(f.feature.memberFrame("rafael@zorg.com", { kind: "board.mission", mission: mission() })).toMatchObject({ kind: "board.mission" });
    expect(f.feature.memberFrame("nina@zorg.com", { kind: "board.mission.deleted", id: "m1" })).toMatchObject({ kind: "board.mission.deleted" });
  });

  it("never shows a member which limit stopped a mission, and keeps the plain reason", () => {
    const f = boardFixture();
    f.visibility.set("nina@zorg.com", { groups: ["sala"] });
    const stopped = mission({ status: "paused", pausedBy: "system", pausedReason: "um limite de uso foi atingido.", pausedDetail: "o limite de gasto do mês foi atingido." });
    const shown = f.feature.memberFrame("nina@zorg.com", { kind: "board.mission", mission: stopped }) as { mission: BoardMission };
    expect(shown.mission.pausedReason).toBe("um limite de uso foi atingido.");
    expect(shown.mission).not.toHaveProperty("pausedDetail");
    expect(JSON.stringify(shown)).not.toContain("gasto");
  });

  it("shows a member without an email only the cards that very session made", async () => {
    const f = boardFixture();
    const one = { ...f.person("x@zorg.com"), actor: { kind: "person" as const, id: "p_one", name: "um" }, email: undefined };
    const { task } = await f.feature.tasks.create(one, { title: "Meu" });
    const frame = { kind: "board.task", task };
    expect(f.feature.memberFrame("p_one", frame)).toBe(frame);
    expect(f.feature.memberFrame("p_two", frame)).toBeUndefined();
    expect(f.feature.memberFrame(undefined, frame)).toBeUndefined();
  });

  it("lets any other kind of frame through untouched", () => {
    const f = boardFixture();
    const frame = { kind: "message", threadId: "t" };
    expect(f.feature.memberFrame("nina@zorg.com", frame)).toBe(frame);
  });
});
