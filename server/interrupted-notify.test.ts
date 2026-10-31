import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Notification } from "./notify.ts";
import { checkInterruptedNotices, type InterruptedNotifierDeps } from "./interrupted-notify.ts";
import { CUT_TWICE } from "./runtime/tree.ts";
import type { CutTurn, FailedRoutineRun } from "./routes/interrupted-work.ts";

const NOW = 1_800_000_000_000;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "interrupted-notify-"));
  dirs.push(dir);
  const sent: Notification[] = [];
  const turns: CutTurn[] = [{ id: "old", botId: "ada", threadId: "t-old", detail: CUT_TWICE, at: NOW - 60_000, room: false }];
  const runs: FailedRoutineRun[] = [];
  const deps = (): InterruptedNotifierDeps => ({
    cutTurns: () => turns, doneFor: () => [], succeededAfter: () => false, routineRuns: () => runs,
    botName: () => "Ada", threadTitle: (_b, t) => `Conversa ${t}`,
    dismissedFile: join(dir, "dismissed.json"), notifiedFile: join(dir, "notified.json"), now: () => NOW,
    bot: (id) => (id === "ada" ? { id: "ada", name: "Ada", threadId: "home" } : undefined),
    notify: (n) => { if (n) sent.push(n); },
  });
  return { sent, turns, runs, deps };
}

describe("interrupted-work notices", () => {
  it("does not announce what already exists on the first load", () => {
    const { sent, deps } = setup();
    expect(checkInterruptedNotices(deps())).toBe(0);
    expect(sent).toEqual([]);
  });

  it("announces a new item once, even after the instance is recreated", () => {
    const { sent, turns, runs, deps } = setup();
    checkInterruptedNotices(deps());
    turns.push({ id: "new", botId: "ada", threadId: "t-new", detail: CUT_TWICE, at: NOW - 1_000, room: false });
    runs.push({ id: "r1", botId: "ada", routineName: "Bom dia", status: "failed", at: NOW - 500 });
    expect(checkInterruptedNotices(deps())).toBe(2);
    expect(checkInterruptedNotices(deps())).toBe(0);
    expect(checkInterruptedNotices(deps())).toBe(0);
    expect(sent).toHaveLength(2);
    const turn = sent.find((n) => n.threadId === "t-new")!;
    expect(turn.title).toBe("Ada");
    expect(turn.body).toContain("Conversa t-new");
    expect(turn.body).toContain("reiniciou duas vezes");
    const routine = sent.find((n) => n.kind === "routine-failed")!;
    expect(routine.title).toBe("Ada");
    expect(routine.body).toContain("A rotina falhou.");
    expect(routine.threadId).toBe("home");
  });
});
