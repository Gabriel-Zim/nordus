import { join } from "node:path";
import type { BoardTask } from "../../shared/board.ts";
import { BOARD_LIMITS } from "../../shared/board.ts";
import { writeFileAtomic } from "../atomic.ts";
import { isJsonObject, readJsonState } from "../state-file.ts";
import { BoardError } from "./errors.ts";
import { fit } from "./salvage.ts";
import { storedTask } from "./schema.ts";

const UNREADABLE = "O quadro de tarefas não pôde ser lido e está protegido. Avise quem cuida do servidor.";
const FULL = "O quadro está cheio. Apague cartões que já terminaram para continuar.";
const UNSAVABLE = "Esse cartão não pôde ser guardado. Confira os textos e tente de novo.";
const MAX_FILE_BYTES = 24 * 1024 * 1024;

export class BoardStore {
  private readonly file: string;
  private readonly maxBytes: number;
  private readonly tasks = new Map<number, BoardTask>();
  private next = 1;
  private frozen = false;

  constructor(dataDir: string, options: { maxBytes?: number } = {}) {
    this.file = join(dataDir, "board.json");
    this.maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
    const loaded = readJsonState(this.file, isJsonObject);
    if (loaded.status === "unreadable") {
      this.frozen = true;
      return;
    }
    if (loaded.status === "missing") return;
    const rows = Array.isArray(loaded.value.tasks) ? loaded.value.tasks : [];
    for (const row of rows) {
      const kept = fit(storedTask, row);
      if (kept) this.tasks.set(kept.id, kept as BoardTask);
      else console.warn("[board] a stored task was skipped because it does not match the expected shape");
    }
    const saved = Number(loaded.value.nextId);
    const floor = Math.max(0, ...this.tasks.keys()) + 1;
    this.next = Math.max(floor, Number.isSafeInteger(saved) && saved > 0 ? saved : 1);
  }

  get unreadable(): boolean {
    return this.frozen;
  }

  get(id: number): BoardTask | undefined {
    return this.tasks.get(id);
  }

  all(): BoardTask[] {
    return [...this.tasks.values()];
  }

  insert(build: (id: number) => BoardTask, keep: (task: BoardTask) => boolean = () => false): BoardTask {
    this.assertWritable();
    const evicted = this.tasks.size >= BOARD_LIMITS.tasks ? this.oldestFinished(keep) : undefined;
    if (this.tasks.size >= BOARD_LIMITS.tasks && !evicted) {
      throw new BoardError(409, "O quadro chegou ao limite de tarefas. Apague algumas para continuar.");
    }
    const id = this.next;
    const task = this.fitted(build(id));
    if (evicted) this.tasks.delete(evicted.id);
    this.tasks.set(id, task);
    this.next = id + 1;
    try {
      this.write();
    } catch (error) {
      this.tasks.delete(id);
      if (evicted) this.tasks.set(evicted.id, evicted);
      this.next = id;
      throw error;
    }
    return task;
  }

  save(row: BoardTask): BoardTask {
    this.assertWritable();
    const task = this.fitted(row);
    const before = this.tasks.get(task.id);
    this.tasks.set(task.id, task);
    try {
      this.write();
    } catch (error) {
      if (before) this.tasks.set(task.id, before);
      else this.tasks.delete(task.id);
      throw error;
    }
    return task;
  }

  remove(id: number): BoardTask | undefined {
    this.assertWritable();
    const before = this.tasks.get(id);
    if (!before) return undefined;
    this.tasks.delete(id);
    try {
      this.write();
    } catch (error) {
      this.tasks.set(id, before);
      throw error;
    }
    return before;
  }

  private oldestFinished(keep: (task: BoardTask) => boolean): BoardTask | undefined {
    let oldest: BoardTask | undefined;
    for (const task of this.tasks.values()) {
      if (task.status !== "done" || keep(task)) continue;
      if (!oldest || task.updatedAt < oldest.updatedAt) oldest = task;
    }
    return oldest;
  }

  private assertWritable(): void {
    if (this.frozen) throw new BoardError(503, UNREADABLE);
  }

  private fitted(task: BoardTask): BoardTask {
    const kept = fit(storedTask, task);
    if (!kept) throw new BoardError(400, UNSAVABLE);
    return kept as BoardTask;
  }

  private write(): void {
    const body = JSON.stringify({ version: 1, nextId: this.next, tasks: this.all() });
    if (Buffer.byteLength(body) > this.maxBytes) throw new BoardError(409, FULL);
    writeFileAtomic(this.file, body, { mode: 0o600 });
  }
}
