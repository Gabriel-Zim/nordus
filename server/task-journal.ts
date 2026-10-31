import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import {
  parseWorkFields, WORK_PLACES, WORK_PLAN_ITEM_MAX, WORK_PLAN_MAX_ITEMS, WORK_SHARED_FIELDS, type WorkFields, type WorkJournal, type WorkJournalEntry,
  type WorkProgress,
} from "../shared/work-steps.ts";
import { writeFileAtomic } from "./atomic.ts";
import { cleanStepText, type StepText } from "./work-steps.ts";

const KEPT_ENTRIES = 200;
const KEPT_JOURNALS = 100;
const MAX_HOPS = 4;
const MAX_STORE_BYTES = 8 * 1024 * 1024;

/** A step from informar_etapa with its extra fields, ready for the journal; null when any of it is out of its limits. */
export function parseStepFields(body: unknown): WorkFields | null {
  const raw = body && typeof body === "object" && "fields" in body ? (body as { fields: unknown }).fields : undefined;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = parseWorkFields(raw as Record<string, unknown>);
  if (!parsed.ok) return null;
  if (!parsed.fields.plan) return parsed.fields;
  const plan = parsed.fields.plan.map((item) => cleanStepText(item, WORK_PLAN_ITEM_MAX));
  return plan.every(Boolean) ? { ...parsed.fields, plan: plan as StepText[] } : null;
}

type Opener = { botId: string; threadId?: string; roomLane?: true };
export interface ChainLookup {
  task(botId: string, threadId: string): { openedBy?: Opener } | undefined;
  section(botId: string): string | undefined;
}

/** The task a step belongs to: up the "opened by" chain to the leader's task, within the bot's own named team only. */
export function journalRoot(lookup: ChainLookup, botId: string, threadId: string): { botId: string; threadId: string } | null {
  let task = lookup.task(botId, threadId);
  if (!task) return null;
  const team = lookup.section(botId)?.trim();
  let root = { botId, threadId };
  const seen = new Set([threadId]);
  for (let hop = 0; team && hop < MAX_HOPS; hop++) {
    const opener = task.openedBy;
    if (!opener?.threadId || opener.roomLane || seen.has(opener.threadId) || opener.botId === root.botId ||
      lookup.section(opener.botId)?.trim() !== team) break;
    seen.add(opener.threadId);
    const parent = lookup.task(opener.botId, opener.threadId);
    if (!parent) break;
    root = { botId: opener.botId, threadId: opener.threadId };
    task = parent;
  }
  return root;
}

const entrySchema = z.object({
  at: z.number().int().nonnegative(),
  end: z.number().int().nonnegative().optional(),
  botId: z.string().min(1).max(128),
  threadId: z.string().min(1).max(128).optional(),
  name: z.string().max(254),
  text: z.string().max(1_000),
}).strict();
const botIdSchema = z.string().min(1).max(128);
const progressSchema = z.object({
  plan: z.array(z.string().max(WORK_PLAN_ITEM_MAX)).max(WORK_PLAN_MAX_ITEMS).optional(),
  step: z.number().int().positive().optional(),
  percent: z.number().min(0).max(100).optional(),
  credits: z.number().int().nonnegative().optional(),
  creditCap: z.number().int().positive().optional(),
  where: z.enum(WORK_PLACES).optional(),
  from: z.object({ percent: botIdSchema, credits: botIdSchema, creditCap: botIdSchema, where: botIdSchema }).partial().strict().optional(),
  at: z.number().int().nonnegative(),
}).strict();
const journalSchema = z.object({
  threadId: z.string().min(1).max(128),
  entries: z.array(entrySchema).max(KEPT_ENTRIES),
  progress: progressSchema,
  closedAt: z.number().int().nonnegative().optional(),
}).strict();
const storeSchema = z.object({ version: z.literal(1), journals: z.array(z.unknown()).max(KEPT_JOURNALS) }).strict();

/** A step with the conversation it ran in, so the end of that conversation's turn ends it wherever it was reported. */
type StoredEntry = WorkJournalEntry & { threadId?: string };
interface StoredJournal {
  entries: StoredEntry[];
  progress: WorkProgress;
  closedAt?: number;
}

const hasProgress = (fields: WorkFields) => Object.values(fields).some((value) => value !== undefined);

/** The progress without its measured percent, which only the step that sent it carries. */
function withoutPercent(progress: WorkProgress): WorkProgress {
  const { percent: _percent, from, ...rest } = progress;
  const { percent: _sender, ...senders } = from ?? {};
  return { ...rest, ...(Object.keys(senders).length ? { from: senders } : {}) };
}

function withFields(progress: WorkProgress, fields: WorkFields, teammate: string | undefined, at: number): WorkProgress {
  const base = withoutPercent(progress);
  const from = { ...base.from };
  for (const key of WORK_SHARED_FIELDS) {
    if (fields[key] === undefined) continue;
    if (teammate) from[key] = teammate;
    else delete from[key];
  }
  const { from: _from, ...rest } = base;
  return { ...rest, ...fields, ...(Object.keys(from).length ? { from } : {}), at };
}

/** Each task's steps across turns and teammates, kept on disk so a long job reads the same after a restart. */
export class TaskJournals {
  private readonly journals = new Map<string, StoredJournal>();
  private readonly filename?: string;

  constructor(filename?: string) {
    this.filename = filename;
    if (filename) this.load(filename);
  }

  /** A bot of the task's chain said the step it starts now. Only the leader opens a journal, or reopens a closed one,
   *  with any field, and only the leader sets the plan and the step: a teammate adds its steps, credits, place and progress. */
  report(root: { botId: string; threadId: string }, by: { botId: string; threadId: string; name: string }, text: StepText, fields: WorkFields, at = Date.now()): boolean {
    const leader = by.botId === root.botId;
    let journal = this.journals.get(root.threadId);
    const { plan, step, ...shared } = fields;
    if ((!journal || journal.closedAt !== undefined) && !(leader && hasProgress(fields))) return false;
    if (!journal || (leader && plan && step === 1)) journal = { entries: [], progress: { at } };
    delete journal.closedAt;
    const running = journal.entries.findLast((entry) => entry.botId === by.botId && entry.threadId === by.threadId && entry.end === undefined);
    if (running?.text !== text) {
      if (running) running.end = at;
      journal.entries.push({ at, botId: by.botId, name: by.name, text, threadId: by.threadId });
      if (journal.entries.length > KEPT_ENTRIES) journal.entries.splice(0, journal.entries.length - KEPT_ENTRIES);
    }
    journal.progress = withFields(journal.progress, leader ? fields : shared, leader ? undefined : by.botId, at);
    this.touch(root.threadId, journal);
    return true;
  }

  /** The bot's turn in that conversation is over, however it ended: its steps there stop in every journal. Returns those journals. */
  stopped(botId: string, threadId: string, at = Date.now()): string[] {
    const changed: string[] = [];
    for (const [rootThreadId, journal] of this.journals) {
      const running = journal.entries.filter((entry) => entry.botId === botId && entry.threadId === threadId && entry.end === undefined);
      for (const entry of running) entry.end = at;
      if (running.length) changed.push(rootThreadId);
    }
    if (changed.length) this.save();
    return changed;
  }

  /** Nobody works on the task now: its card leaves "Agora" until the leader's next step with a field. A step whose
   *  conversation is no longer busy stopped without its turn's end, and ends now. */
  close(rootThreadId: string, busy: (botId: string, threadId: string) => boolean, at = Date.now()): boolean {
    const journal = this.journals.get(rootThreadId);
    if (!journal || journal.closedAt !== undefined) return false;
    const running = journal.entries.filter((entry) => entry.end === undefined);
    if (running.some((entry) => entry.threadId !== undefined && busy(entry.botId, entry.threadId))) return false;
    for (const entry of running) entry.end = at;
    journal.progress = { ...withoutPercent(journal.progress), at };
    journal.closedAt = at;
    this.touch(rootThreadId, journal);
    return true;
  }

  forget(rootThreadId: string): boolean {
    if (!this.journals.delete(rootThreadId)) return false;
    this.save();
    return true;
  }

  /** The journal while someone works on the task; nothing once it closed. */
  forThread(threadId: string): WorkJournal | undefined {
    const journal = this.journals.get(threadId);
    if (!journal || journal.closedAt !== undefined) return undefined;
    return { entries: journal.entries.map(({ threadId: _thread, ...entry }) => entry), progress: structuredClone(journal.progress) };
  }

  private touch(threadId: string, journal: StoredJournal): void {
    this.journals.delete(threadId);
    this.journals.set(threadId, journal);
    while (this.journals.size > KEPT_JOURNALS) this.journals.delete(this.journals.keys().next().value!);
    this.save();
  }

  private load(filename: string): void {
    try {
      const stat = lstatSync(filename);
      if (!stat.isFile() || stat.size > MAX_STORE_BYTES) throw new Error("Invalid task journal store.");
      const saved = storeSchema.parse(JSON.parse(readFileSync(filename, "utf8")));
      for (const row of saved.journals) {
        const parsed = journalSchema.safeParse(row);
        if (!parsed.success) continue;
        const { threadId, entries, progress, closedAt } = parsed.data;
        // Nothing that ran when the server stopped survived it: its step ends, and its task closes, at the journal's last change.
        const stoppedAt = entries.some((entry) => entry.end === undefined) ? Math.max(progress.at, ...entries.map((entry) => entry.at)) : undefined;
        const ended = entries.map((entry) => (entry.end === undefined ? { ...entry, end: stoppedAt! } : entry));
        const closed = closedAt ?? stoppedAt;
        this.journals.set(threadId, { entries: ended, progress: progress as WorkProgress, ...(closed !== undefined ? { closedAt: closed } : {}) });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("[task-journal] Could not read the task journals; starting without them.");
    }
  }

  private save(): void {
    if (!this.filename) return;
    try {
      mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 });
      const journals = [...this.journals].map(([threadId, journal]) => ({ threadId, ...journal }));
      writeFileAtomic(this.filename, JSON.stringify({ version: 1, journals }), { mode: 0o600 });
    } catch {
      console.error("[task-journal] Could not save the task journals; they hold until a restart.");
    }
  }
}
