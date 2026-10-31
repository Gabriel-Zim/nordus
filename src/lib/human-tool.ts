import { composioActionPhrase } from "@/lib/approval-summary";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export type ToolKind = "searchWeb" | "openPage" | "runCommand" | "readFile" | "writeFile" | "deleteFile" | "readEmail" | "sendEmail" | "schedulePost" | "other";

const KIND_BY_TOOL: Record<string, ToolKind> = {
  websearch: "searchWeb",
  web_search: "searchWeb",
  search_web: "searchWeb",
  webfetch: "openPage",
  web_fetch: "openPage",
  fetch: "openPage",
  open_url: "openPage",
  bash: "runCommand",
  shell: "runCommand",
  terminal: "runCommand",
  run_command: "runCommand",
  execute: "runCommand",
  computer_exec: "runCommand",
  read: "readFile",
  read_file: "readFile",
  view: "readFile",
  write: "writeFile",
  create_file: "writeFile",
  edit: "writeFile",
  multiedit: "writeFile",
  str_replace: "writeFile",
  apply_patch: "writeFile",
  delete: "deleteFile",
};

export function toolKind(tool: string | undefined): ToolKind {
  if (!tool) return "other";
  const bare = tool.replace(/^mcp__.+?__(?=.)/, "").toLowerCase();
  const direct = KIND_BY_TOOL[bare];
  if (direct) return direct;
  if (/(?:gmail|email|mail).*(?:read|fetch|list|search|get)|(?:read|fetch|list|search|get).*(?:gmail|email|mail)/.test(bare)) return "readEmail";
  if (/(?:gmail|email|mail).*send|send.*(?:gmail|email|mail)/.test(bare)) return "sendEmail";
  if (/(?:schedule|create).*post|post.*schedule|metricool|buffer|planner/.test(bare)) return "schedulePost";
  return "other";
}

const PICK: Record<ToolKind, string[]> = {
  searchWeb: ["query", "q", "search", "search_query"],
  openPage: ["url", "uri", "href"],
  runCommand: ["description"],
  readFile: ["file_path", "path", "filePath", "notebook_path"],
  writeFile: ["file_path", "path", "filePath"],
  deleteFile: ["file_path", "path", "filePath"],
  readEmail: ["query", "q", "subject", "from"],
  sendEmail: ["subject", "to"],
  schedulePost: ["title", "text", "caption", "date", "scheduled_at"],
  other: ["description", "query", "title", "subject", "name", "url"],
};

function short(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function tidy(kind: ToolKind, value: string): string {
  if (kind === "openPage") {
    try {
      const url = new URL(value);
      return short(`${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`, 60);
    } catch {
      return short(value, 60);
    }
  }
  if (kind === "readFile" || kind === "writeFile" || kind === "deleteFile") return short(value.split(/[\\/]/).filter(Boolean).pop() ?? value, 60);
  return short(value);
}

/** The useful part of a tool's raw parameters (a JSON object or one line of text), never the raw text itself. */
export function toolInputGist(tool: string | undefined, raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const kind = toolKind(tool);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const field of PICK[kind]) {
      const value = Reflect.get(parsed, field);
      if (typeof value === "string" && value.trim()) return tidy(kind, value);
    }
    return undefined;
  }
  if (kind === "openPage" && /^https?:\/\//.test(raw.trim())) return tidy(kind, raw.trim());
  if (kind === "searchWeb") return short(raw);
  return undefined;
}

export function friendlyToolName(tool: string): string {
  const bare = tool.replace(/^mcp__.+?__(?=.)/, "");
  const composio = composioActionPhrase(bare);
  if (composio) return composio;
  return bare.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.:]+/g, " ").toLowerCase().trim() || tool;
}

const DONE: Record<ToolKind, LocaleKey> = {
  searchWeb: "humanTool.done.searchWeb",
  openPage: "humanTool.done.openPage",
  runCommand: "humanTool.done.runCommand",
  readFile: "humanTool.done.readFile",
  writeFile: "humanTool.done.writeFile",
  deleteFile: "humanTool.done.deleteFile",
  readEmail: "humanTool.done.readEmail",
  sendEmail: "humanTool.done.sendEmail",
  schedulePost: "humanTool.done.schedulePost",
  other: "humanTool.done.other",
};

const WILL: Record<ToolKind, LocaleKey> = {
  searchWeb: "humanTool.will.searchWeb",
  openPage: "humanTool.will.openPage",
  runCommand: "humanTool.will.runCommand",
  readFile: "humanTool.will.readFile",
  writeFile: "humanTool.will.writeFile",
  deleteFile: "humanTool.will.deleteFile",
  readEmail: "humanTool.will.readEmail",
  sendEmail: "humanTool.will.sendEmail",
  schedulePost: "humanTool.will.schedulePost",
  other: "humanTool.will.other",
};

function withGist(line: string, gist: string | undefined): string {
  return gist ? `${line}: ${gist}` : line;
}

/** "Social pesquisou na web: preço da API" for a request that was allowed. */
export function toolDoneLine(name: string, tool: string | undefined, raw: string | undefined): string {
  const kind = toolKind(tool);
  return withGist(t(DONE[kind], { name, tool: friendlyToolName(tool ?? "") }), toolInputGist(tool, raw));
}

/** "Vai pesquisar na internet: preço da API" for a request still waiting on the person. */
export function toolWillLine(tool: string | undefined, raw: string | undefined): string {
  const kind = toolKind(tool);
  return withGist(t(WILL[kind], { tool: friendlyToolName(tool ?? "") }), toolInputGist(tool, raw));
}

const TOOL_LABEL: Record<string, LocaleKey> = {
  Bash: "approval.tool.runCommand",
  Read: "approval.tool.readFile",
  Write: "approval.tool.writeFile",
  Edit: "approval.tool.editFile",
  WebFetch: "approval.tool.fetchWebPage",
  WebSearch: "approval.tool.searchWeb",
  schedule_routine: "approval.tool.scheduleRoutine",
  manage_routine: "approval.tool.changeRoutine",
  stage_skill: "approval.tool.enableSkill",
  update_skill: "approval.tool.updateSkill",
  update_profile: "approval.tool.updateProfile",
  // ACP drivers may send the protocol's toolCall kind as the tool, so every kind maps to a phrase ("shell" is
  // execute; "tool" is no kind at all).
  shell: "approval.tool.runCommand",
  edit: "approval.tool.editFile",
  read: "approval.tool.readFile",
  fetch: "approval.tool.fetchWebPage",
  delete: "approval.tool.deleteFile",
  think: "approval.tool.think",
  other: "approval.tool.takeAction",
  tool: "approval.tool.useTool",
};

export function toolLabel(tool?: string): string {
  if (!tool) return t("approval.tool.takeAction");
  const key = TOOL_LABEL[tool];
  if (key) return t(key);
  return composioActionPhrase(tool.replace(/^mcp__[^_]+__/, "")) ?? tool.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
}

/** The end of "Quero …" for a tool: a phrase of ours, never the tool's own name. */
export function plainToolAction(tool?: string): string {
  const key = tool ? TOOL_LABEL[tool] : undefined;
  return t(key ?? "approval.tool.useTool");
}
