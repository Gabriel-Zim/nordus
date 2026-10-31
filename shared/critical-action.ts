// The actions that wait for the person even when a bot works on its own (Automático): spending money or a lot of
// credit, changing system or account settings, permanent deletion, sending or publishing outside, and deploying.
// Read from the tool's name and, for a shell, its command line; shared by the engine hook and the approval broker.
import { isOutboundTool, sensitiveReason, type SensitiveReason } from "./outbound.ts";

export type CriticalReason = SensitiveReason;

/** Shell tools whose input is a command line. */
const SHELL_TOOLS = new Set(["bash", "shell", "exec_command", "run_command", "terminal", "powershell"]);

const COMMAND_RULES: ReadonlyArray<[CriticalReason, RegExp | ((command: string) => boolean)]> = [
  // Permanent deletion.
  ["delete", (command) => rmNeedsPerson(command)],
  ["delete", /\b(?:shred|mkfs(?:\.\w+)?|wipefs)\b/i],
  ["delete", /\bdd\s+[^|;&]*\bof=\/dev\//i],
  ["delete", /\bgit\s+(?:push\s+[^|;&]*(?:--force|-f)\b|reset\s+--hard|clean\s+-[a-z]*f)/i],
  ["delete", /\b(?:drop\s+(?:database|table|schema)|truncate\s+table)\b/i],
  // Deploys and releases.
  ["deploy", /\bgit\s+push\b/i],
  ["deploy", /\b(?:wrangler|vercel|netlify|flyctl|fly|firebase|heroku|railway|amplify|serverless|sls)\s+(?:deploy|publish|up|release)\b/i],
  ["deploy", /\b(?:npm|pnpm|yarn)\s+publish\b/i],
  ["deploy", /\b(?:terraform|tofu)\s+(?:apply|destroy)\b/i],
  ["deploy", /\bkubectl\s+(?:apply|delete|rollout|scale)\b/i],
  ["deploy", /\bdocker\s+(?:push|compose\s+(?:up|down))\b/i],
  // System and account settings.
  ["config", (command) => sudoNeedsPerson(command)],
  ["config", /\bsystemctl\s+(?:stop|disable|mask|restart|reload|enable)\b/i],
  ["config", (command) => firewallChanges(command)],
  ["config", /\bcrontab\s+-[re]\b/i],
  ["config", /\b(?:chmod|chown)\s+-R\b/i],
  ["config", /\b(?:useradd|userdel|usermod|passwd|visudo)\b/i],
  ["config", /\b(?:adduser|addgroup|deluser|delgroup|gpasswd|groupmems|groupadd|groupdel|chpasswd)\b/i],
  // Sending outside.
  ["send", /\b(?:sendmail|mailx|mutt)\b/i],
];

const SEGMENT_SPLIT = /&&|\|\||[;|&\n]/;
/** Redirections to a plain file or descriptor; a target with `$`, a backtick or a paren stays visible to the scans below. */
const SAFE_REDIRECT = /\d*>&[\d-]+|&>>?[ \t]*[\w./+-]+|\d*>>?[ \t]*[\w./+-]+/g;
const withoutRedirects = (text: string) => text.replace(SAFE_REDIRECT, " ");

const SAFE_PATH_CHARS = /^[\w.@%+,=:/-]+$/;
const hasDotComponent = (components: readonly string[]) => components.some((part) => part === "." || part === "..");

/** Security invariant: an rm -rf target is safe only when it is a plain relative path inside the working copy or a named
 * path under /tmp or /var/tmp. Anything that expands (`$`, `~`, glob, substitution), climbs (`..`), is the directory
 * itself (`.`, `/tmp`) or lies elsewhere stays critical, and so does a command whose target cannot be read. */
function safeRmTarget(target: string): boolean {
  if (!SAFE_PATH_CHARS.test(target)) return false;
  const absolute = /^\/(?:var\/)?tmp\/(.+)$/.exec(target);
  if (absolute) {
    const rest = absolute[1]!.split("/").filter(Boolean);
    return rest.length > 0 && !hasDotComponent(rest);
  }
  if (target.startsWith("/") || target.startsWith("-")) return false;
  const relative = target.replace(/^\.\//, "");
  const parts = relative.split("/").filter(Boolean);
  return parts.length > 0 && !hasDotComponent(parts);
}

const LITERAL_ASSIGNMENT = /(^|[;\n])[ \t]*([A-Za-z_]\w*)=('x*'|"x*"|[^\s'"$`\\;&|()<>{}*?[~!#]*)([ \t]*)(?=[;\n]|&&|\|\||$)/g;
const SHELL_FLOW_WORD = /\b(?:if|then|else|elif|fi|while|until|do|done|case|esac|for|select|function|eval|source|exec|trap|set|unset|alias)\b/;
const regexEscape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Security invariant: `$NAME` is replaced only for a variable the command itself sets exactly once, as its own
 * top-level statement before every use, to a plain path (no expansion, glob, space or quote trick), and never touches it
 * in any other way (read, for, export, `${NAME:-x}`, `NAME=x cmd`, a second assignment, a mention inside quotes). Flow
 * keywords, comments, heredocs, backslashes and an assignment inside a group or after `&&`/`||` leave the variable unexpanded. */
function expandLiteralVariables(command: string): string {
  if (!command.includes("$") || command.includes("\\") || command.includes("<<")) return command;
  const mask = (text: string) => text.replace(QUOTED, (quoted) => quoted[0] + "x".repeat(quoted.length - 2) + quoted[0]);
  let current = command;
  const masked = mask(current);
  if (SHELL_FLOW_WORD.test(masked) || /(?:^|\s)#/.test(masked)) return command;
  const names = new Set([...masked.matchAll(LITERAL_ASSIGNMENT)].map((match) => match[2]!));
  for (const name of names) {
    const view = mask(current);
    const found = [...view.matchAll(LITERAL_ASSIGNMENT)].filter((match) => match[2] === name);
    if (found.length !== 1) continue;
    const match = found[0]!;
    const valueEnd = match.index + match[0].length - match[4]!.length;
    const written = current.slice(valueEnd - match[3]!.length, valueEnd);
    const value = /^['"]/.test(written) ? written.slice(1, -1) : written;
    if (!SAFE_PATH_CHARS.test(value)) continue;
    const depth = Array.from(view.slice(0, match.index)).reduce((sum, char) => sum + ("({".includes(char) ? 1 : ")}".includes(char) ? -1 : 0), 0);
    if (depth !== 0) continue;
    const use = new RegExp(`\\$(?:${regexEscape(name)}(?!\\w)|\\{${regexEscape(name)}\\})`, "g");
    if (new RegExp(use.source).test(current.slice(0, valueEnd))) continue;
    const rest = current.slice(valueEnd);
    const stripped = (current.slice(0, match.index + match[1]!.length) + rest).replace(use, " ");
    if (new RegExp(`(?<![\\w$])${regexEscape(name)}(?![\\w])`).test(stripped)) continue;
    current = current.slice(0, valueEnd) + rest.replace(use, value);
  }
  return current;
}

/** rm that is both recursive and forced, with at least one target that is not provably safe (or no readable target). */
function rmNeedsPerson(command: string): boolean {
  if (!/\brm\b/i.test(command)) return false;
  const text = withoutRedirects(withoutNoise(expandLiteralVariables(dropWriterBody(command)).replace(QUOTED, "''")));
  if (!/\brm\b/i.test(text)) return false;
  if (/--no-preserve-root/i.test(text)) return true;
  for (const match of text.matchAll(/\brm\b/gi)) {
    const tail = text.slice((match.index ?? 0) + 2).split(SEGMENT_SPLIT)[0]!;
    const words = tail.trim().split(/\s+/).filter(Boolean);
    const targets: string[] = [];
    const options: string[] = [];
    let optionsEnded = false;
    for (const word of words) {
      if (!optionsEnded && word === "--") optionsEnded = true;
      else if (!optionsEnded && word.startsWith("-")) options.push(word);
      else targets.push(word);
    }
    const recursive = options.some((option) => /^-[a-z]*r|^--recursive$/i.test(option));
    const forced = options.some((option) => /^-[a-z]*f|^--force$/i.test(option));
    if (!recursive || !forced) continue;
    if (/[$`()]/.test(tail) || targets.length === 0 || !targets.every(safeRmTarget)) return true;
  }
  return false;
}

const FIREWALL_TOOL = /^(ufw|ip6?tables(?:-restore|-save|-nft|-legacy)?|nft|firewall-cmd)$/;
/** Words that only print what follows them. */
const FIREWALL_MENTIONS = new Set(["echo", "printf", "ls", "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "which", "type", "man", "wc", "stat", "file"]);
const UFW_WRITES = new Set(["allow", "deny", "reject", "limit", "delete", "insert", "enable", "disable", "reset", "reload", "route", "default", "prepend", "logging"]);
const NFT_WRITES = new Set(["add", "delete", "flush", "insert", "replace", "create", "destroy"]);
const IPTABLES_LONG_WRITES = /^--(?:append|insert|delete|replace|flush|delete-chain|policy|new-chain|rename-chain|zero)\b/;
const FIREWALLD_WRITES = /^--(?:add|remove|reload|complete-reload|permanent|set|change|new|delete|load|runtime-to-permanent|panic|lockdown|enable|disable)/;

function firewallArgsChange(tool: string, args: readonly string[]): boolean {
  if (tool === "ufw") return args.some((arg) => UFW_WRITES.has(arg.toLowerCase()));
  if (tool === "nft") return args.some((arg) => NFT_WRITES.has(arg.toLowerCase()) || /^(?:-[a-z]*[fi][a-z]*|--file|--interactive)$/.test(arg));
  if (tool === "firewall-cmd") return args.some((arg) => FIREWALLD_WRITES.test(arg));
  if (tool.endsWith("-restore")) return true;
  if (tool.endsWith("-save")) return false;
  return args.some((arg) => IPTABLES_LONG_WRITES.test(arg) || (/^-[A-Za-z]+$/.test(arg) && /[AIDRFXPNEZ]/.test(arg)));
}

/** Security invariant: a firewall tool waits only when it changes rules or settings. Listing, status and `systemctl
 * is-active ufw` read. The verdict comes from the words after the tool name in its segment, whatever wraps it
 * (`sudo`, `ssh host`, `env`); only a leading echo, ls, cat or grep makes the name plain text. */
function firewallChanges(command: string): boolean {
  const text = withoutRedirects(commandText(command));
  if (!/ufw|ip6?tables|nft|firewall-cmd/i.test(text)) return false;
  return text.split(/&&|\|\||[;|&\n()`{}]/).some((segment) => {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || FIREWALL_MENTIONS.has(words[0]!.split("/").pop()!)) return false;
    return words.some((word, at) => {
      const bare = word.replace(/^\\+/, "");
      const name = /\//.test(bare) ? /^\/(?:usr\/)?(?:local\/)?s?bin\/([\w-]+)$/.exec(bare)?.[1] : bare;
      const tool = name?.toLowerCase();
      return tool !== undefined && FIREWALL_TOOL.test(tool) && firewallArgsChange(tool, words.slice(at + 1));
    });
  });
}

/** ASSISTENTEFINANCEIRO's e-mail sender (assistentefinanceiro-envio) sending a draft for real. Security invariant: read with every quote and
 * backslash removed, so a quoted path, a quoted subcommand or `bash -c "…"` still reads as the send. */
const ASSISTENTEFINANCEIRO_FREE = new Set(["rascunho", "estado"]);
const ASSISTENTEFINANCEIRO_MENTIONS = new Set(["grep", "egrep", "fgrep", "rg", "cat", "ls", "which", "type", "command", "man", "echo", "printf"]);
/** Every call of ASSISTENTEFINANCEIRO's sender sends, except drafting and reading the state. */
function assistenteFinanceiroSends(command: string): boolean {
  if (!/enviar-email/i.test(command)) return false;
  return unquoted(command).split(/&&|\|\||[;|&\n()`{}]/).some((segment) => {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    const at = words.findIndex((word) => word.split("/").pop() === "enviar-email");
    return at >= 0 && !ASSISTENTEFINANCEIRO_MENTIONS.has(words[0]!.split("/").pop()!) && !ASSISTENTEFINANCEIRO_FREE.has(words[at + 1] ?? "");
  });
}
const unquoted = (command: string) => commandTextWithQuotes(command).replace(/["'\\]/g, "");

/** A change to DNS or a zone through Cloudflare's API; its address is usually quoted, so this reads the whole line. */
const CLOUDFLARE_WRITE = /\bapi\.cloudflare\.com\b[^\n]*-X\s*["']?(?:POST|PUT|PATCH|DELETE)|-X\s*["']?(?:POST|PUT|PATCH|DELETE)\b[^\n]*api\.cloudflare\.com/i;

const CHECK_END = String.raw`(?:[ \t]*(?:\d*>>?[ \t]*(?:&\d+|&-|[\w/.:-]+)|&>>?[ \t]*[\w/.:-]+))*[ \t]*(?:$|[;|)\n]|&(?!>))`;
const SUDO_CHECK = new RegExp(String.raw`\bsudo((?:[ \t]+--?[A-Za-z][A-Za-z-]*)*)(?:[ \t]+(true|:))?(?=${CHECK_END})`, "gi");
const SUDO_QUIET_FLAGS = /^-[nSkK]+$/;
const SUDO_LIST_FLAGS = /^-[nSkKlv]+$|^--(?:list|validate)$/;
const SUDO_LISTS = /^-[nSkKlv]*[lv][nSkKlv]*$|^--(?:list|validate)$/;

/** Security invariant: sudo disappears only when it can run no command (it only lists, validates or resets its timestamp,
 * or runs `true`). A value flag, a continuation or any other word after the flags keeps it. */
function blankSudoCheck(match: string, flagText = "", target?: string): string {
  const flags = flagText.split(/\s+/).filter(Boolean);
  const checks = target
    ? flags.every((flag) => SUDO_QUIET_FLAGS.test(flag))
    : (flags.length === 1 && /^-[kK]$/.test(flags[0]!)) || (flags.every((flag) => SUDO_LIST_FLAGS.test(flag)) && flags.some((flag) => SUDO_LISTS.test(flag)));
  return checks ? "" : match;
}

const blankVisudoCheck = (match: string, rest: string) => (/\s(?:--check\b|-[A-Za-z]*c)/.test(rest) ? rest : match);

const blank = () => "";

const NOISE: ReadonlyArray<[RegExp, (match: string, ...groups: string[]) => string]> = [
  [/(?<=[-_.])sudo|sudo(?=[-_./]\w)/gi, blank],
  [/\b(?:getent[ \t]+group|e?grep|fgrep|rg)\b[^;&|\n()`]*/gi, blank],
  [SUDO_CHECK, blankSudoCheck],
  [/\bvisudo\b([^;&|\n()`]*)/gi, blankVisudoCheck],
  [/\/etc\/(?:passwd|group)\b/g, blank],
];

const WRITER_HEAD = (() => {
  const file = String.raw`(?![\/-])(?!\S*\.\.)[\w.\/+@%,:=-]+`;
  const nowhere = String.raw`[ \t]*>[ \t]*\/dev\/null`;
  const opener = String.raw`<<(-?)[ \t]*(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)"|([A-Za-z_]\w*))`;
  const writers = [
    String.raw`cat[ \t]*>>?[ \t]*${file}[ \t]*${opener}`,
    String.raw`cat[ \t]*${opener}[ \t]*>>?[ \t]*${file}`,
    String.raw`tee(?:[ \t]+-a)?[ \t]+${file}(?:${nowhere})?[ \t]*${opener}`,
    String.raw`tee(?:[ \t]+-a)?[ \t]+${file}[ \t]*${opener}(?:${nowhere})?`,
  ];
  return writers.map((writer) => new RegExp(String.raw`^[ \t]*${writer}[ \t]*$`));
})();

/** Security invariant: a heredoc body is dropped only when the whole command is one `cat` or `tee` writing a plain
 * relative file and nothing in the body expands. Anything else around it (a pipe, a second command, a continuation)
 * leaves the body to be scanned. */
function dropWriterBody(command: string): string {
  const lines = command.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 2) return command;
  for (const head of WRITER_HEAD) {
    const opener = head.exec(lines[0]!);
    if (!opener) continue;
    const stripTabs = opener[1] === "-";
    const delimiter = opener.slice(2).find((group) => group !== undefined)!;
    const expands = opener[4] !== undefined && lines.some((line) => /[$`]/.test(line));
    const ends = (line: string) => (stripTabs ? line.replace(/^\t+/, "") : line) === delimiter;
    const last = lines.length - 1;
    return !expands && ends(lines[last]!) && !lines.slice(1, last).some(ends) ? lines[0]! : command;
  }
  return command;
}

const MAX_NESTED_SHELLS = 4;
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g;

/** The quoted strings another shell runs: after `ssh … host`, after `-c`, or after a variable at the start of a command. */
function nestedCommands(command: string): string[] {
  if (!/['"]/.test(command)) return [];
  const masked = command.replace(QUOTED, (quoted) => quoted[0] + "x".repeat(quoted.length - 2) + quoted[0]);
  const found: string[] = [];
  for (const match of command.matchAll(QUOTED)) {
    const start = match.index ?? 0;
    const before = masked.slice(0, start);
    const lead = before.slice(Math.max(...[";", "&", "|", "\n", "("].map((separator) => before.lastIndexOf(separator))) + 1);
    if (/^\s*(?:\w+=\S*\s+)*(?:ssh\b|\$\{?\w+\}?\s)/.test(lead) || /(?:^|\s)-c\s*$/.test(lead)) {
      found.push(match[0].slice(1, -1).replace(/\\(["\\$`])/g, "$1"));
    }
  }
  return found;
}

/** The closed list freed under sudo: reading commands with no option that runs, writes or takes a program. find, git,
 * docker and journalctl were in Avery's list and left out: each has options or repo config that run commands as root. */
const READING = new Set(["cat", "head", "tail", "ls", "grep", "egrep", "fgrep"]);
/** Words that only mention sudo as data (`getent group sudo`, `grep sudo /etc/group`). */
const MENTIONS = new Set(["grep", "egrep", "fgrep", "zgrep", "rg", "getent", "echo", "printf", "id", "groups"]);

function readsOnly([program = "", ...args]: readonly string[]): boolean {
  if (program.includes("=") || (program.includes("/") && !/^\/(?:usr\/)?bin\/[\w.-]+$/.test(program))) return false;
  const name = program.split("/").pop()!;
  if (name === "true" || name === ":") return args.length === 0;
  if (READING.has(name)) return true;
  return name === "systemctl" && args[0] === "status" && args.slice(1).every((arg) => /^[\w@.:-]+$/.test(arg) && !arg.startsWith("-") || arg === "--no-pager");
}

/** sudo that only lists, validates or resets its timestamp, or runs one reading command as another user. */
function sudoReadsOnly(args: readonly string[]): boolean {
  let at = 0;
  let checks = false;
  while (at < args.length && args[at]!.startsWith("-")) {
    const flag = args[at]!;
    if (flag === "-u" || flag === "--user") at += 2;
    else if (/^-[nSlvkK]+$|^-u\S+$|^--(?:list|validate|non-interactive)$/.test(flag)) at += 1;
    else return false;
    checks ||= /^-[nS]*[lvkK]|^--(?:list|validate)$/.test(flag);
  }
  return at >= args.length ? checks : readsOnly(args.slice(at));
}

/** Security invariant: sudo waits for the person unless every sudo in the command runs only a reading command from a
 * closed list, and nothing in the command redirects, tees, substitutes or pipes into a shell. When unsure, it waits. */
const sudoName = (word: string) => word.split("/").pop()!;

function sudoNeedsPerson(command: string): boolean {
  if (!/\bsudo\b/i.test(command)) return false;
  const text = dropWriterBody(command).replace(QUOTED, "''").replace(/\d*>&\d+|&?\d*>\s*\/dev\/null/g, " ");
  const segments = text.split(/&&|\|\||[;|&\n()`{}]/).map((segment) => segment.trim().split(/\s+/).filter(Boolean));
  const words = segments.flat();
  if (words.some((word) => /=(?:\S*\/)?sudo$/.test(word) || /^\\+sudo/.test(sudoName(word)))) return true;
  if (!words.some((word) => /^sudo(?:$|[^\w.-])/.test(sudoName(word)))) return false;
  if (words.some((word) => /^sudo[^\w.-]/.test(sudoName(word)))) return true;
  if (/[<>`]|\btee\b|\$\(|\beval\b|\bsource\b|\|\s*(?:ba|z|da|k)?sh\b/.test(text)) return true;
  const uses = segments.flatMap((words) => {
    const program = words.find((word) => !/^\w+=/.test(word) && !["time", "nohup", "exec", "then", "do", "else", "if", "while", "until", "!"].includes(word));
    if (program && MENTIONS.has(program.split("/").pop()!)) return [];
    return words.flatMap((word, at) => sudoName(word) === "sudo" ? [words.slice(at + 1)] : []);
  });
  if (uses.length === 0) return false;
  // Security invariant: shell syntax can hide an option or a program from this reading; any of it near sudo waits.
  const raw = dropWriterBody(command).replace(/\d*>&\d+|&?\d*>\s*\/dev\/null/g, " ").split(/&&|\|\||[;|&\n()`{}]/);
  if (raw.some((segment) => segment.split(/\s+/).some((word) => sudoName(word) === "sudo") && /[$\\'"*?[\]{}]/.test(segment))) return true;
  return uses.some((args) => !sudoReadsOnly(args));
}

const withoutNoise = (text: string) => NOISE.reduce((current, [shape, replacement]) => current.replace(shape, replacement), text);

export function commandText(command: string): string {
  return withoutNoise(dropWriterBody(command).replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''"));
}

/** The noise shapes removed but quoted text kept: a check that must also read inside quotes (`bash -c "sudo …"`). */
export function commandTextWithQuotes(command: string): string {
  return withoutNoise(dropWriterBody(command));
}

/** Why a shell command waits for the person, or null. A command handed to another shell (`ssh host '…'`, `bash -c "…"`,
 * `$S '…'`) is read like a local one. */
export function criticalCommand(command: string | undefined, depth = 0): CriticalReason | null {
  if (!command) return null;
  if (depth < MAX_NESTED_SHELLS) {
    for (const inner of nestedCommands(command)) {
      const reason = criticalCommand(inner, depth + 1);
      if (reason) return reason;
    }
  }
  const text = commandText(command);
  for (const [reason, rule] of COMMAND_RULES) if (typeof rule === "function" ? rule(command) : rule.test(text)) return reason;
  if (assistenteFinanceiroSends(command)) return "send";
  return CLOUDFLARE_WRITE.test(command) ? "config" : null;
}

/** A tool whose input is a command line, by its own name or as an MCP server's tool. */
export function isShellTool(tool: string): boolean {
  const bare = tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").toLowerCase();
  return SHELL_TOOLS.has(tool.toLowerCase()) || SHELL_TOOLS.has(bare);
}

/** Why this call waits for the person even in Automático, or null when the bot may go ahead. */
export function criticalAction(tool: string, command?: string): CriticalReason | null {
  if (isShellTool(tool)) return criticalCommand(command);
  // The app's own team tools (room posts, threads, notes) stay inside the workspace.
  if (tool.startsWith("mcp__agents__") || tool.startsWith("mcp__ogb__")) return null;
  const reason = sensitiveReason(tool);
  if (reason) return reason;
  if (isOutboundTool(tool)) return "send";
  return null;
}
