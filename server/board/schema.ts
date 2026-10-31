import { z } from "zod";
import { BOARD_LIMITS, MISSION_FEED_KINDS, MISSION_STATUSES, TASK_STATUSES } from "../../shared/board.ts";
import type { BoardLink } from "../../shared/board.ts";
import { invalid } from "./errors.ts";

const id = z.string().regex(/^[\w-]+$/).max(200);
const email = z.string().max(320);

const actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), id: email, name: z.string().max(200).optional() }),
  z.object({ kind: z.literal("bot"), id: id, name: z.string().max(200).optional() }),
  z.object({ kind: z.literal("system"), name: z.string().max(200).optional() }),
]);

const link = z.object({ url: z.string().max(BOARD_LIMITS.linkUrl), label: z.string().max(BOARD_LIMITS.linkLabel).optional() });

const historyEntry = z.object({
  at: z.number(),
  by: actor,
  from: z.enum(TASK_STATUSES).optional(),
  to: z.enum(TASK_STATUSES).optional(),
  note: z.string().max(BOARD_LIMITS.note).optional(),
  event: z.enum(["created", "assigned", "unassigned", "edited", "sent"]).optional(),
  assignee: z.string().max(320).optional(),
});

export const storedTask = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(BOARD_LIMITS.title),
  description: z.string().max(BOARD_LIMITS.description).optional(),
  status: z.enum(TASK_STATUSES),
  assignee: z.string().min(1).max(320).optional(),
  createdBy: actor,
  createdAt: z.number(),
  updatedAt: z.number(),
  source: z.object({ threadId: id, groupId: id.optional(), messageId: z.string().max(200).optional() }).optional(),
  thread: z.object({ threadId: id, groupId: id.optional(), botId: id.optional() }).optional(),
  links: z.array(link).max(BOARD_LIMITS.links).optional(),
  missionId: id.optional(),
  history: z.array(historyEntry).max(BOARD_LIMITS.history + 1),
});

const inflight = z.object({
  kind: z.enum(["plan", "step", "answer", "close"]),
  taskId: z.number().int().optional(),
  sendId: z.string().max(80),
  at: z.number(),
  attempts: z.number().int().min(0),
});

const runnerState = z.object({
  inflight: inflight.optional(),
  answer: z.object({ botId: id, text: z.string().max(BOARD_LIMITS.runnerText) }).optional(),
  closing: z.boolean().optional(),
  daily: z.object({ day: z.string().max(10), turns: z.number().int().min(0) }).optional(),
  cause: z.enum(["spend", "bot-spend", "daily", "steps", "person"]).optional(),
});

const decision = z.object({
  question: z.string().max(BOARD_LIMITS.question),
  options: z.array(z.string().max(BOARD_LIMITS.option)).max(BOARD_LIMITS.options).optional(),
  askedAt: z.number(),
  askedBy: id,
  answer: z.string().max(BOARD_LIMITS.answer).optional(),
  answeredAt: z.number().optional(),
  answeredBy: actor.optional(),
});

export const storedMission = z.object({
  id,
  title: z.string().min(1).max(BOARD_LIMITS.missionTitle),
  goal: z.string().max(BOARD_LIMITS.missionGoal),
  createdBy: actor,
  createdAt: z.number(),
  status: z.enum(MISSION_STATUSES),
  leadBotId: id,
  teamBotIds: z.array(id).max(BOARD_LIMITS.missionTeam + 1),
  groupId: id,
  threadId: id,
  stepIds: z.array(z.number().int()).max(BOARD_LIMITS.missionSteps),
  feed: z.array(z.object({
    at: z.number(),
    author: actor,
    kind: z.enum(MISSION_FEED_KINDS),
    text: z.string().max(BOARD_LIMITS.description),
  })).max(BOARD_LIMITS.missionFeed),
  pendingDecision: decision.optional(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  pausedReason: z.string().max(500).optional(),
  pausedDetail: z.string().max(500).optional(),
  pausedBy: z.enum(["person", "system"]).optional(),
  runner: runnerState,
});

export type StoredMission = z.infer<typeof storedMission>;
export type RunnerState = z.infer<typeof runnerState>;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().max(max).optional();
const threadRef = z.string().regex(/^[\w-]+$/).max(200);

const linkInput = z.object({ url: z.string().trim().min(1).max(BOARD_LIMITS.linkUrl), label: z.string().trim().max(BOARD_LIMITS.linkLabel).optional() }).strict();

export const createTaskBody = z.object({
  title: text(BOARD_LIMITS.title),
  description: optionalText(BOARD_LIMITS.description),
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.string().trim().max(320).optional(),
  links: z.array(linkInput).max(BOARD_LIMITS.links).optional(),
  source: z.object({ threadId: threadRef, groupId: threadRef.optional(), messageId: z.string().max(200).optional() }).strict().optional(),
}).strict();

export const updateTaskBody = z.object({
  title: text(BOARD_LIMITS.title).optional(),
  description: optionalText(BOARD_LIMITS.description),
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.string().trim().max(320).nullable().optional(),
  links: z.array(linkInput).max(BOARD_LIMITS.links).optional(),
  note: z.string().trim().max(BOARD_LIMITS.note).optional(),
}).strict();

export const createMissionBody = z.object({
  title: text(BOARD_LIMITS.missionTitle),
  goal: text(BOARD_LIMITS.missionGoal),
  leadBotId: threadRef,
  teamBotIds: z.array(threadRef).max(BOARD_LIMITS.missionTeam).optional(),
}).strict();

export const answerBody = z.object({ answer: text(BOARD_LIMITS.answer) }).strict();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  const path = parsed.error.issues[0]?.path.join(".");
  throw invalid(path ? `${what}: confira o campo "${path}".` : `${what}: confira os dados enviados.`);
}

export function normalizeLinks(links: readonly BoardLink[] | undefined): BoardLink[] | undefined {
  if (!links?.length) return undefined;
  const seen = new Set<string>();
  const out: BoardLink[] = [];
  for (const entry of links) {
    let url: URL;
    try {
      url = new URL(entry.url.trim());
    } catch {
      throw invalid(`O link "${entry.url.slice(0, 60)}" não é um endereço válido.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw invalid("Só links http ou https são aceitos.");
    const href = url.toString();
    if (href.length > BOARD_LIMITS.linkUrl) throw invalid("Um dos links é longo demais para ser guardado.");
    if (seen.has(href)) continue;
    seen.add(href);
    const label = entry.label?.trim().slice(0, BOARD_LIMITS.linkLabel);
    out.push(label ? { url: href, label } : { url: href });
  }
  if (out.length > BOARD_LIMITS.links) throw invalid(`Um cartão guarda até ${BOARD_LIMITS.links} links.`);
  return out;
}
