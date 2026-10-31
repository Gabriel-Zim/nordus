import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BoardTask } from "../../shared/board.ts";
import { BOARD_LIMITS } from "../../shared/board.ts";
import { BoardError } from "./errors.ts";
import { PERSON_PACE } from "./pace.ts";
import { boardFixture } from "../testing/board-fixture.ts";

const admin = (f: ReturnType<typeof boardFixture>) => f.person("boss@zorg.com", { admin: true });

async function rejects(promise: Promise<unknown> | (() => unknown), status: number): Promise<void> {
  const error = await (typeof promise === "function" ? Promise.resolve().then(promise) : promise).then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(BoardError);
  expect((error as BoardError).status).toBe(status);
}

const seed = (tasks: BoardTask[]) => {
  const dir = mkdtempSync(join(tmpdir(), "nordus-board-fair-"));
  writeFileSync(join(dir, "board.json"), JSON.stringify({ version: 1, nextId: tasks.length + 1, tasks }));
  return dir;
};
const card = (id: number, by: string, extra: Partial<BoardTask> = {}): BoardTask => ({
  id, title: `Tarefa ${id}`, status: "done", createdBy: { kind: "person", id: by }, createdAt: id, updatedAt: id, history: [], ...extra,
});

describe("a member cannot flood the board", () => {
  it("limits the cards one member makes in an hour, never an administrator, and lets the member back later", async () => {
    const f = boardFixture();
    const nina = f.person("nina@zorg.com", { visible: {} });
    for (let i = 0; i < PERSON_PACE.createsPerHour; i += 1) await f.feature.tasks.create(nina, { title: `t${i}` });
    await rejects(f.feature.tasks.create(nina, { title: "demais" }), 429);
    await f.feature.tasks.create(admin(f), { title: "o chefe pode" });
    f.clock.now += 3_600_001;
    expect((await f.feature.tasks.create(nina, { title: "de novo" })).task.id).toBe(PERSON_PACE.createsPerHour + 2);
  });

  it("limits the changes one member makes in ten minutes", async () => {
    const f = boardFixture();
    const nina = f.person("nina@zorg.com", { visible: {} });
    const { task } = await f.feature.tasks.create(nina, { title: "Minha" });
    for (let i = 0; i < PERSON_PACE.writesPerWindow - 1; i += 1) await f.feature.tasks.update(nina, task.id, { note: `n${i}` });
    await rejects(f.feature.tasks.update(nina, task.id, { note: "demais" }), 429);
    await rejects(() => f.feature.tasks.remove(nina, task.id), 429);
    f.clock.now += 600_001;
    await f.feature.tasks.update(nina, task.id, { note: "de novo" });
  });

  it("limits how many cards one member keeps on the board", async () => {
    const dir = seed(Array.from({ length: PERSON_PACE.cardsKept }, (_, index) => card(index + 1, "nina@zorg.com", { status: "todo" })));
    const f = boardFixture({ dataDir: dir });
    const nina = f.person("nina@zorg.com", { visible: {} });
    await rejects(f.feature.tasks.create(nina, { title: "mais um" }), 409);
    expect((await f.feature.tasks.create(admin(f), { title: "o chefe pode" })).task.id).toBe(PERSON_PACE.cardsKept + 1);
  });
});

describe("a full board", () => {
  it("makes room with the creator's own finished card, never with somebody else's", async () => {
    const tasks = Array.from({ length: BOARD_LIMITS.tasks }, (_, index) => card(index + 1, index === BOARD_LIMITS.tasks - 1 ? "nina@zorg.com" : "outra@zorg.com"));
    const f = boardFixture({ dataDir: seed(tasks) });
    const nina = f.person("nina@zorg.com", { visible: {} });
    const { task } = await f.feature.tasks.create(nina, { title: "Nova" });
    expect(task.id).toBe(BOARD_LIMITS.tasks + 1);
    expect(f.feature.tasks.peek(BOARD_LIMITS.tasks)).toBeUndefined();
    expect(f.feature.tasks.peek(1)).toBeDefined();
    expect(f.feature.tasks.peek(BOARD_LIMITS.tasks - 1)).toBeDefined();
  });

  it("says it is full when the only finished cards are other people's", async () => {
    const tasks = Array.from({ length: BOARD_LIMITS.tasks }, (_, index) => card(index + 1, "outra@zorg.com"));
    const f = boardFixture({ dataDir: seed(tasks) });
    const nina = f.person("nina@zorg.com", { visible: {} });
    await rejects(f.feature.tasks.create(nina, { title: "Nova" }), 409);
    expect(f.feature.tasks.list(admin(f))).toHaveLength(BOARD_LIMITS.tasks);
  });
});
