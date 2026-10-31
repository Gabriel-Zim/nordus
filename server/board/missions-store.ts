import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";
import { isJsonObject, readJsonState } from "../state-file.ts";
import { BoardError } from "./errors.ts";
import { fit } from "./salvage.ts";
import { storedMission, type StoredMission } from "./schema.ts";

const UNREADABLE = "As missões não puderam ser lidas e estão protegidas. Avise quem cuida do servidor.";
const FULL = "O arquivo das missões está cheio. Apague missões antigas para continuar.";
const UNSAVABLE = "Essa missão não pôde ser guardada. Confira os textos e tente de novo.";
const MAX_MISSIONS = 200;
const MAX_FILE_BYTES = 24 * 1024 * 1024;

export class MissionStore {
  private readonly file: string;
  private readonly maxBytes: number;
  private readonly missions = new Map<string, StoredMission>();
  private frozen = false;

  constructor(dataDir: string, options: { maxBytes?: number } = {}) {
    this.file = join(dataDir, "missions.json");
    this.maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
    const loaded = readJsonState(this.file, isJsonObject);
    if (loaded.status === "unreadable") {
      this.frozen = true;
      return;
    }
    if (loaded.status === "missing") return;
    const rows = Array.isArray(loaded.value.missions) ? loaded.value.missions : [];
    for (const row of rows) {
      const kept = fit(storedMission, row);
      if (kept) this.missions.set(kept.id, kept);
      else console.warn("[board] a stored mission was skipped because it does not match the expected shape");
    }
  }

  get unreadable(): boolean {
    return this.frozen;
  }

  get(id: string): StoredMission | undefined {
    return this.missions.get(id);
  }

  all(): StoredMission[] {
    return [...this.missions.values()];
  }

  byThread(threadId: string): StoredMission | undefined {
    for (const mission of this.missions.values()) if (mission.threadId === threadId) return mission;
    return undefined;
  }

  insert(mission: StoredMission): StoredMission {
    this.assertWritable();
    if (this.missions.size >= MAX_MISSIONS) throw new BoardError(409, "Há missões demais guardadas. Apague as antigas para abrir outra.");
    return this.commit(mission, undefined);
  }

  save(mission: StoredMission): StoredMission {
    this.assertWritable();
    return this.commit(mission, this.missions.get(mission.id));
  }

  remove(id: string): StoredMission | undefined {
    this.assertWritable();
    const before = this.missions.get(id);
    if (!before) return undefined;
    this.missions.delete(id);
    try {
      this.write();
    } catch (error) {
      this.missions.set(id, before);
      throw error;
    }
    return before;
  }

  private commit(row: StoredMission, before: StoredMission | undefined): StoredMission {
    const mission = fit(storedMission, row);
    if (!mission) throw new BoardError(400, UNSAVABLE);
    this.missions.set(mission.id, mission);
    try {
      this.write();
    } catch (error) {
      if (before) this.missions.set(mission.id, before);
      else this.missions.delete(mission.id);
      throw error;
    }
    return mission;
  }

  private assertWritable(): void {
    if (this.frozen) throw new BoardError(503, UNREADABLE);
  }

  private write(): void {
    const body = JSON.stringify({ version: 1, missions: this.all() });
    if (Buffer.byteLength(body) > this.maxBytes) throw new BoardError(409, FULL);
    writeFileAtomic(this.file, body, { mode: 0o600 });
  }
}
