// A shell command, in the words a person reads. Shared so the chat line and the bot's own notice never disagree.

export const COMMAND_KINDS = [
  "allTests", "someTests", "typeCheck", "lint", "install", "build",
  "gitPush", "gitPull", "gitMerge", "gitCommit",
  "video", "transcribe", "web", "copyFiles", "remote", "wait",
] as const;

export type CommandKind = (typeof COMMAND_KINDS)[number];

export type RunningCommand = { command: string; since: number };

const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "terminal", "exec", "execute", "run_command", "computer_exec", "vm_exec"]);

export function isShellTool(name: string): boolean {
  const bare = name.replace(/^Running /, "").split(":", 1)[0]!.trim().replace(/^mcp__.+?__/, "").toLowerCase();
  return SHELL_TOOLS.has(bare);
}

const RULES: ReadonlyArray<readonly [CommandKind, RegExp]> = [
  ["typeCheck", /^tsc\b/],
  ["lint", /^(?:eslint|oxlint|biome)\b/],
  ["install", /^pip3?\s+install\b/],
  ["build", /^(?:(?:vite|next|tsup|webpack|rollup|turbo)\s+build|docker\s+(?:compose\s+)?build|cargo\s+build|go\s+build|electron-builder)\b/],
  ["gitPush", /^git(?:\s+(?:-C\s+\S+|-c\s+\S+|--no-pager))*\s+push\b/],
  ["gitPull", /^git(?:\s+(?:-C\s+\S+|-c\s+\S+|--no-pager))*\s+(?:pull|fetch|clone)\b/],
  ["gitMerge", /^git(?:\s+(?:-C\s+\S+|-c\s+\S+|--no-pager))*\s+(?:merge|rebase|cherry-pick)\b/],
  ["gitCommit", /^git(?:\s+(?:-C\s+\S+|-c\s+\S+|--no-pager))*\s+commit\b/],
  ["video", /^(?:ffmpeg|ffprobe)\b/],
  ["transcribe", /^(?:whisper|faster-whisper|mlx_whisper)\b/],
  ["web", /^(?:curl|wget)\b/],
  ["copyFiles", /^(?:rsync|scp|rclone)\b|^cp\s+-\S*[rRa]/],
  ["remote", /^ssh\b/],
  ["wait", /^sleep\b/],
];

const TEST_RUNNER = /^(?:vitest|jest|mocha|pytest|py\.test|playwright\s+test|go\s+test|cargo\s+(?:nextest|test))\b/;
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun"]);
const SCRIPT_KINDS: ReadonlyArray<readonly [RegExp, CommandKind | "tests"]> = [
  [/^test(?:[:\-.].*)?$/, "tests"],
  [/^lint(?:[:\-.].*)?$/, "lint"],
  [/^build(?:[:\-.].*)?$/, "build"],
  [/^(?:typecheck|type-check|tsc)(?:[:\-.].*)?$/, "typeCheck"],
];
const INSTALL_SUBCOMMANDS: ReadonlySet<string> = new Set(["install", "i", "ci", "add"]);

const WRAPPERS: ReadonlySet<string> = new Set(["sudo", "time", "nice", "nohup", "env", "command", "npx", "bunx", "corepack"]);
const NARROWING_FLAGS: ReadonlySet<string> = new Set(["-t", "-k", "-g", "--grep", "--testNamePattern", "--test-name-pattern", "--changed", "--related", "-run"]);
const FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(["--config", "-c", "--reporter", "--root", "--project", "--outputFile", "--shard", "--pool", "--dir"]);

const SHELL_C = /^(?:\S*\/)?(?:bash|sh|zsh)\s+-\w*c\s+(['"])([\s\S]*)\1$/;
const PIECE_BREAK = /&&|\|\||[;|\n]/;

const baseName = (token: string) => token.slice(token.lastIndexOf("/") + 1);

const REDIRECT = /(?:^|\s)(?:\d*|&)(?:>>?|<)\|?&?\s*\S+/g;
const HEREDOC_BODY = /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
const TIMEOUT_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(["-s", "-k", "--signal", "--kill-after"]);
const MANAGER_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(["--filter", "-F", "-C", "--dir", "--prefix", "--workspace", "--cwd"]);
/** npm's -w names a workspace; pnpm's -w is the workspace root and takes nothing. */
const NPM_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set([...MANAGER_FLAGS_WITH_VALUE, "-w"]);

/** Past the options of `timeout` and of a package manager, and their values. */
function skipOptions(tokens: readonly string[], at: number, withValue: ReadonlySet<string>): number {
  while (tokens[at]?.startsWith("-")) at += withValue.has(tokens[at]!) ? 2 : 1;
  return at;
}

function programLine(piece: string): string[] {
  const tokens = piece.replace(REDIRECT, " ").trim().split(/\s+/).filter(Boolean);
  let at = 0;
  for (;;) {
    const token = tokens[at];
    if (token === undefined) break;
    const name = baseName(token);
    const next = tokens[at + 1];
    if (/^[A-Za-z_]\w*=/.test(token) || WRAPPERS.has(name)) at += 1;
    else if (name === "timeout") at = skipOptions(tokens, at + 1, TIMEOUT_FLAGS_WITH_VALUE) + 1;
    else if (PACKAGE_MANAGERS.has(name) && (next === "exec" || next === "dlx")) at += 2;
    else if (/^python3?$/.test(name) && next === "-m") at += 2;
    else if ((name === "uv" || name === "poetry") && next === "run") at += 2;
    else break;
  }
  const [program, ...rest] = tokens.slice(at);
  if (program === undefined) return [];
  const name = baseName(program);
  if (!PACKAGE_MANAGERS.has(name)) return [name, ...rest];
  let args = rest.slice(skipOptions(rest, 0, name === "npm" ? NPM_FLAGS_WITH_VALUE : MANAGER_FLAGS_WITH_VALUE));
  if (args[0] === "workspace") args = args.slice(2);
  return args[0] === "exec" || args[0] === "dlx" ? programLine(args.slice(1).join(" ")) : [name, ...args];
}

function narrowsTests(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (NARROWING_FLAGS.has(arg)) return true;
    if (FLAGS_WITH_VALUE.has(arg)) { i += 1; continue; }
    if (arg.startsWith("-")) continue;
    if (arg.endsWith("...")) continue;
    if (arg.includes("/") || arg.includes("::") || /\.(?:[cm]?[jt]sx?|py|go|rs)$/.test(arg)) return true;
  }
  return false;
}

function pieceKind(piece: string): CommandKind | null {
  const [program, ...args] = programLine(piece);
  if (program === undefined) return null;
  const line = (PACKAGE_MANAGERS.has(program) ? args : [program, ...args]).join(" ");
  if (PACKAGE_MANAGERS.has(program) && !TEST_RUNNER.test(args.join(" "))) {
    const viaRun = args[0] === "run";
    const script = viaRun ? args[1] : args[0];
    if (script === undefined) return null;
    if (!viaRun && INSTALL_SUBCOMMANDS.has(script)) return "install";
    const kind = SCRIPT_KINDS.find(([pattern]) => pattern.test(script))?.[1];
    if (kind === "tests") return narrowsTests(args.slice(viaRun ? 2 : 1)) ? "someTests" : "allTests";
    return kind ?? null;
  }
  const runner = TEST_RUNNER.exec(line);
  if (runner) return narrowsTests(line.slice(runner[0].length).split(/\s+/).filter(Boolean)) ? "someTests" : "allTests";
  return RULES.find(([, pattern]) => pattern.test(line))?.[0] ?? null;
}

export function commandKind(command: string): CommandKind | null {
  const text = command.trim().replace(HEREDOC_BODY, "$3");
  const inner = SHELL_C.exec(text);
  if (inner) return commandKind(inner[2]!);
  for (const piece of text.split(PIECE_BREAK)) {
    const kind = pieceKind(piece);
    if (kind) return kind;
  }
  return null;
}

export function commandText(tool: { summary?: string; input?: string }): string | undefined {
  const summary = tool.summary?.trim();
  if (summary) return summary;
  if (!tool.input) return undefined;
  try {
    const command = (JSON.parse(tool.input) as { command?: unknown } | null)?.command;
    return typeof command === "string" && command.trim() ? command.trim() : undefined;
  } catch {
    return undefined;
  }
}

type PathMessage = {
  role: string;
  kind: string;
  at: number;
  quickAck?: boolean;
  steered?: boolean;
  aside?: boolean;
  card?: { answered?: unknown; answeredAt?: number };
  tool?: { name: string; ok?: boolean; summary?: string; input?: string; approved?: boolean; awaitingApproval?: boolean };
};

/** Rows that sit under a running command without ending it: the person's words delivered into the turn, the notices
 *  posted meanwhile, an approval chip and a permission card already answered. A row that says the request waits for a
 *  yes passes only once a yes follows it; until then the command has not started. */
function passesOver(message: PathMessage, allowedLater: boolean): boolean {
  if (message.role === "user") return Boolean(message.steered || message.aside);
  if (message.quickAck) return true;
  if (message.kind === "options") return message.card?.answered !== undefined;
  if (message.kind !== "activity") return false;
  return message.tool?.approved === true || (message.tool?.awaitingApproval === true && allowedLater);
}

/** When the person's or a rule's yes let the command start: a command waiting for approval was not running yet. */
function approvedAt(message: PathMessage): number | undefined {
  if (message.kind === "options" && message.card?.answered !== undefined) return message.card.answeredAt ?? message.at;
  return message.tool?.approved ? message.at : undefined;
}

/** The shell command the current turn is inside now. A person's message that opened a turn ends the search, so a
 *  command stopped without an outcome never runs on. Only a command carries a `summary`, so an engine that names its
 *  tool by the command itself is still a shell. */
export function runningCommand(path: readonly PathMessage[]): RunningCommand | null {
  let approval = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    const message = path[i]!;
    if (passesOver(message, approval > 0)) {
      approval = Math.max(approval, approvedAt(message) ?? 0);
      continue;
    }
    const tool = message.tool;
    if (message.role !== "bot" || message.kind !== "activity" || !tool || tool.ok !== undefined) return null;
    if (!isShellTool(tool.name) && tool.summary === undefined) return null;
    const command = commandText(tool);
    return command ? { command, since: Math.max(message.at, approval) } : null;
  }
  return null;
}

const LEADING_GERUND = /^\p{Lu}\p{Ll}*(?:ndo|ing)(?!\p{L})/u;
/** First names that read like a gerund: a line that opens with one is about a person, not what the bot is doing. */
const GERUND_LIKE_NAMES: ReadonlySet<string> = new Set(["Fernando", "Orlando", "Rolando", "Armando", "Hernando", "Ernando", "Raimundo", "Edmundo", "Segundo", "Sterling", "Irving", "Manning", "Fleming", "Browning"]);

function opensWithGerund(text: string): boolean {
  const word = LEADING_GERUND.exec(text)?.[0];
  return word !== undefined && !GERUND_LIKE_NAMES.has(word);
}

/** "Rodando todos os testes" after a name reads "rodando todos os testes"; any other opening keeps its capital, so a
 *  proper name is never lowered. */
export function lowerGerund(doing: string): string {
  return opensWithGerund(doing) ? `${doing[0]!.toLocaleLowerCase()}${doing.slice(1)}` : doing;
}

/** What a running command is doing, in a line that follows "está": the table's words for a command it knows; for any
 *  other, the bot's own step when it opens with a gerund (it may be in another language or a whole sentence); else
 *  the plain fallback. */
export function commandDoing(command: string, step: string | undefined, words: (kind: CommandKind) => string, fallback: string): string {
  const kind = commandKind(command);
  if (kind) return words(kind);
  const own = step?.trim().replace(/[.\s]+$/, "");
  return own && opensWithGerund(own) ? own : fallback;
}
