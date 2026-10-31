import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { isShellTool, lowerGerund } from "../../shared/command-words";
import { commandPhrase } from "./command-presence";
import type { WorkJournal, WorkJournalEntry, WorkPlace, WorkStepLine } from "../../shared/work-steps";

/** A step as the person reads it: the time it began, and what the bot is doing in plain words. */
export type StepLine = { at: number; label: string };

type Bare = { server: string | null; tool: string };

function splitTool(name: string): Bare {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return { server: mcp[1]!.toLowerCase(), tool: mcp[2]!.toLowerCase() };
  const composio = /^([A-Z][A-Z0-9]+)_[A-Z0-9_]+$/.exec(name);
  if (composio) return { server: composio[1]!.toLowerCase(), tool: name.toLowerCase() };
  return { server: null, tool: name.toLowerCase() };
}

/** The apps a person knows by name. An MCP server named anything else (an id, an internal name) is never shown. */
const APP_NAMES: Record<string, string> = {
  figma: "Figma", canva: "Canva", notion: "Notion", gmail: "Gmail", googledrive: "Google Drive", google_drive: "Google Drive",
  "google-drive": "Google Drive", drive: "Google Drive", googlecalendar: "Google Agenda", googlesheets: "Google Sheets",
  googledocs: "Google Docs", slack: "Slack", trello: "Trello", asana: "Asana", heygen: "HeyGen", elevenlabs: "ElevenLabs",
  zim: "Zim Studio", "zim-studio": "Zim Studio", behance: "Behance", pinterest: "Pinterest", instagram: "Instagram",
  github: "GitHub", "epidemic-sound": "Epidemic Sound", frameio: "Frame.io", dropbox: "Dropbox", airtable: "Airtable",
  hubspot: "HubSpot", linear: "Linear", whatsapp: "WhatsApp",
};

const BY_TOOL: Array<[RegExp, LocaleKey]> = [
  [/(?:^|_)(?:edit|editar)_?(?:image|imagem)|inpaint|outpaint|remove_background|upscale_image/, "workStep.editImage"],
  [/(?:generate|gerar|create)_?(?:image|imagem)|image_generation|text_to_image|nano_banana/, "workStep.image"],
  [/(?:edit|editar)_?(?:video|v[ií]deo)/, "workStep.editVideo"],
  [/(?:generate|gerar|create)_?(?:video|v[ií]deo)|text_to_video|image_to_video/, "workStep.video"],
  [/(?:generate|gerar|create)_?(?:audio|[áa]udio|speech|voice)|text_to_speech/, "workStep.audio"],
  [/gerar_peca|marketing/, "workStep.piece"],
  [/ficha|conhecimento|ler_documento|buscar_contexto|brand|regras/, "workStep.brief"],
  [/^(?:bash|shell|terminal|exec|execute|run_command|computer_exec|vm_exec)$/, "workStep.command"],
  [/^(?:read|read_file|view|open_file|notebookread)$/, "workStep.readFile"],
  [/^(?:write|write_file|create_file)$/, "workStep.writeFile"],
  [/^(?:edit|multiedit|str_replace|apply_patch|notebookedit|replace)$/, "workStep.editFile"],
  [/^(?:grep|glob|find|search|ls)$/, "workStep.searchFiles"],
  [/web_?search|search_web|google_search/, "workStep.searchWeb"],
  [/web_?fetch|fetch_url|read_page|^fetch$|get_page_text/, "workStep.readPage"],
  [/(?:^|_)browser_|navigate|open_url|^tabs_/, "workStep.browser"],
  [/screenshot|screen_capture|zoom/, "workStep.screen"],
  [/^(?:computer|click|type_text|press_key|scroll|computer_batch|left_click)$/, "workStep.computer"],
  [/coordinate_bots|delegate_bot|ask_bot|start_thread/, "workStep.handoff"],
  [/post_to_room|send_message/, "workStep.room"],
  [/attach_file/, "workStep.attach"],
  [/send_voice_note/, "workStep.voiceNote"],
  [/^(?:task|agent)$/, "workStep.helper"],
];

const FIGMA_EXPORT = /export|download|screenshot|asset|image/;
const REFERENCE_SITES: Record<string, string> = { behance: "Behance", pinterest: "Pinterest", dribbble: "Dribbble" };

/** A tool, in a person's words: "Gerando imagem", "Exportando do Figma". Never the tool's own name, a path or a command. */
export function toolStepPhrase(name: string): string {
  const { server, tool } = splitTool(name.replace(/^Running /, "").split(":", 1)[0]!.trim());
  if (server === "figma") return t(FIGMA_EXPORT.test(tool) ? "workStep.figmaExport" : /^(?:use_figma|create|send_code|upload)/.test(tool) ? "workStep.figmaEdit" : "workStep.figmaRead");
  const site = Object.keys(REFERENCE_SITES).find((key) => server === key || tool.includes(key));
  if (site) return t("workStep.references", { site: REFERENCE_SITES[site]! });
  for (const [pattern, key] of BY_TOOL) if (pattern.test(tool)) return t(key);
  const app = server ? APP_NAMES[server] : undefined;
  if (app) return t("workStep.app", { app });
  return t("chat.activity.working");
}

const isCommandStep = (step: WorkStepLine): boolean => Boolean(!step.text && step.tool && isShellTool(step.tool));

export function stepLabel(step: WorkStepLine): string {
  if (step.text) return step.text;
  if (step.command) return commandPhrase(step.command);
  return isCommandStep(step) ? t("command.unknown") : toolStepPhrase(step.tool ?? "");
}

/** The steps to show, consecutive repeats folded into the first. */
export function stepLines(steps: readonly WorkStepLine[] | undefined): StepLine[] {
  const lines: StepLine[] = [];
  for (const step of steps ?? []) {
    const label = stepLabel(step);
    if (lines.at(-1)?.label === label) continue;
    lines.push({ at: step.since ?? step.at, label });
  }
  return lines;
}

export function currentStep(steps: readonly WorkStepLine[] | undefined): StepLine | null {
  return stepLines(steps).at(-1) ?? null;
}

type StepTask = { threadId: string; busy?: boolean; activity?: string; steps?: WorkStepLine[]; doing?: string };
type StepRoom = { busyBotId?: string | null; steps?: WorkStepLine[]; tasks?: ReadonlyArray<{ busyBotId?: string | null; steps?: WorkStepLine[] }> };

/** The steps of the work a bot does now: its open conversation first, then any other conversation of its own, then a room
 *  it is speaking in. */
export function botSteps(
  bot: { id: string; threadId: string; tasks?: readonly StepTask[] },
  rooms: readonly StepRoom[] = [],
): WorkStepLine[] | undefined {
  const tasks = bot.tasks ?? [];
  const own = tasks.find((task) => task.threadId === bot.threadId && task.steps?.length)
    ?? tasks.filter((task) => task.steps?.length).sort((a, b) => b.steps!.at(-1)!.at - a.steps!.at(-1)!.at)[0];
  if (own) return own.steps;
  for (const room of rooms) {
    if (room.busyBotId === bot.id && room.steps?.length) return room.steps;
    const thread = room.tasks?.find((task) => task.busyBotId === bot.id && task.steps?.length);
    if (thread) return thread.steps;
  }
  return undefined;
}

/** What a conversation is doing now, in one line: the bot's own sentence, else a running command in words, else the line
 *  of the request, else its tool. */
export function taskStepNow(task: { steps?: readonly WorkStepLine[]; doing?: string }): string | null {
  const own = task.steps?.findLast((step) => step.text)?.text;
  if (own) return own;
  const last = task.steps?.at(-1);
  if (last?.command && last.since !== undefined) return commandPhrase(last.command);
  return task.doing ?? currentStep(task.steps)?.label ?? null;
}

/** One short line for the side list and the hover on the collapsed bar. */
export function botStepNow(bot: { id: string; threadId: string; tasks?: readonly StepTask[] }, rooms: readonly StepRoom[] = []): string | null {
  const open = bot.tasks?.find((task) => task.threadId === bot.threadId);
  return taskStepNow({ steps: botSteps(bot, rooms), doing: open?.doing });
}

/** "Designer: montando a lâmina 2": who works and on what, for rooms and team work. Only a leading gerund drops its
 *  capital, so a name that opens the line keeps it. */
export function whoIsDoing(name: string, doing: string): string {
  return `${name}: ${lowerGerund(doing)}`;
}

/** "9:04": the time a step began. */
export function stepClock(at: number): string {
  const date = new Date(at);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** A task's journal as its card reads it: the steps running now (newest first), the ones done, the planned ones to come. */
export interface JournalView {
  running: WorkJournalEntry[];
  done: Array<WorkJournalEntry & { end: number }>;
  left: string[];
  percent?: number;
  credits?: { used: number; cap?: number };
  where?: WorkPlace;
}

export function journalView(journal: WorkJournal): JournalView {
  const { plan, step, percent, credits, creditCap, where } = journal.progress;
  return {
    running: journal.entries.filter((entry) => entry.end === undefined).reverse(),
    done: journal.entries.filter((entry): entry is WorkJournalEntry & { end: number } => entry.end !== undefined),
    left: plan?.slice(step ?? 0) ?? [],
    ...(percent !== undefined ? { percent } : {}),
    ...(credits !== undefined ? { credits: { used: credits, ...(creditCap !== undefined ? { cap: creditCap } : {}) } } : {}),
    ...(where ? { where } : {}),
  };
}

/** Work still under way: a step running or planned steps not reached yet. */
export function journalOpen(journal: WorkJournal | undefined): journal is WorkJournal {
  if (!journal) return false;
  const view = journalView(journal);
  return view.running.length > 0 || view.left.length > 0;
}
