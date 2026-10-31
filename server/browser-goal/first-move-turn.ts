import type { BotRecord, Store } from "../store.ts";
import type { BrowserRuntime, BrowserSpawnSpec, RunBrowserGoal } from "../browser-runtime.ts";
import { RelayTimeout, relayCommand, relayFrame } from "../browser-relay.ts";
import { TransportError } from "../browser-runtime.ts";
import { browserSteps, stepContext } from "../browser-steps.ts";
import { browseNote, needsResults, planBrowse } from "./first-move.ts";
import type { GoalLive } from "./live.ts";
import { textModelFromEnv } from "./model.ts";
import { BROWSER_GOAL_TOOL, runGoalTool, type GoalToolDeps } from "./tool.ts";

export { builtInBrowserBeside } from "./first-move.ts";

const FIRST_TRY_SECONDS = 30;
const FALLBACK_SECONDS = 15;

export interface RunGoalDeps {
  ready(): boolean;
  decider: GoalToolDeps["decider"];
  live: GoalLive;
}

export function createRunGoal({ ready, decider, live }: RunGoalDeps): RunBrowserGoal {
  return async ({ session, spec, goal, ctx, stopped, budgetMs, open }) => {
    if (!ready()) {
      return { isError: true, content: [{ type: "text", text: "The fast browser pilot needs the decision model (Jev) switched on in Settings. Use the regular browser tools." }] };
    }
    const relay = (command: Record<string, unknown>, timeoutMs: number) => relayCommand(spec, session, command, timeoutMs).catch((error: unknown) => {
      throw error instanceof RelayTimeout ? new TransportError(error.message) : error;
    });
    return runGoalTool({
      relay, frame: () => relayFrame(spec, session), decider, textModel: textModelFromEnv(), live,
      run: ctx ? { threadId: ctx.threadId, botId: ctx.botId, botName: ctx.botName } : null, stopped, budgetMs, ...(open ? { open, url: goal.url } : {}),
      note: (step) => browserSteps.note(ctx, { tool: `agent_browser_goal_${step.kind}`, action: step.text ? `${step.label}: ${step.text}` : step.label, ok: true }),
    }, goal);
  };
}

export interface BrowseFirstDeps {
  ready(): boolean;
  store: Pick<Store, "appendMessage" | "patchMessage">;
  runtime: Pick<BrowserRuntime, "agentRpc" | "heldBy">;
  turnId(threadId: string): string | null;
}

/** Starts the fast pilot on the person's message before the bot's model answers, so the browser moves within seconds;
 * the bot then gets the outcome with the message. Returns "" when the message is not a browsing request. */
export async function browseFirst(deps: BrowseFirstDeps, bot: BotRecord, turn: { threadId: string; generation: string }, browser: { session: string; spec: BrowserSpawnSpec }, message: string): Promise<string> {
  const model = textModelFromEnv();
  if (!model || !deps.ready()) return "";
  // Start the browser client now: planning the move takes seconds, and its first call would otherwise pay the cold start.
  void deps.runtime.agentRpc(browser.session, browser.spec, "tools/list", {}).catch(() => undefined);
  const plan = await planBrowse(model, message, new Date(), { timeoutMs: 4_000 }).catch(() => null);
  if (!plan) return "";
  const chip = deps.store.appendMessage(turn.threadId, { role: "bot", kind: "activity", tool: { name: BROWSER_GOAL_TOOL, input: JSON.stringify(plan) } });
  const ctx = stepContext(bot, turn, () => deps.turnId(turn.threadId));
  const attempt = async (args: { goal: string; url: string; seconds: number }) => {
    let result: unknown;
    try {
      result = await deps.runtime.agentRpc(browser.session, browser.spec, "tools/call", { name: BROWSER_GOAL_TOOL, arguments: args }, undefined, ctx);
    } catch (error) {
      result = { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
    const content = (result as { content?: { type?: string; text?: string }[] } | null)?.content ?? [];
    return { text: content.map((part) => part.type === "text" ? part.text ?? "" : "").join("\n"), failed: (result as { isError?: boolean } | null)?.isError === true };
  };
  let { text, failed } = await attempt({ goal: plan.goal, url: plan.url, seconds: FIRST_TRY_SECONDS });
  if (needsResults(plan, text) && !deps.runtime.heldBy(browser.session)) {
    ({ text, failed } = await attempt({ goal: plan.goal, url: plan.results, seconds: FALLBACK_SECONDS }));
  }
  if (chip?.tool) deps.store.patchMessage(turn.threadId, chip.id, { tool: { ...chip.tool, ok: !failed } });
  return browseNote(plan, text || "The pilot returned nothing.");
}
