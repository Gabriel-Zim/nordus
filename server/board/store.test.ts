import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BoardTask } from "../../shared/board.ts";
import { BOARD_LIMITS } from "../../shared/board.ts";
import { BoardError } from "./errors.ts";
import { BoardStore } from "./store.ts";

const person = { kind: "person", id: "rafael@zorg.com" } as const;

function task(id: number, extra: Partial<BoardTask> = {}): BoardTask {
  return { id, title: `Tarefa ${id}`, status: "todo", createdBy: person, createdAt: id, updatedAt: id, history: [], ...extra };
}

const dirOf = () => mkdtempSync(join(tmpdir(), "nordus-board-store-"));

describe("board store", () => {
  it("numbers tasks upward and never reuses a number, even after a delete or a restart", () => {
    const dir = dirOf();
    const store = new BoardStore(dir);
    expect(store.insert((id) => task(id)).id).toBe(1);
    expect(store.insert((id) => task(id)).id).toBe(2);
    store.remove(2);
    expect(store.insert((id) => task(id)).id).toBe(3);
    store.remove(3);
    const again = new BoardStore(dir);
    expect(again.all().map((item) => item.id)).toEqual([1]);
    expect(again.insert((id) => task(id)).id).toBe(4);
  });

  it("survives a restart with what was saved", () => {
    const dir = dirOf();
    const store = new BoardStore(dir);
    const first = store.insert((id) => task(id, { title: "Subir o deploy", assignee: "dev" }));
    store.save({ ...first, status: "doing" });
    const reread = new BoardStore(dir).get(first.id);
    expect(reread).toMatchObject({ title: "Subir o deploy", assignee: "dev", status: "doing" });
  });

  it("keeps the file private to its owner", () => {
    const dir = dirOf();
    new BoardStore(dir).insert((id) => task(id));
    expect(JSON.parse(readFileSync(join(dir, "board.json"), "utf8")).tasks).toHaveLength(1);
    expect(statSync(join(dir, "board.json")).mode & 0o777).toBe(0o600);
  });

  it("refuses to write over a file it cannot read, and keeps the damaged file", () => {
    const dir = dirOf();
    writeFileSync(join(dir, "board.json"), "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = new BoardStore(dir);
    expect(store.unreadable).toBe(true);
    expect(store.all()).toEqual([]);
    expect(() => store.insert((id) => task(id))).toThrow(BoardError);
    expect(readFileSync(join(dir, "board.json"), "utf8")).toBe("{not json");
    warn.mockRestore();
  });

  it("skips a stored task that has the wrong shape without losing the others", () => {
    const dir = dirOf();
    writeFileSync(join(dir, "board.json"), JSON.stringify({ version: 1, nextId: 9, tasks: [task(1), { id: "x" }, task(2)] }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = new BoardStore(dir);
    expect(store.all().map((item) => item.id)).toEqual([1, 2]);
    expect(store.insert((id) => task(id)).id).toBe(9);
    warn.mockRestore();
  });

  const seeded = (build: (id: number) => BoardTask) => {
    const dir = dirOf();
    const tasks = Array.from({ length: BOARD_LIMITS.tasks }, (_, index) => build(index + 1));
    writeFileSync(join(dir, "board.json"), JSON.stringify({ version: 1, nextId: BOARD_LIMITS.tasks + 1, tasks }));
    return new BoardStore(dir);
  };

  it("makes room by dropping the oldest finished task, never a mission step", () => {
    const store = seeded((id) => task(id, { status: id <= 2 ? "done" : "todo", updatedAt: id, ...(id === 1 ? { missionId: "m1" } : {}) }));
    const added = store.insert((id) => task(id), (candidate) => Boolean(candidate.missionId));
    expect(added.id).toBe(BOARD_LIMITS.tasks + 1);
    expect(store.get(1)).toBeDefined();
    expect(store.get(2)).toBeUndefined();
  });

  it("says the board is full when nothing finished can go", () => {
    const store = seeded((id) => task(id));
    expect(() => store.insert((id) => task(id))).toThrow(/limite de tarefas/);
  });

  it("keeps a stored task that has a text longer than today's limit, cut to the limit, instead of dropping it", () => {
    const dir = dirOf();
    const links = Array.from({ length: BOARD_LIMITS.links + 3 }, (_, index) => ({ url: `https://exemplo.com/${index}` }));
    writeFileSync(join(dir, "board.json"), JSON.stringify({ version: 1, nextId: 3, tasks: [
      task(1, { description: "x".repeat(BOARD_LIMITS.description + 50), links }), task(2),
    ] }));
    const store = new BoardStore(dir);
    expect(store.all().map((item) => item.id)).toEqual([1, 2]);
    expect(store.get(1)?.description).toHaveLength(BOARD_LIMITS.description);
    expect(store.get(1)?.links).toHaveLength(BOARD_LIMITS.links);
  });

  it("shortens on save what the loader would shorten, so memory and disk say the same thing", () => {
    const dir = dirOf();
    const store = new BoardStore(dir);
    const saved = store.insert((id) => task(id, { description: "y".repeat(BOARD_LIMITS.description + 30) }));
    expect(saved.description).toHaveLength(BOARD_LIMITS.description);
    expect(new BoardStore(dir).get(saved.id)?.description).toHaveLength(BOARD_LIMITS.description);
  });

  it("refuses to save a task the loader would throw away, and keeps what was there", () => {
    const dir = dirOf();
    const store = new BoardStore(dir);
    const first = store.insert((id) => task(id));
    expect(() => store.save({ ...first, status: "weird" as never })).toThrow(BoardError);
    expect(() => store.insert((id) => task(id, { title: "" }))).toThrow(BoardError);
    expect(store.get(first.id)?.status).toBe("todo");
    expect(store.all()).toHaveLength(1);
    expect(new BoardStore(dir).all()).toHaveLength(1);
  });

  it("refuses to grow the file past its size limit, and leaves the board as it was", () => {
    const dir = dirOf();
    const store = new BoardStore(dir, { maxBytes: 4_000 });
    store.insert((id) => task(id, { description: "a".repeat(1_500) }));
    store.insert((id) => task(id, { description: "b".repeat(1_500) }));
    expect(() => store.insert((id) => task(id, { description: "c".repeat(1_500) }))).toThrow(/cheio/);
    expect(store.all()).toHaveLength(2);
    expect(store.insert((id) => task(id)).id).toBe(3);
  });

  it("makes room only with what the caller allows to be dropped, never somebody else's finished task", () => {
    const store = seeded((id) => task(id, { status: "done", updatedAt: id, createdBy: id <= 2 ? { kind: "person", id: "outra@zorg.com" } : person }));
    const keepOthers = (candidate: BoardTask) => !(candidate.createdBy.kind === "person" && candidate.createdBy.id === person.id);
    const added = store.insert((id) => task(id), keepOthers);
    expect(added.id).toBe(BOARD_LIMITS.tasks + 1);
    expect(store.get(1)).toBeDefined();
    expect(store.get(2)).toBeDefined();
    expect(store.get(3)).toBeUndefined();
  });
});
