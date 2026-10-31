import { composioActionPhrase } from "@/lib/approval-summary";
import { handoffLabel } from "@/lib/handoff-label";
import { t, tFromServer } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Message } from "@/state/store";
import { INTERNAL_TOOLS } from "../../shared/work-steps";
import { repeatNoticeCount } from "../../shared/repeat-notice";

type StepTool = Pick<NonNullable<Message["tool"]>, "name" | "summary">;

const STEP_KEYS: Record<string, LocaleKey> = {
  bash: "toolStep.runCommand",
  shell: "toolStep.runCommand",
  terminal: "toolStep.runCommand",
  run_command: "toolStep.runCommand",
  execute: "toolStep.runCommand",
  computer_exec: "toolStep.runCommand",
  read: "toolStep.readFile",
  read_file: "toolStep.readFile",
  view: "toolStep.readFile",
  write: "toolStep.writeFile",
  create_file: "toolStep.writeFile",
  edit: "toolStep.editFile",
  multiedit: "toolStep.editFile",
  str_replace: "toolStep.editFile",
  apply_patch: "toolStep.editFile",
  notebookedit: "toolStep.editFile",
  delete: "toolStep.deleteFile",
  grep: "toolStep.searchFiles",
  glob: "toolStep.searchFiles",
  find: "toolStep.searchFiles",
  search: "toolStep.searchFiles",
  ls: "toolStep.searchFiles",
  websearch: "toolStep.searchWeb",
  web_search: "toolStep.searchWeb",
  webfetch: "toolStep.openWebPage",
  web_fetch: "toolStep.openWebPage",
  fetch: "toolStep.openWebPage",
  open_url: "toolStep.openWebPage",
  screenshot: "toolStep.lookAtScreen",
  computer_screenshot: "toolStep.lookAtScreen",
  click: "toolStep.useComputer",
  type_text: "toolStep.useComputer",
  press_key: "toolStep.useComputer",
  scroll: "toolStep.useComputer",
  computer_batch: "toolStep.useComputer",
  todowrite: "toolStep.updatePlan",
  update_plan: "toolStep.updatePlan",
  task: "toolStep.askHelper",
  agent: "toolStep.askHelper",
  think: "toolStep.think",
  list_bots: "toolStep.checkTeam",
  toolsearch: "toolStep.findTool",
  tool_search: "toolStep.findTool",
  tool: "toolStep.useTool",
  other: "toolStep.useTool",
  mcp: "toolStep.useTool",
};

function sentence(words: string): string {
  const flat = words.replace(/\s+/g, " ").trim();
  return flat ? flat[0]!.toLocaleUpperCase() + flat.slice(1) : flat;
}

export function toolStepLabel(tool: StepTool): string {
  const { name } = tool;
  // Codex and ACP title a command's chip with the command line; only a command carries a summary.
  if (tool.summary) return t("toolStep.runCommand");
  const repeated = repeatNoticeCount(name);
  if (repeated !== null) return t("chat.repeatNotice", { count: repeated });
  const titled = /^Running ([\w.:-]+)$/.exec(name);
  if (titled) return toolStepLabel({ name: titled[1]! });
  // A name with spaces is a command line or a raw title: say what kind of thing it was, never the text itself.
  if (/\s/.test(name)) return looksLikeCommand(name) ? commandPhrase(name) : handoffLabel(name);
  const bare = name.replace(/^mcp__.+?__(?=.)/, "");
  if (/(?:^|_)browser_/i.test(bare)) return t("toolStep.useBrowser");
  const key = STEP_KEYS[bare.toLowerCase()];
  if (key) return t(key);
  const own = tFromServer(`toolName.${bare}`, undefined);
  if (own) return own;
  const composio = composioActionPhrase(bare);
  if (composio) return sentence(composio);
  const words = bare
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.:]+/g, " ")
    .toLowerCase();
  return sentence(words) || t("toolStep.useTool");
}

/** A line the server already wrote in words stays; a command line or a path never reaches the chat. */
function looksLikeCommand(line: string): boolean {
  return /[/\\|<>=$`~]|--|&&/.test(line) || /^\s*(sudo|cd|ls|cat|npm|pnpm|npx|git|curl|wget|python3?|node|bash|sh|ssh|docker|systemctl|vps|zorg-[\w-]+)\b/i.test(line);
}

const COMMAND_PHRASES: Array<[RegExp, LocaleKey]> = [
  [/\b(df|du|disk|disco|storage)\b/i, "toolStep.human.disk"],
  [/\b(test|tests|vitest|jest|pytest)\b/i, "toolStep.human.tests"],
  [/\b(git)\b/i, "toolStep.human.history"],
  [/\b(curl|wget|http|https)\b/i, "toolStep.human.web"],
  [/\b(docker|systemctl|service|pm2)\b/i, "toolStep.human.services"],
  [/\b(ssh|vps|server|servidor)\b/i, "toolStep.human.server"],
  [/\b(ls|find|grep|rg|tree)\b/i, "toolStep.human.search"],
  [/\b(cat|head|tail|less|sed)\b/i, "toolStep.human.read"],
  [/\b(npm|pnpm|yarn|pip|brew|apt)\b/i, "toolStep.human.install"],
];

/** A command, told as what it was for: "Conferi o espaço em disco", never the command line. */
export function commandPhrase(command: string): string {
  for (const [pattern, key] of COMMAND_PHRASES) if (pattern.test(command)) return t(key);
  return t("toolStep.human.check");
}

/** The bot's own housekeeping: finding a tool, planning, reading its team or its memory, proposing a lesson. Not something it did for the person. */

const DONE_KEYS: Record<string, LocaleKey> = {
  "toolStep.runCommand": "toolDone.runCommand",
  "toolStep.readFile": "toolDone.readFile",
  "toolStep.writeFile": "toolDone.writeFile",
  "toolStep.editFile": "toolDone.editFile",
  "toolStep.deleteFile": "toolDone.deleteFile",
  "toolStep.searchFiles": "toolDone.searchFiles",
  "toolStep.searchWeb": "toolDone.searchWeb",
  "toolStep.openWebPage": "toolDone.openWebPage",
  "toolStep.lookAtScreen": "toolDone.lookAtScreen",
  "toolStep.useComputer": "toolDone.useComputer",
  "toolStep.useBrowser": "toolDone.useBrowser",
  "toolStep.askHelper": "toolDone.askHelper",
  "toolStep.useTool": "toolDone.useTool",
};

const DONE_BY_NAME: Record<string, LocaleKey> = {
  post_to_room: "toolDone.postToRoom",
  coordinate_bots: "toolDone.coordinateBots",
  attach_file: "toolDone.attachFile",
  propose_routine: "toolDone.proposeRoutine",
  request_sign_in: "toolDone.requestSignIn",
  send_voice_note: "toolDone.sendVoiceNote",
  create_room: "toolDone.createRoom",
  start_thread: "toolDone.startThread",
  retry_thread: "toolDone.retryThread",
  raise_escalation: "toolDone.raiseEscalation",
  show_widget: "toolDone.showWidget",
  vm_exec: "toolDone.runCommand",
};

const DONE_MANY: Partial<Record<LocaleKey, LocaleKey>> = {
  "toolDone.readFile": "toolDone.readFileMany",
  "toolDone.writeFile": "toolDone.writeFileMany",
  "toolDone.editFile": "toolDone.editFileMany",
  "toolDone.deleteFile": "toolDone.deleteFileMany",
  "toolDone.openWebPage": "toolDone.openWebPageMany",
  "toolDone.attachFile": "toolDone.attachFileMany",
};

function doneKey(bare: string): LocaleKey | null | undefined {
  const own = DONE_BY_NAME[bare];
  if (own) return own;
  if (/(?:^|_)browser_/i.test(bare)) return "toolDone.useBrowser";
  const stepKey = STEP_KEYS[bare];
  if (stepKey) return DONE_KEYS[stepKey] ?? null;
  return undefined;
}

/** One line under "O que ele fez", in the past and in plain words ("Li 3 arquivos"), or null for the bot's housekeeping. */
export function toolDoneLabel(name: string, count = 1): string | null {
  const bare = name.replace(/^mcp__.+?__(?=.)/, "").toLowerCase();
  if (INTERNAL_TOOLS.has(bare)) return null;
  const key = doneKey(bare);
  if (key === null) return null;
  if (key === undefined) return toolStepLabel({ name });
  const many = count > 1 ? DONE_MANY[key] : undefined;
  return many ? t(many, { count }) : t(key);
}

/** Nordus: a step said as verb plus the thing the bot works on ("Editando a capa do Reels do CJ"); the object is written in
 * Portuguese, so other languages keep the plain step. Null when the step is not work on that thing. */
const OBJECT_VERBS: Array<[RegExp, string, string]> = [
  [/edit|retouch|retoc|ajust|editar/i, "Editando", "Editei"],
  [/video|v[ií]deo|clip|reel/i, "Montando", "Montei"],
  [/generat|gerar|create_image|image|imagem|render|draw|design|capa|cover/i, "Criando", "Criei"],
  [/schedul|agend/i, "Agendando", "Agendei"],
  [/send|post|publish|enviar|publicar|reply/i, "Enviando", "Enviei"],
  [/write|escrev|draft|rascunh|caption|legenda/i, "Escrevendo", "Escrevi"],
];

export function stepOnObject(name: string, object: string | undefined, locale: string, done = false): string | null {
  if (!object || !locale.toLowerCase().startsWith("pt")) return null;
  const bare = name.replace(/^mcp__.+?__(?=.)/, "");
  if (INTERNAL_TOOLS.has(bare.toLowerCase())) return null;
  for (const [pattern, doing, did] of OBJECT_VERBS) if (pattern.test(bare)) return `${done ? did : doing} ${object}`;
  return null;
}
