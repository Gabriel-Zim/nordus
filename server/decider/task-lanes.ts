// Nordus: a message for a bot already working in that conversation once went through the decision model (join the
// running turn, wait in line, or a parallel line in a new conversation). The server no longer asks: the message joins
// the running turn, like Grok. The decision stays here for a later opt-in; laneResult still words a start_thread
// answer brought home. Never throws.
import type { Decider } from "./index.ts";

export type LaneChoice = "continue" | "queue" | "parallel";
export const TASK_LANES_TIMEOUT_MS = 1_200;
export const TASK_LANES_MIN_PROBABILITY = 0.6;
/** Parallel lines one bot may have running at once. */
export const MAX_PARALLEL_LANES = 3;

export const TASK_LANES_INSTRUCTIONS = "The bot is busy working on `current_work` when `new_message` arrives in the same conversation. continue: it adds to or corrects the current work. queue: it is about the same subject but should wait for the current work to finish. parallel: a separate, independent task that can be done on its own right now, in a new conversation.";
const OPTIONS: Record<LaneChoice, string> = {
  continue: "Continue: the message adds to, changes or corrects the work already running.",
  queue: "Queue: same subject, but it needs the current work finished first.",
  parallel: "Parallel: an independent task on another subject, done right away in a new conversation.",
};

const clip = (value: string | undefined, max: number) => {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export async function decideTaskLane(
  decider: Pick<Decider, "choose">,
  input: { bot: string; currentWork: string; recent?: string; message: string },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ choice: LaneChoice; probability: number } | null> {
  try {
    if (!input.message.trim()) return null;
    const state = {
      bot: clip(input.bot, 80),
      current_work: clip(input.currentWork, 1_500),
      ...(input.recent?.trim() ? { latest_bot_update: clip(input.recent, 600) } : {}),
      new_message: input.message.trim().slice(0, 4_000),
    };
    const result = await decider.choose("taskLanes", state, { instructions: TASK_LANES_INSTRUCTIONS, options: OPTIONS }, {
      timeoutMs: options.timeoutMs ?? TASK_LANES_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!result.ok || result.answers.pTop < TASK_LANES_MIN_PROBABILITY) return null;
    return { choice: result.answers.choice, probability: result.answers.pTop };
  } catch {
    return null;
  }
}

type LaneRow = { role: string; kind: string; at: number; text?: string; quickAck?: boolean };

/** What the bot is busy with: the person's last ask, and the bot's latest line after it (a quick note is not one). */
export function laneWork(path: readonly LaneRow[]): { ask?: string; update?: string } {
  const ask = path.findLast((m) => m.role === "user" && m.kind === "text" && m.text);
  const update = path.findLast((m) => m.role === "bot" && m.kind === "text" && m.text && !m.quickAck && (!ask || m.at > ask.at));
  return { ask: ask?.text, update: update?.text };
}

/** A short title for the parallel conversation, from the message itself. */
export function laneTitle(message: string): string {
  return clip(message.replace(/<[^>]+>/g, " "), 60) || "Tarefa paralela";
}

/** The one message that brings the parallel answer home. The line ran out of sight, so it never points the person there. */
export function laneResult(title: string, answer: string | undefined): string {
  const body = answer?.trim();
  return body ? `Sobre "${title}":\n\n${body}` : `Terminei "${title}", mas não tenho uma resposta em texto para trazer.`;
}
