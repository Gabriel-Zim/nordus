// What a browser goal is doing right now, per conversation, for the live card in the chat. Held in memory only: a
// bot's screenshots reach disk only through the step log the person switched on (recordBrowserSteps).
import type { GoalStatus, GoalStep } from "./run.ts";

export interface GoalLiveStep extends Omit<GoalStep, "atMs"> { at: number }

export interface GoalLiveRun {
  id: string;
  threadId: string;
  botId: string;
  botName: string;
  goal: string;
  startedAt: number;
  endedAt: number | null;
  status: GoalStatus | "running";
  url: string;
  title: string;
  steps: GoalLiveStep[];
  /** The page where the run ended, base64 JPEG. */
  frame: string | null;
  frameAt: number | null;
}

const KEEP_ENDED_MS = 30 * 60_000;
const MAX_RUNS_PER_THREAD = 20;
const MAX_STEPS = 120;

export class GoalLive {
  private runs = new Map<string, GoalLiveRun[]>();
  private now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  start(input: { id: string; threadId: string; botId: string; botName: string; goal: string }): GoalLiveRun {
    this.sweep();
    const run: GoalLiveRun = { ...input, startedAt: this.now(), endedAt: null, status: "running", url: "", title: "", steps: [], frame: null, frameAt: null };
    const list = [...(this.runs.get(input.threadId) ?? []), run].slice(-MAX_RUNS_PER_THREAD);
    this.runs.set(input.threadId, list);
    return run;
  }

  /** The run is live before the page loads: its first line is the site being opened. */
  opening(run: GoalLiveRun, url: string): void {
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./u, ""); } catch { return url; } })();
    run.url = url;
    run.steps = [...run.steps, { kind: "wait", label: `Abrindo ${host}`, url, title: "", at: this.now() }];
  }

  step(run: GoalLiveRun, step: GoalStep): void {
    const { atMs: _atMs, ...rest } = step;
    run.steps = [...run.steps, { ...rest, at: this.now() }].slice(-MAX_STEPS);
    if (step.url) run.url = step.url;
    run.title = step.title;
  }

  frame(run: GoalLiveRun, jpeg: string): void {
    run.frame = jpeg;
    run.frameAt = this.now();
  }

  end(run: GoalLiveRun, status: GoalStatus, page: { url: string; title: string }): void {
    run.status = status;
    run.endedAt = this.now();
    if (page.url) run.url = page.url;
    if (page.title) run.title = page.title;
  }

  /** The conversation's runs, newest last; frames only for the run asked by id, or the newest. */
  list(threadId: string, frameFor?: string): Array<Omit<GoalLiveRun, "frame"> & { frame?: string | null }> {
    this.sweep();
    const list = this.runs.get(threadId) ?? [];
    const pick = frameFor ?? list.at(-1)?.id;
    return list.map(({ frame, ...run }) => (run.id === pick ? { ...run, frame } : run));
  }

  forgetThread(threadId: string): void {
    this.runs.delete(threadId);
  }

  private sweep(): void {
    const cutoff = this.now() - KEEP_ENDED_MS;
    for (const [threadId, list] of this.runs) {
      const kept = list.filter((run) => run.endedAt === null || run.endedAt > cutoff);
      if (kept.length) this.runs.set(threadId, kept);
      else this.runs.delete(threadId);
    }
  }
}
