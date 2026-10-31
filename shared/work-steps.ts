import { isShellTool, runningCommand, type CommandKind } from "./command-words.ts";

// Nordus: the steps of the work a bot is doing right now, for the profile's "Agora", the sidebar and rooms.

export const WORK_STEP_TEXT_MAX = 120;
/** The longest step informar_etapa takes from a bot. */
export const WORK_STEP_TOOL_MAX = 160;
/** The longest text the harness takes for a step. */
export const WORK_STEP_INPUT_MAX = 1_000;

/** One step of the running turn. `text` is the bot's own sentence (informar_etapa); without it, `tool` is the tool it
 *  started, which the client says in words. Steps live only while the turn runs. */
export interface WorkStepLine {
  /** epoch ms the step began */
  at: number;
  text?: string;
  tool?: string;
  /** What a shell tool's command does, when it has words; the command itself never leaves the server. */
  command?: CommandKind;
  /** A shell step whose command runs now: epoch ms it began, counted from its approval. Absent while it waits or after it ends. */
  since?: number;
}

/** The steps with the shell step marked while its command runs, read from the conversation. */
export function withRunningCommand<T extends WorkStepLine>(steps: T[], path: Parameters<typeof runningCommand>[0]): T[] {
  const last = steps.at(-1);
  if (!last || last.text || !last.tool || !isShellTool(last.tool)) return steps;
  const running = runningCommand(path);
  return running ? [...steps.slice(0, -1), { ...last, since: running.since }] : steps;
}

/** The tools a bot uses to run itself (finding a tool, its own memory, its team list), lowercase: never a step of the work. */
export const INTERNAL_TOOLS: ReadonlySet<string> = new Set([
  "informar_etapa", "toolsearch", "tool_search", "find_tool", "think", "todowrite", "update_plan", "propose_lesson",
  "list_bots", "list_rooms", "list_room_targets", "list_threads", "list_team_setup", "list_routines", "list_shared_computers",
  "skills_list", "session_search", "session_read", "tool_result_read", "assignment_status", "memory_log", "memory_update",
  "ask_user", "askuserquestion", "create_options_card",
]);

export const WORK_PLAN_MAX_ITEMS = 12;
export const WORK_PLAN_ITEM_MIN = 3;
export const WORK_PLAN_ITEM_MAX = 80;
export const WORK_CREDITS_MAX = 100_000_000;
export const WORK_PLACES = ["servidor", "modal"] as const;
export type WorkPlace = (typeof WORK_PLACES)[number];

/** One step of a task's work by whoever did it: the leader, or a teammate working on what the leader's task sent it. */
export interface WorkJournalEntry {
  /** epoch ms the step began */
  at: number;
  /** epoch ms it ended: the same bot said its next step in that conversation, or its turn there ended; absent while it runs */
  end?: number;
  botId: string;
  name: string;
  text: string;
}

export const WORK_SHARED_FIELDS = ["percent", "credits", "creditCap", "where"] as const;
/** The fields a teammate may send too; the plan and the step come only from the task's leader. */
export type WorkSharedField = (typeof WORK_SHARED_FIELDS)[number];

/** The last value of each field sent with informar_etapa by the leader, or by a teammate for the shared ones. Shown only:
 *  it grants nothing. */
export interface WorkProgress {
  /** the steps planned for the whole task */
  plan?: string[];
  /** the item of `plan` running now, counting from 1 */
  step?: number;
  /** 0 to 100, present only while the last step sent a measured value */
  percent?: number;
  credits?: number;
  creditCap?: number;
  where?: WorkPlace;
  /** the teammate that sent each shared value, absent for the leader's own: a person who cannot see that teammate does not get the value */
  from?: Partial<Record<WorkSharedField, string>>;
  /** epoch ms of the last change */
  at: number;
}

/** A task's steps across turns and teammates while someone works on it, for its card in "Agora". The leader's first step
 *  with any field opens it, and again after it closed; a closed journal is not sent. */
export interface WorkJournal {
  entries: WorkJournalEntry[];
  progress: WorkProgress;
}

/** What informar_etapa may send besides the step itself. */
export type WorkFields = Partial<Pick<WorkProgress, "plan" | "step" | WorkSharedField>>;

const FIELD_PARAM: Record<keyof WorkFields, string> = {
  plan: "plano", step: "passo", percent: "progresso", credits: "creditos", creditCap: "teto_creditos", where: "onde",
};

const wholeIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** The extra fields of a step, checked against their limits. Absent fields stay absent; one out of its limits refuses all. */
export function parseWorkFields(input: Record<string, unknown>): { ok: true; fields: WorkFields } | { ok: false; error: string } {
  const fields: WorkFields = {};
  const refuse = (key: keyof WorkFields, rule: string) => ({ ok: false as const, error: `${FIELD_PARAM[key]} ${rule}` });
  if (input.plan !== undefined) {
    const plan = Array.isArray(input.plan) ? input.plan.map((item) => (typeof item === "string" ? item.replace(/\s+/g, " ").trim() : "")) : [];
    if (!plan.length || plan.length > WORK_PLAN_MAX_ITEMS || plan.some((item) => item.length < WORK_PLAN_ITEM_MIN || item.length > WORK_PLAN_ITEM_MAX)) {
      return refuse("plan", `takes 1 to ${WORK_PLAN_MAX_ITEMS} steps, each of ${WORK_PLAN_ITEM_MIN} to ${WORK_PLAN_ITEM_MAX} characters.`);
    }
    fields.plan = plan;
  }
  if (input.step !== undefined) {
    if (!wholeIn(input.step, 1, fields.plan?.length ?? WORK_PLAN_MAX_ITEMS)) return refuse("step", "is the number of the plan's step running now, counting from 1.");
    fields.step = input.step;
  }
  if (input.percent !== undefined) {
    if (typeof input.percent !== "number" || !(input.percent >= 0 && input.percent <= 100)) return refuse("percent", "is a measured 0 to 100.");
    fields.percent = Math.round(input.percent);
  }
  if (input.credits !== undefined) {
    if (!wholeIn(input.credits, 0, WORK_CREDITS_MAX)) return refuse("credits", "is a whole number of credits, 0 or more.");
    fields.credits = input.credits;
  }
  if (input.creditCap !== undefined) {
    if (!wholeIn(input.creditCap, 1, WORK_CREDITS_MAX)) return refuse("creditCap", "is a whole number of credits, 1 or more.");
    fields.creditCap = input.creditCap;
  }
  if (input.where !== undefined) {
    if (!WORK_PLACES.includes(input.where as WorkPlace)) return refuse("where", `is one of: ${WORK_PLACES.join(", ")}.`);
    fields.where = input.where as WorkPlace;
  }
  return { ok: true, fields };
}
