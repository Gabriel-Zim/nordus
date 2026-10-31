import type { BoardFrame, BoardMission, BoardTask } from "../../shared/board.ts";
import { isBoardFrameKind } from "../../shared/board.ts";
import type { BoardDirectory, PersonCaller } from "./directory.ts";
import { personSeesMission, personSeesTask } from "./directory.ts";

interface ViewerMemory {
  tasks: Set<number>;
  missions: Set<string>;
}

const MAX_VIEWERS = 500;
const MAX_REMEMBERED = 5_000;

export interface FrameFilterDeps {
  dir: BoardDirectory;
  member(viewerId: string | undefined): PersonCaller;
}

export class BoardFrameFilter {
  private readonly deps: FrameFilterDeps;
  private readonly memory = new Map<string, ViewerMemory>();

  constructor(deps: FrameFilterDeps) {
    this.deps = deps;
  }

  noteListed(viewerId: string | undefined, tasks: readonly BoardTask[], missions: readonly BoardMission[]): void {
    const memory = this.of(viewerId);
    for (const task of tasks) this.remember(memory.tasks, task.id);
    for (const mission of missions) this.remember(memory.missions, mission.id);
  }

  forget(): void {
    this.memory.clear();
  }

  /** What a member's stream may carry for a board frame: the frame, a withdrawal, or nothing. */
  frameFor(viewerId: string | undefined, payload: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!isBoardFrameKind(payload.kind)) return payload;
    const frame = payload as unknown as BoardFrame;
    const who = this.deps.member(viewerId);
    const memory = this.of(viewerId);
    switch (frame.kind) {
      case "board.task": {
        if (personSeesTask(frame.task, who, this.deps.dir)) {
          this.remember(memory.tasks, frame.task.id);
          return payload;
        }
        return memory.tasks.delete(frame.task.id) ? { kind: "board.task.deleted", id: frame.task.id } : undefined;
      }
      case "board.task.deleted":
        return memory.tasks.delete(frame.id) ? payload : undefined;
      case "board.mission": {
        if (personSeesMission(frame.mission, who)) {
          this.remember(memory.missions, frame.mission.id);
          if (!("pausedDetail" in frame.mission)) return payload;
          const { pausedDetail: _detail, ...mission } = frame.mission;
          return { ...payload, mission };
        }
        return memory.missions.delete(frame.mission.id) ? { kind: "board.mission.deleted", id: frame.mission.id } : undefined;
      }
      case "board.mission.deleted":
        return memory.missions.delete(frame.id) ? payload : undefined;
    }
  }

  private of(viewerId: string | undefined): ViewerMemory {
    const viewerKey = viewerId?.trim().toLowerCase() ?? "";
    let memory = this.memory.get(viewerKey);
    if (!memory) {
      if (this.memory.size >= MAX_VIEWERS) this.memory.clear();
      memory = { tasks: new Set(), missions: new Set() };
      this.memory.set(viewerKey, memory);
    }
    return memory;
  }

  private remember<T>(set: Set<T>, value: T): void {
    if (set.size >= MAX_REMEMBERED) set.clear();
    set.add(value);
  }
}
