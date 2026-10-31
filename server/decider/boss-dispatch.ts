// A message to the Boss that is another bot's job: the decision model names that bot, and the Boss hands it over
// with its usual delegation (the result comes back to the same conversation) instead of doing it itself.
import type { Decider } from "./index.ts";
import { memberOption } from "./room-routing.ts";

export const BOSS_DISPATCH_TIMEOUT_MS = 1_500;
/** A wrong hand-off costs a round trip; below this the Boss answers as it would anyway. */
export const BOSS_DISPATCH_MIN_PROBABILITY = 0.7;
export const BOSS_OPTION = "__boss__";

export interface BossDispatchInput {
  boss: { name: string; title?: string; description?: string };
  team: Array<{ id: string; name: string; title?: string; description?: string }>;
  message: string;
}

export function bossDispatchRequest(input: BossDispatchInput) {
  const options: Record<string, string> = {
    [BOSS_OPTION]: `${memberOption({ id: BOSS_OPTION, ...input.boss })} Coordinates the team: decisions, plans, summaries, questions about the team, and anything that is not clearly one specialist's job.`,
  };
  for (const member of input.team) options[member.id] = memberOption(member);
  return {
    state: { boss: input.boss.name, team: input.team.map((member) => member.name), new_message: input.message.trim().slice(0, 8_000) },
    question: { instructions: "Whose job is `new_message`? Choose a specialist only when the message is clearly work in their role; otherwise the boss.", options },
  };
}

/** The teammate to hand the message to, or null to let the Boss answer. Never throws. */
export async function decideBossDispatch(
  decider: Pick<Decider, "choose">,
  input: BossDispatchInput,
  options: { signal?: AbortSignal } = {},
): Promise<{ botId: string; probability: number } | null> {
  try {
    if (!input.team.length || !input.message.trim()) return null;
    const { state, question } = bossDispatchRequest(input);
    const result = await decider.choose("bossDispatch", state, question, { timeoutMs: BOSS_DISPATCH_TIMEOUT_MS, signal: options.signal });
    if (!result.ok) return null;
    const { choice, pTop } = result.answers;
    if (choice === BOSS_OPTION || pTop < BOSS_DISPATCH_MIN_PROBABILITY) return null;
    return input.team.some((member) => member.id === choice) ? { botId: choice, probability: pTop } : null;
  } catch {
    return null;
  }
}
