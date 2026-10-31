// Nordus: the work a bot's teammates do on what it sent them, read from the bots on the wire. A team is a named section:
// bots without one are not a team here, whatever the server lets them reach, and another team's bot is never part of it.
import type { WorkStepLine } from "./work-steps.ts";

export interface TeamTask {
  threadId: string;
  title?: string;
  busy?: boolean;
  activity?: string;
  doing?: string;
  steps?: WorkStepLine[];
  turnStartedAt?: number | null;
  openedBy?: { botId: string; threadId?: string; kind?: string };
}

export interface TeamBot {
  id: string;
  name: string;
  section?: string;
  threadId: string;
  tasks?: readonly TeamTask[];
}

/** A teammate working on a request that started in the owner's conversation, with its plain line once written. */
export interface TeammateWork {
  botId: string;
  name: string;
  threadId: string;
  title?: string;
  doing?: string;
  steps?: WorkStepLine[];
  startedAt?: number;
}

const MAX_HOPS = 4;

export function sameTeam(a: Pick<TeamBot, "section">, b: Pick<TeamBot, "section">): boolean {
  const team = a.section?.trim();
  return Boolean(team) && team === b.section?.trim();
}

const working = (task: TeamTask) => task.activity !== "waiting-on-you" && (task.activity === "working" || Boolean(task.busy));

const UNTITLED = new Set(["Nova conversa", "New task", "New thread"]);

/** "Evergreen Capital · Carrossel Dólar": where a bot works, by a title a person or the task's own retitle gave. A conversation
 *  another bot opened is where it came from; the server's own labels ("@DESIGNERGRAFICO · work", "Nova conversa") are no place. */
export function taskPlace(task: Pick<TeamTask, "title" | "openedBy">, bots: readonly Pick<TeamBot, "id" | "tasks">[] = []): string | undefined {
  const opener = task.openedBy;
  const origin = opener?.threadId ? bots.find((bot) => bot.id === opener.botId)?.tasks?.find((entry) => entry.threadId === opener.threadId) : undefined;
  if (origin) return taskPlace({ title: origin.title });
  if (opener?.kind === "work") return undefined;
  const title = task.title?.replace(/[\s·]+$/u, "").trim();
  return title && !title.startsWith("@") && !UNTITLED.has(title) ? title : undefined;
}

/** What a bot does in one of its conversations, or null when that conversation is not working. */
export function workIn(bot: Pick<TeamBot, "id" | "name">, task: TeamTask, bots: readonly TeamBot[] = []): TeammateWork | null {
  if (!working(task)) return null;
  const startedAt = task.turnStartedAt;
  const title = taskPlace(task, bots);
  return {
    botId: bot.id, name: bot.name, threadId: task.threadId,
    ...(title ? { title } : {}),
    ...(task.doing ? { doing: task.doing } : {}),
    ...(task.steps?.length ? { steps: task.steps } : {}),
    ...(startedAt ? { startedAt } : {}),
  };
}

/** Down the chain of teammates the owner's conversation sent work to, within its team only. */
export function teammateWork(owner: TeamBot, bots: readonly TeamBot[]): TeammateWork[] {
  const team = bots.filter((bot) => bot.id !== owner.id && sameTeam(owner, bot));
  const found: TeammateWork[] = [];
  const seen = new Set<string>([owner.threadId]);
  let senders = [{ botId: owner.id, threadId: owner.threadId }];
  for (let hop = 0; hop < MAX_HOPS && senders.length; hop++) {
    const next: typeof senders = [];
    for (const bot of team) {
      for (const task of bot.tasks ?? []) {
        const opener = task.openedBy;
        if (!opener || seen.has(task.threadId)) continue;
        if (!senders.some((sender) => sender.botId === opener.botId && opener.threadId === sender.threadId)) continue;
        seen.add(task.threadId);
        next.push({ botId: bot.id, threadId: task.threadId });
        const work = workIn(bot, task);
        if (work) found.push(work);
      }
    }
    senders = next;
  }
  return found;
}

// No colon or dash: a question ("needs your input: …") or a failure ("— failed: …") can end in any words.
const HANDOFF_PILL = /^(?:Sent to [^:—]+|[^:—]+ replied(?: · [^:—]+)?|[^:—]+ was cut off by a restart; resuming)$/;

/** The sending and replying between teammates: what a person talking only to the owner does not need to see. */
export function isTeamHandoff(
  message: { kind?: string; tool?: { name: string }; threadRef?: { botId: string } },
  owner: Pick<TeamBot, "id" | "section">,
  bots: readonly Pick<TeamBot, "id" | "section">[],
): boolean {
  const ref = message.threadRef;
  if (message.kind !== "activity" || !ref || ref.botId === owner.id || !message.tool || !HANDOFF_PILL.test(message.tool.name)) return false;
  const teammate = bots.find((bot) => bot.id === ref.botId);
  return Boolean(teammate) && sameTeam(owner, teammate!);
}
