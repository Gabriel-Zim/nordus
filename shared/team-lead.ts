// A team's leader answers its members' approval requests: what its rules allow passes at once, what the person
// owns (spending, sending outside, deleting anything but a disposable version, the leader's own "ask" list) goes to
// the person through the leader, and everything else is the grey zone a decision model may judge.
import { criticalAction, criticalCommand, type CriticalReason } from "./critical-action.ts";

/** One rule of a leader, with exactly one matcher. */
export interface TeamLeadRule {
  /** What the person and the chat read: "exportar a versão leve". */
  label: string;
  /** A tool name glob, case-insensitive, `*` for any run of characters ("mcp__figma__*"). Never matches a shell tool:
   * shell work needs `command`. */
  tool?: string;
  /** One shell command, word by word ("node ferramentas/exportar-figma/exportar-figma.js png * --modo revisao *"). In
   * `allow` the first word is literal (or `NAME=*` for a variable assignment); in `ask` it may be `*`, so a broad rule
   * brings more to the person, never less. A word `*` stands for any words, and `*` inside a word for any characters of
   * that word. Never matched: a command with redirections, braces, subshells or substitutions, an interpreter's inline
   * code the rule does not name, or anything the person decides. */
  command?: string;
  /** An absolute folder, `*` standing for one folder name: `rm` of plain paths strictly inside a matching folder,
   * compared after resolving links. */
  deleteUnder?: string;
}

/** A bot with a policy leads its team: `allow` is what it always permits its members, `ask` what it always brings to the
 * person. A rule that matches nothing changes nothing. */
export interface TeamLeadPolicy {
  allow: TeamLeadRule[];
  ask: TeamLeadRule[];
}

export const TEAM_LEAD_RULES_MAX = 60;
const LABEL_MAX = 120;
const PATTERN_MAX = 400;
const MATCHERS = ["tool", "command", "deleteUnder"] as const;

/** The policy as stored, or the reason it is refused. */
export function parseTeamLeadPolicy(value: unknown): TeamLeadPolicy | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "teamLead must be an object with allow and ask lists" };
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => key !== "allow" && key !== "ask");
  if (unknown.length) return { error: `teamLead has unknown fields: ${unknown.join(", ")}` };
  const lists: Partial<TeamLeadPolicy> = {};
  for (const name of ["allow", "ask"] as const) {
    const raw = record[name] ?? [];
    if (!Array.isArray(raw)) return { error: `teamLead.${name} must be a list` };
    if (raw.length > TEAM_LEAD_RULES_MAX) return { error: `teamLead.${name} has more than ${TEAM_LEAD_RULES_MAX} rules` };
    const rules: TeamLeadRule[] = [];
    for (const [index, item] of raw.entries()) {
      const where = `teamLead.${name}[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `${where} must be an object` };
      const rule = item as Record<string, unknown>;
      const extra = Object.keys(rule).filter((key) => key !== "label" && !(MATCHERS as readonly string[]).includes(key));
      if (extra.length) return { error: `${where} has unknown fields: ${extra.join(", ")}` };
      const label = typeof rule.label === "string" ? rule.label.replace(/\s+/g, " ").trim() : "";
      if (!label || label.length > LABEL_MAX) return { error: `${where}.label must be 1 to ${LABEL_MAX} characters` };
      const given = MATCHERS.filter((key) => rule[key] !== undefined);
      if (given.length !== 1) return { error: `${where} needs exactly one of tool, command or deleteUnder` };
      const key = given[0]!;
      const pattern = typeof rule[key] === "string" ? (rule[key] as string).trim() : "";
      if (!pattern || pattern.length > PATTERN_MAX) return { error: `${where}.${key} must be 1 to ${PATTERN_MAX} characters` };
      if (key === "deleteUnder" && (!pattern.startsWith("/") || pattern.split("/").some((part) => part === ".." || part === "."))) {
        return { error: `${where}.deleteUnder must be an absolute folder without . or ..` };
      }
      if (key === "deleteUnder" && name === "ask") return { error: `${where}: deleteUnder only belongs in allow; every other delete already asks` };
      if (key === "deleteUnder" && !/^[\w\-./*]+$/.test(pattern)) return { error: `${where}.deleteUnder may hold only letters, digits, - _ . / and *` };
      if (key === "command" && name === "allow") {
        const first = pattern.split(/\s+/)[0]!;
        if (first.includes("*") && !/^[A-Za-z_][A-Za-z0-9_]*=\*$/.test(first)) {
          return { error: `${where}.command must start with the literal program name (or NAME=* for an assignment), never a glob` };
        }
      }
      rules.push({ label, [key]: key === "deleteUnder" ? pattern.replace(/\/+$/, "") : pattern });
    }
    lists[name] = rules;
  }
  return { allow: lists.allow!, ask: lists.ask! };
}

export type LeadDecision =
  | { kind: "allow"; labels: string[] }
  | { kind: "person"; why: CriticalReason | "ask-rule" | "high-res" | "environment"; label?: string }
  | { kind: "grey" };

/** How the server reads the member's files, to match a delete after links are resolved. Without it, no delete passes. */
export interface LeadFiles {
  /** The resolved path, or null when it cannot be resolved. */
  realpath(path: string): string | null;
  isSymlink(path: string): boolean;
  exists(path: string): boolean;
}

const SHELL_TOOLS = new Set(["bash", "shell", "exec_command", "run_command", "terminal", "powershell"]);

function isShell(tool: string): boolean {
  const bare = tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").toLowerCase();
  return SHELL_TOOLS.has(tool.toLowerCase()) || SHELL_TOOLS.has(bare);
}

function globRegex(glob: string, flags = ""): RegExp {
  const body = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}$`, flags);
}

const toolMatches = (rule: TeamLeadRule, tool: string) => Boolean(rule.tool) && !isShell(tool) && globRegex(rule.tool!, "i").test(tool);

/** What joins a command to the next one: `""` after the last. */
export type ShellJoiner = "&&" | "||" | ";" | "\n" | "|" | "&" | "";

/** The commands of a command line, split on `&&`, `||`, `;`, `|`, `&` and new lines outside quotes, each with the
 * joiner after it. */
export function shellSegments(command: string): Array<{ text: string; join: ShellJoiner }> {
  const segments: Array<{ text: string; join: ShellJoiner }> = [];
  const push = (text: string, join: ShellJoiner) => {
    const trimmed = text.trim();
    const previous = segments.at(-1);
    if (trimmed) segments.push({ text: trimmed, join });
    // `a;\n b` joins like a new line; any other pair of joiners around nothing is read as the one that shares the least.
    else if (previous && join) previous.join = /^[;\n]$/.test(previous.join) && /^[;\n]$/.test(join) ? "\n" : "|";
  };
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (quote) {
      current += char;
      if (char === "\\" && quote === "\"" && i + 1 < command.length) current += command[++i];
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === "\"") { quote = char; current += char; continue; }
    if (char === "\\" && i + 1 < command.length) { current += char + command[++i]; continue; }
    if (char === ";" || char === "\n" || char === "|" || char === "&") {
      // `2>&1` and `>&2` are redirections, not separators.
      if (char === "&" && (command[i - 1] === ">" || command[i + 1] === ">")) { current += char; continue; }
      const doubled = (char === "&" || char === "|") && command[i + 1] === char;
      if (doubled) i += 1;
      push(current, doubled ? (char === "&" ? "&&" : "||") : char as ShellJoiner);
      current = "";
      continue;
    }
    current += char;
  }
  push(current, "");
  return segments;
}

const ALLOWED_REDIRECTS = new Set(["2>&1", ">&2", ">/dev/null", "2>/dev/null", "&>/dev/null"]);
/** A redirection written apart from its target, allowed only when the next word is /dev/null. */
const DISCARD_PREFIX = new Set([">", "1>", "2>", "&>", ">>"]);

/** A command's words with quotes taken off. `opaque` when the shell would do more than run it: a redirection
 * anywhere but to /dev/null or stderr, braces, a subshell, a substitution, an unexpanded variable or a glob. */
export function shellWords(segment: string): { words: string[]; opaque: boolean } {
  const words: string[] = [];
  let opaque = false;
  let word = "";
  let raw = "";
  let started = false;
  let quote: string | null = null;
  let discarding = false;
  const flush = () => {
    if (!started) return;
    if (discarding) {
      discarding = false;
      if (raw !== "/dev/null") opaque = true;
    } else if (DISCARD_PREFIX.has(raw)) {
      discarding = true;
    } else if (!ALLOWED_REDIRECTS.has(raw)) {
      if (/[<>]/.test(raw.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ""))) opaque = true;
      words.push(word);
    }
    word = ""; raw = ""; started = false;
  };
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i]!;
    if (quote === "'") {
      raw += char;
      if (char === "'") quote = null; else word += char;
      continue;
    }
    if (quote === "\"") {
      raw += char;
      if (char === "\"") { quote = null; continue; }
      if (char === "$" || char === "`") opaque = true;
      if (char === "\\" && i + 1 < segment.length) { word += segment[++i]; raw += segment[i]; continue; }
      word += char;
      continue;
    }
    if (/\s/.test(char)) { flush(); continue; }
    started = true;
    raw += char;
    if (char === "'" || char === "\"") { quote = char; continue; }
    if (char === "\\" && i + 1 < segment.length) { word += segment[++i]; raw += segment[i]; continue; }
    if (/[`$(){}*?[]/.test(char)) opaque = true;
    word += char;
  }
  if (quote) opaque = true;
  flush();
  if (discarding) opaque = true;
  return { words, opaque };
}

const INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "python", "python3", "perl", "ruby", "node", "deno", "bun",
  "php", "lua", "osascript", "pwsh", "powershell"]);
const INLINE_CODE = new Set(["-c", "-e", "-E", "--eval", "-p", "--print", "-r", "-x"]);

function wordsMatch(rule: readonly string[], words: readonly string[]): boolean {
  if (!rule.length) return !words.length;
  const [head, ...rest] = rule;
  if (head === "*") return words.some((_, index) => wordsMatch(rest, words.slice(index))) || wordsMatch(rest, []);
  return words.length > 0 && globRegex(head!).test(words[0]!) && wordsMatch(rest, words.slice(1));
}

const baseName = (word: string) => word.slice(word.lastIndexOf("/") + 1);

function commandMatches(rule: TeamLeadRule, words: readonly string[], list: "allow" | "ask"): boolean {
  if (!rule.command || !words.length) return false;
  const ruleWords = rule.command.trim().split(/\s+/);
  const first = ruleWords[0]!;
  const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=\*$/.exec(first);
  // Only an `ask` rule may open with a glob; it then matches anywhere in the command.
  if (!assignment && first.includes("*")) return list === "ask" && wordsMatch(first === "*" ? ruleWords : ["*", ...ruleWords, "*"], words);
  if (assignment ? !words[0]!.startsWith(`${assignment[1]}=`) : first !== words[0]) return false;
  // An interpreter's inline code, wherever the interpreter sits in the command, passes only where the rule names its flag.
  const inlineCode = words.some((word, index) => INTERPRETERS.has(baseName(word)) &&
    words.slice(index + 1).some((flag) => INLINE_CODE.has(flag) && !ruleWords.includes(flag)));
  if (list === "allow" && inlineCode) return false;
  return wordsMatch(ruleWords.slice(1), words.slice(1));
}

const REMOVERS = new Set(["rm", "rmdir", "unlink", "shred", "srm", "trash", "trash-put"]);
const ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/;
const ENVIRONMENT = /^(?:PATH|LD_\w*|DYLD_\w*|BASH_ENV|ENV|IFS|NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|PERL5OPT|PERL5LIB|RUBYOPT|SHELLOPTS|PS4|PROMPT_COMMAND|HOME|GIT_\w*)$/;
const PLAIN_PATH = /^[\w\-./]+$/;
/** An assignment as the shell recognizes one: in the written word, before quotes, escapes and variables are taken off. */
const WRITTEN_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\w\-./]+)$/;
/** A line the rules read as plainly as the shell: printable ASCII, tab and new line, no backslash and no `#`. Anything
 * else (an escape, a comment, a space or control character the shell keeps inside a word) never passes by rule. */
const PLAINLY_READ = /^[\x20-\x22\x24-\x5b\x5d-\x7e\t\n]*$/;
/** Names the shell keeps for itself: assigning one may fail or not hold, so its value is never assumed. */
const SHELL_OWNED = /^(?:BASH\w*|EUID|UID|PPID|SHELLOPTS|RANDOM|SRANDOM|SECONDS|LINENO|HISTCMD|GROUPS|FUNCNAME|DIRSTACK|EPOCH\w*|PIPESTATUS|PWD|OLDPWD|OPTIND|OPTARG|REPLY|_)$/;

/** `$NAME` and `${NAME}` replaced where the shell would expand them: never inside single quotes or after a backslash. */
function expand(segment: string, vars: ReadonlyMap<string, string>): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i]!;
    if (quote === "'") { out += char; if (char === "'") quote = null; continue; }
    if (char === "\\") { out += segment.slice(i, i + 2); i += 1; continue; }
    if (char === "'" && !quote) quote = "'";
    else if (char === "\"") quote = quote ? null : "\"";
    const name = char === "$" ? /^\{([A-Za-z_][A-Za-z0-9_]*)\}|^([A-Za-z_][A-Za-z0-9_]*)/.exec(segment.slice(i + 1)) : null;
    const value = name ? vars.get(name[1] ?? name[2]!) : undefined;
    if (name && value !== undefined) { out += value; i += name[0].length; continue; }
    out += char;
  }
  return out;
}

/** Sending outside from a shell, wherever it sits in the line, quoted or not, by name or by path. */
const OUTBOUND_COMMAND = /(?:^|[\s;&|(`'"])(?:[^\s;&|()`'"]*\/)?(?:curl|wget|scp|sftp|rsync|ssh|nc|ncat|netcat|telnet|ftp|sendmail|mailx|mutt)(?=$|[\s;&|)`'"])/;

/** The Nordus exporter: a final or full-size export, a free `--saida`, a pdf or any scale but exactly 1 is the person's. */
const EXPORTER = /exportar-figma/;
function exportIsPersons(text: string): boolean {
  if (!EXPORTER.test(text)) return false;
  if (/final/i.test(text) || /--saida/.test(text) || /(?:^|\s)pdf(?:\s|$)/.test(text)) return true;
  const scales = [...text.matchAll(/--escala(?:=|\s+|$)["']?([^\s"']*)/g)].map((match) => match[1]!);
  return scales.some((scale) => !/^\d+(?:\.\d+)?$/.test(scale) || Number(scale) !== 1);
}
/** A light or review export names its mode as two exact words, once. */
function exportModeIsLight(words: readonly string[]): boolean {
  const modes = words.flatMap((word, index) => word === "--modo" ? [words[index + 1]] : word.startsWith("--modo") ? [undefined] : []);
  return modes.length === 1 && (modes[0] === "preview" || modes[0] === "revisao");
}

function folderMatches(folder: string, parts: readonly string[]): boolean {
  const globs = folder.split("/").filter(Boolean);
  return parts.length > globs.length && globs.every((glob, index) => globRegex(glob).test(parts[index]!));
}

/** A target of `rm` sits strictly inside an allowed folder once its links are resolved: that rule, or null. Only an
 * absolute target: the member's shell may have moved since the server last saw where it stands. */
function deleteRule(target: string, rules: readonly TeamLeadRule[], files: LeadFiles | undefined): TeamLeadRule | null {
  if (!files || !PLAIN_PATH.test(target) || !target.startsWith("/")) return null;
  if (target.split("/").some((part) => part === ".." || part === ".")) return null;
  const parts = target.split("/").filter(Boolean);
  const base = parts.pop();
  if (!base) return null;
  const parent = files.realpath(`/${parts.join("/")}`);
  if (!parent) return null;
  let real = `${parent === "/" ? "" : parent}/${base}`;
  if (files.isSymlink(real)) {
    // `rm -rf link/` empties what the link points to; without the slash it removes the link itself.
    if (target.endsWith("/")) return null;
  } else if (files.exists(real)) {
    const resolved = files.realpath(real);
    if (!resolved) return null;
    real = resolved;
  }
  const realParts = real.split("/").filter(Boolean);
  return rules.find((rule) => rule.deleteUnder && folderMatches(rule.deleteUnder, realParts)) ?? null;
}

/** An `rm` whose every target is inside an allowed folder, or null when it is anything else. */
function internalDelete(words: readonly string[], rules: readonly TeamLeadRule[], files: LeadFiles | undefined): TeamLeadRule | null {
  if (words[0] !== "rm") return null;
  let flagsDone = false;
  const targets: string[] = [];
  for (const word of words.slice(1)) {
    if (!flagsDone && word === "--") { flagsDone = true; continue; }
    // Options end at the first path, as the macOS rm reads them: a later `-x` is a file to delete.
    if (!flagsDone && !targets.length && word.startsWith("-")) {
      if (!/^-[rRfvdI]+$|^--(?:recursive|force|verbose|dir)$/.test(word)) return null;
      continue;
    }
    targets.push(word);
  }
  if (!targets.length) return null;
  let matched: TeamLeadRule | null = null;
  for (const target of targets) {
    const rule = deleteRule(target, rules, files);
    if (!rule) return null;
    matched ??= rule;
  }
  return matched;
}

/** What a leader's rules say about a member's request, without any model. The person's things (an `ask` rule, the
 * critical list, sending outside, the exporter's final or full size, the environment a command runs in) never pass by
 * rule. */
export function leadDecision(
  policy: TeamLeadPolicy,
  action: { tool: string; command?: string; files?: LeadFiles },
): LeadDecision {
  const { tool } = action;
  if (!isShell(tool)) {
    const critical = criticalAction(tool);
    if (critical) return { kind: "person", why: critical };
    const asked = policy.ask.find((rule) => toolMatches(rule, tool));
    if (asked) return { kind: "person", why: "ask-rule", label: asked.label };
    const allowed = policy.allow.find((rule) => toolMatches(rule, tool));
    return allowed ? { kind: "allow", labels: [allowed.label] } : { kind: "grey" };
  }
  const command = action.command?.trim();
  if (!command) return { kind: "grey" };
  // Quoted text is still code to `sh -c`, `<(…)` and the like: these read the line with its quotes as plain text.
  const bare = command.replace(/["'`]/g, " ");
  const anywhere = criticalCommand(bare);
  if (anywhere && anywhere !== "delete") return { kind: "person", why: anywhere };
  if (OUTBOUND_COMMAND.test(command)) return { kind: "person", why: "send" };
  if (exportIsPersons(command)) return { kind: "person", why: "high-res" };
  // A variable holds where the shell surely set it: for the rest of its `&&` chain, and past a `;` only when it was set
  // once, first in its chain. A pipe, `&` or `||` runs the assignment elsewhere or maybe not at all. Never past a new
  // line: bash drops the rest of a line on an error such as a read-only assignment, then runs the next line.
  const lasting = new Map<string, string>();
  const chain = new Map<string, string>();
  const settled = new Set<string>();
  let doubtful = false;
  let joiner: ShellJoiner = "\n";
  const labels: string[] = [];
  let grey = false;
  const note = (label: string) => { if (!labels.includes(label)) labels.push(label); };
  for (const { text: raw, join } of shellSegments(command)) {
    const before = joiner;
    joiner = join;
    if (before === ";" || before === "||") {
      for (const [name, value] of chain) {
        if (before === ";" && settled.has(name)) lasting.set(name, value);
        else lasting.delete(name);
      }
    }
    if (before === "\n") lasting.clear();
    if (before !== "&&" && before !== "|") { chain.clear(); settled.clear(); doubtful = before === "||"; }
    const segment = expand(raw, new Map([...lasting, ...chain]));
    const { words, opaque } = shellWords(segment);
    if (words[0] === "nohup") words.shift();
    // Anywhere in the command, not only in front: `env PATH=… node …` sets it as well.
    if (words.some((word) => ENVIRONMENT.test(ENV_ASSIGNMENT.exec(word)?.[1] ?? ""))) return { kind: "person", why: "environment" };
    // The words as the shell runs them: a name split by quotes or set through a variable is whole again here.
    if (OUTBOUND_COMMAND.test(words.join(" "))) return { kind: "person", why: "send" };
    const asked = policy.ask.find((rule) => commandMatches(rule, words, "ask"));
    if (asked) return { kind: "person", why: "ask-rule", label: asked.label };
    // Any remove is a delete here, not only the forced recursive one the app's critical list names.
    const removes = words.some((word) => REMOVERS.has(baseName(word))) || words.includes("-delete");
    const critical = criticalCommand(segment) ?? (removes ? "delete" : null);
    if (criticalCommand(segment.replace(/["'`]/g, " ")) && !critical) return { kind: "person", why: "delete" };
    if (critical) {
      const rule = critical === "delete" && !opaque ? internalDelete(words, policy.allow, action.files) : null;
      if (!rule) return { kind: "person", why: critical };
      note(rule.label);
      continue;
    }
    // A plain variable for the commands after it (`P=/a/b && rm -rf $P/v1`) runs nothing on its own.
    const assignment = WRITTEN_ASSIGNMENT.exec(raw);
    if (assignment) {
      const [, name, value] = assignment as unknown as [string, string, string];
      const holds = !doubtful && before !== "|" && join !== "|" && !SHELL_OWNED.test(name);
      const first = before === ";" || before === "\n" || before === "&";
      if (holds) chain.set(name, value);
      else { lasting.delete(name); chain.delete(name); }
      if (holds && first) settled.add(name);
      else settled.delete(name);
      continue;
    }
    const allowed = opaque ? undefined : policy.allow.find((rule) => commandMatches(rule, words, "allow"));
    const exporter = words.some((word) => EXPORTER.test(word));
    if (allowed && (!exporter || exportModeIsLight(words))) note(allowed.label);
    else grey = true;
  }
  return grey || !labels.length || !PLAINLY_READ.test(command) ? { kind: "grey" } : { kind: "allow", labels };
}

export const teamOf = (section?: string) => section?.trim() || "";

/** Whether `from` leads `target`'s team: its level flows down to the member like a Chief's. */
export function leadsTeamOf(
  from: { id: string; section?: string; teamLead?: TeamLeadPolicy },
  target: { id: string; section?: string },
): boolean {
  return Boolean(from.teamLead) && from.id !== target.id && Boolean(teamOf(from.section)) && teamOf(from.section) === teamOf(target.section);
}

/** The one visible leader of `member`'s team, never the member itself. Security: with two leaders on a team (a leader
 * moved onto another leader's team, a file applied out of order) none answers for anyone on it, each other included;
 * requests wait for the person as they did before leaders existed, because no rule set is then the team's. */
export function teamLeadFor<T extends { id: string; section?: string; teamLead?: TeamLeadPolicy; hidden?: boolean }>(
  bots: readonly T[],
  member: { id: string; section?: string },
): T | undefined {
  const team = teamOf(member.section);
  const leaders = bots.filter((bot) => !bot.hidden && bot.teamLead && team && teamOf(bot.section) === team);
  return leaders.length === 1 && leaders[0]!.id !== member.id ? leaders[0] : undefined;
}

/** What the leader says on the person's card, in its own voice. */
/** The chip in the member's conversation once a request its leader brought to the person is allowed: "Você" only when
 *  the person answered; a system or rule answer is not theirs. */
export function relayedAllowChip(source: string, what: string | undefined): string {
  const who = source === "user" ? "Você liberou" : "Liberado";
  return what ? `${who}: ${what}` : who;
}

export function leaderAsksPerson(member: string, what: string | undefined): string {
  const action = what?.trim().replace(/[.!]+$/, "");
  return action
    ? `Preciso da sua aprovação aqui: ${member} quer ${action.charAt(0).toLocaleLowerCase("pt-BR")}${action.slice(1)}.`
    : `Preciso da sua aprovação aqui: ${member} quer seguir com uma ação que só você pode liberar.`;
}
