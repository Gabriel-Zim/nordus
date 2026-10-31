import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import { approvalRisk } from "../shared/approvals.ts";
import type { CardAnswerer, OptionCardData } from "../shared/wire.ts";
import { writeFileAtomic } from "./atomic.ts";
import type { RequestOutcome } from "./contracts.ts";

/** The person's "Permitir tudo nesta tarefa": every approval request in one bot's task is answered for them. */
export interface TaskRelease {
  botId: string;
  threadId: string;
  /** epoch ms the person released the task */
  at: number;
  /** epoch ms of the task's last activity under the release (starts equal to `at`) */
  usedAt: number;
  /** who released it, for the decision log and the banner tooltip: the answering person's name, or "owner" on loopback */
  by: string;
  answerer?: CardAnswerer;
}

export const TASK_RELEASE_IDLE_MS = 4 * 60 * 60_000;
export const TASK_RELEASE_SWEEP_MS = 10 * 60_000;
const TOUCH_PERSIST_MS = 60_000;
const MAX_RELEASES = 500;
const MAX_STORE_BYTES = 1024 * 1024;
const ID = /^[\w-]{1,128}$/;
const MAX_NAME_LENGTH = 254;

export interface ReleasedTask {
  archivedAt?: number;
  closedBy?: unknown;
}

export function releaseEnded(release: Pick<TaskRelease, "at" | "usedAt">, task: ReleasedTask | undefined, now: number): boolean {
  if (!task || task.archivedAt !== undefined || task.closedBy) return true;
  return now - Math.max(release.at, release.usedAt) > TASK_RELEASE_IDLE_MS;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stamp = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const via = z.literal("call").optional();
const answererSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), name: z.string().min(1).max(MAX_NAME_LENGTH), person: z.string().min(1).max(MAX_NAME_LENGTH).optional(), via }).strict(),
  z.object({ kind: z.literal("loopback"), via }).strict(),
  z.object({ kind: z.literal("worker"), via }).strict(),
]);

function validRelease(row: unknown): TaskRelease {
  if (!record(row) || Object.keys(row).some((key) => !["botId", "threadId", "at", "usedAt", "by", "answerer"].includes(key)) ||
    typeof row.botId !== "string" || !ID.test(row.botId) || typeof row.threadId !== "string" || !ID.test(row.threadId) ||
    !stamp(row.at) || !stamp(row.usedAt) || typeof row.by !== "string" || !row.by || row.by.length > MAX_NAME_LENGTH) {
    throw new Error("Invalid task release store.");
  }
  return {
    botId: row.botId, threadId: row.threadId, at: row.at, usedAt: row.usedAt, by: row.by,
    ...(row.answerer === undefined ? {} : { answerer: answererSchema.parse(row.answerer) }),
  };
}

type TaskLookup = (botId: string, threadId: string) => ReleasedTask | undefined;

/** Installation-local grants, apart from bot profiles and templates; callers must also keep this file out of workspace backups. */
export class TaskReleaseStore {
  private releases: TaskRelease[] = [];
  private unreadable = false;
  private readonly filename: string;
  private readonly taskByThread: TaskLookup;

  constructor(filename: string, taskByThread: TaskLookup) {
    this.filename = filename;
    this.taskByThread = taskByThread;
    try {
      const stat = lstatSync(filename);
      if (!stat.isFile() || stat.size > MAX_STORE_BYTES) throw new Error("Invalid task release store.");
      const saved: unknown = JSON.parse(readFileSync(filename, "utf8"));
      if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.releases) ||
        Object.keys(saved).some((key) => key !== "version" && key !== "releases")) throw new Error("Invalid task release store.");
      const releases = saved.releases.map(validRelease);
      if (new Set(releases.map((release) => release.threadId)).size !== releases.length) throw new Error("Invalid task release store.");
      this.releases = releases;
    } catch (error) {
      // Missing means no release; any other failure disables every release and forbids overwriting a damaged store.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.unreadable = true;
    }
  }

  active(botId: string, threadId: string, now = Date.now()): TaskRelease | undefined {
    const release = this.forThread(threadId, now);
    return release?.botId === botId ? release : undefined;
  }

  forThread(threadId: string, now = Date.now()): TaskRelease | undefined {
    if (this.unreadable) return undefined;
    const release = this.releases.find((candidate) => candidate.threadId === threadId);
    if (!release) return undefined;
    if (!releaseEnded(release, this.taskByThread(release.botId, release.threadId), now)) return release;
    this.saveQuietly(this.releases.filter((candidate) => candidate !== release));
    return undefined;
  }

  grant(botId: string, threadId: string, answerer: CardAnswerer, now = Date.now()): TaskRelease {
    this.assertWritable();
    const by = answerer.kind === "session" ? answerer.name : "owner";
    const release = validRelease({ botId, threadId, at: now, usedAt: now, by: by.slice(0, MAX_NAME_LENGTH), answerer });
    const kept = this.releases.filter((candidate) => candidate.threadId !== threadId);
    kept.sort((left, right) => left.at - right.at);
    this.save([...kept.slice(Math.max(0, kept.length + 1 - MAX_RELEASES)), release]);
    return release;
  }

  touch(threadId: string, now = Date.now()): void {
    const release = this.forThread(threadId, now);
    if (!release || now - release.usedAt < TOUCH_PERSIST_MS) return;
    this.saveQuietly(this.releases.map((candidate) => candidate === release ? { ...candidate, usedAt: now } : candidate));
  }

  revoke(botId: string, threadId: string): boolean {
    if (this.unreadable) return false;
    const next = this.releases.filter((candidate) => candidate.botId !== botId || candidate.threadId !== threadId);
    if (next.length === this.releases.length) return false;
    this.save(next);
    return true;
  }

  dropThread(threadId: string): void {
    if (this.unreadable) return;
    const next = this.releases.filter((candidate) => candidate.threadId !== threadId);
    if (next.length !== this.releases.length) this.saveQuietly(next);
  }

  sweep(now = Date.now()): TaskRelease[] {
    if (this.unreadable) return [];
    const ended = this.releases.filter((release) => releaseEnded(release, this.taskByThread(release.botId, release.threadId), now));
    if (ended.length) this.saveQuietly(this.releases.filter((release) => !ended.includes(release)));
    return ended;
  }

  private assertWritable(): void {
    if (this.unreadable) throw Object.assign(new Error("Saved task releases could not be read. Repair the release store before changing them."), { status: 503 });
  }

  private save(releases: TaskRelease[]): void {
    mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.filename, JSON.stringify({ version: 1, releases }, null, 2), { mode: 0o600 });
    this.releases = releases;
  }

  private saveQuietly(releases: TaskRelease[]): void {
    try {
      this.save(releases);
    } catch {
      this.releases = releases;
      console.error("[task-release] Could not save the task releases; the change holds until a restart.");
    }
  }
}

/** A critical action is approved by holding the button on its own card: releasing the task from it would approve it, and every action after it, with one click. */
export function releasableCard(card: OptionCardData | undefined): card is OptionCardData & { requestId: string; canReleaseTask: true } {
  return Boolean(card && card.requestId && card.canReleaseTask && !card.answered && !card.dismissed && !card.expired && approvalRisk(card) !== "critical");
}

export interface ReleaseFromCardDeps {
  messagesFor(threadId: string): Array<{ id: string; card?: OptionCardData }>;
  botByThread(threadId: string): { id: string } | undefined;
  patchCard(threadId: string, messageId: string, fields: Pick<OptionCardData, "releasedTask" | "answeredBy">): void;
  floorBlocks(card: OptionCardData): boolean;
  releases: Pick<TaskReleaseStore, "grant">;
  answerAllow(threadId: string, requestId: string, rule?: "task-release"): Promise<RequestOutcome>;
  broadcastBot(botId: string): void;
}

const releasing = new Set<string>();

export async function releaseTaskFromCard(
  deps: ReleaseFromCardDeps,
  input: { threadId: string; requestId: string; answerer: CardAnswerer },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { threadId, requestId, answerer } = input;
  const bot = deps.botByThread(threadId);
  if (!bot) return { status: 404, body: { error: "The chat is gone." } };
  if (releasing.has(threadId)) return { status: 200, body: { ok: true, released: true, answered: 0 } };
  releasing.add(threadId);
  try {
    const cardOf = (messageId: string) => deps.messagesFor(threadId).find((message) => message.id === messageId)?.card;
    const clicked = deps.messagesFor(threadId).find((message) => message.card?.requestId === requestId)?.card;
    if (!releasableCard(clicked)) return { status: 409, body: { error: "This request can no longer release the task. Answer it on its own." } };
    deps.releases.grant(bot.id, threadId, answerer);
    const outcome = await deps.answerAllow(threadId, requestId);
    let answered = 1;
    for (const messageId of deps.messagesFor(threadId).map((message) => message.id)) {
      const card = cardOf(messageId);
      if (!releasableCard(card) || card.requestId === requestId || deps.floorBlocks(card)) continue;
      deps.patchCard(threadId, messageId, { releasedTask: true });
      await deps.answerAllow(threadId, card.requestId, "task-release");
      const settled = cardOf(messageId)?.answered;
      if (settled && settled !== "unavailable") deps.patchCard(threadId, messageId, { answeredBy: answerer });
      answered += 1;
    }
    deps.broadcastBot(bot.id);
    return { status: 200, body: { ok: true, released: true, answered, outcome } };
  } finally {
    releasing.delete(threadId);
  }
}
