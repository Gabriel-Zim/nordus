import { commandKind, commandText, isShellTool } from "../shared/command-words.ts";
import { INTERNAL_TOOLS, WORK_STEP_INPUT_MAX, WORK_STEP_TEXT_MAX, type WorkStepLine } from "../shared/work-steps.ts";

const KEPT_STEPS = 40;
/** Control and format characters (direction overrides, zero widths) hide or reorder text; the emoji joiner stays. */
const INVISIBLE = /(?![\s‍])[\p{Cc}\p{Cf}]/gu;

export type StepText = string & { readonly __stepText: unique symbol };

export function bareToolName(name: string): string {
  return name.replace(/^Running /, "").replace(/^mcp__.+?__(?=.)/, "").split(":", 1)[0]!.trim();
}

function withoutTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && ".,;: ".includes(text[end - 1]!)) end -= 1;
  return text.slice(0, end);
}

/** One line in the bot's own words: no line breaks, no markdown, no em dash, cut at a word. */
export function cleanStepText(text: unknown, max = WORK_STEP_TEXT_MAX): StepText | null {
  if (typeof text !== "string" || text.length > WORK_STEP_INPUT_MAX) return null;
  const flat = withoutTrailingPunctuation(
    text.replace(INVISIBLE, "").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").replace(/ ?[—–] ?/g, ", ").trim(),
  );
  if (flat.length < 3) return null;
  const cut = flat.length > max ? `${flat.slice(0, max).replace(/\s+\S*$/, "")}…` : flat;
  return `${cut[0]!.toLocaleUpperCase("pt-BR")}${cut.slice(1)}` as StepText;
}

type Work = { botId: string; steps: WorkStepLine[] };

/** What each running turn is doing, step by step, keyed by thread. Lives only while the turn runs. */
export class WorkSteps {
  private readonly work = new Map<string, Work>();

  /** The bot said what it is starting now. Returns whether the steps changed. */
  declare(botId: string, threadId: string, step: StepText, at = Date.now()): boolean {
    const work = this.of(botId, threadId);
    if (work.steps.at(-1)?.text === step) return false;
    this.push(work, { at, text: step });
    return true;
  }

  /** A tool started. It becomes the step only while the bot has not said any step of its own on this turn. */
  tool(botId: string, threadId: string, name: string, at = Date.now(), call: { summary?: string; input?: string } = {}): boolean {
    const bare = bareToolName(name);
    if (!bare || /\s/.test(bare) || INTERNAL_TOOLS.has(bare.toLowerCase())) return false;
    const work = this.of(botId, threadId);
    if (work.steps.some((step) => step.text)) return false;
    const tool = name.startsWith("mcp__") ? name.replace(/^Running /, "") : bare;
    const shell = isShellTool(name) ? commandText(call) : undefined;
    const command = shell ? commandKind(shell) ?? undefined : undefined;
    const last = work.steps.at(-1);
    if (last?.tool === tool && last.command === command) return false;
    this.push(work, command ? { at, tool, command } : { at, tool });
    return true;
  }

  clear(threadId: string): Work | null {
    const work = this.work.get(threadId);
    if (!work) return null;
    this.work.delete(threadId);
    return work;
  }

  /** The thread's steps, oldest first; empty when nothing runs there or, given a bot, when they are another bot's. */
  forThread(threadId: string, botId?: string): WorkStepLine[] {
    const work = this.work.get(threadId);
    if (!work || (botId && work.botId !== botId)) return [];
    return work.steps.map((step) => ({ ...step }));
  }

  private of(botId: string, threadId: string): Work {
    const current = this.work.get(threadId);
    if (current && current.botId === botId) return current;
    const fresh = { botId, steps: [] };
    this.work.set(threadId, fresh);
    return fresh;
  }

  private push(work: Work, step: WorkStepLine): void {
    work.steps.push(step);
    if (work.steps.length > KEPT_STEPS) work.steps.splice(0, work.steps.length - KEPT_STEPS);
  }
}

/** Runs `run` once per thread, `ms` after the first `schedule` of a burst. */
export function perThreadLater(ms: number, run: (threadId: string) => void) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    schedule(threadId: string): void {
      if (pending.has(threadId)) return;
      pending.set(threadId, setTimeout(() => {
        pending.delete(threadId);
        run(threadId);
      }, ms));
    },
    cancel(threadId: string): void {
      clearTimeout(pending.get(threadId));
      pending.delete(threadId);
    },
  };
}
