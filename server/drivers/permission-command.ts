import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

import { safetyFloorBlock, safetyFloorClears } from "../safety-floor-gate.ts";

/** Approval identity preserves every command byte, including whitespace and
 * newlines. Callers must supply native shell input, never a display preview. */
export function permissionCommand(command: unknown, cwd: unknown): { command: string; cwd: string } | undefined {
  if (typeof command !== "string" || !command.trim() || command.includes("\0")) return undefined;
  if (typeof cwd !== "string" || !isAbsolute(cwd) || cwd.includes("\0")) return undefined;
  return { command, cwd };
}

const BARE_WORD = /^[\w@%+=:,./-]+$/;

/** Codex's legacy execCommandApproval sends argv, not a line: it is quoted for POSIX sh so the floor reads what runs. */
function floorCommandLine(command: unknown): string | undefined {
  if (typeof command === "string") return command.trim() ? command : undefined;
  if (!Array.isArray(command) || !command.length || !command.every((word) => typeof word === "string")) return undefined;
  return command.map((word: string) => BARE_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`).join(" ");
}

/** A shell request's event fields: the exact-command descriptor, which needs a known cwd, and the raw command line
 * the safety floor reads, which does not. */
export function shellRequest(command: unknown, cwd: unknown): { command: ReturnType<typeof permissionCommand>; commandLine: string | undefined } {
  return { command: permissionCommand(command, cwd), commandLine: floorCommandLine(command) };
}

/** Whether a driver may answer a request itself with nobody looking; when false it must raise the request instead. */
export function answersAlone(command: unknown): boolean {
  return safetyFloorClears(floorCommandLine(command));
}

export function permissionLaunchCwd(cwd: string): string | undefined {
  try { return realpathSync(cwd); } catch { return undefined; }
}

// Antigravity's ACP shell input uses CommandLine/Cwd instead of command/cwd.
const COMMAND_KEYS = ["command", "CommandLine"] as const;
const DIRECTORY_KEYS = ["cwd", "Cwd", "workdir", "working_directory", "directory", "dir"] as const;

/** ACP's rawInput is provider-specific: only a complete command string and unambiguous absolute directories count. */
export function acpPermissionCommand(rawInput: unknown, launchCwd: string | undefined): ReturnType<typeof permissionCommand> {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return undefined;
  const input = rawInput as Record<string, unknown>;
  const directories = DIRECTORY_KEYS
    .filter((key) => input[key] !== undefined)
    .map((key) => input[key]);
  if (directories.some((value) => typeof value !== "string" || !isAbsolute(value) || value.includes("\0"))) return undefined;
  if (new Set(directories).size > 1) return undefined;
  // Two different spellings of the command are a contradiction, not a choice.
  const commands = COMMAND_KEYS.filter((key) => input[key] !== undefined).map((key) => input[key]);
  if (new Set(commands).size > 1) return undefined;
  return permissionCommand(commands[0], directories[0] ?? launchCwd);
}

/** Of spellings that disagree, the one the safety floor must see: a never-list one, else one it cannot read, else the
 * first. Never the spellings read together, where an open quote in one would make the next read as its text. */
function worstSpelling(spellings: readonly string[]): string {
  const rank = (line: string) => safetyFloorBlock(line) ? 2 : !safetyFloorClears(line) ? 1 : 0;
  return spellings.reduce((worst, line) => rank(line) > rank(worst) ? line : worst);
}

/** Each different command line an ACP call's input spells, as the floor reads it. More than one is a contradiction:
 * nobody can tell which one the engine runs. */
export function acpCommandSpellings(rawInput: unknown): string[] {
  const input = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) ? rawInput as Record<string, unknown> : {};
  return [...new Set(COMMAND_KEYS.map((key) => floorCommandLine(input[key])).filter((line): line is string => line !== undefined))];
}

/** shellRequest for an ACP tool call: only a shell-typed call gets the descriptor, but any call naming a command
 * line carries it for the safety floor (the worst spelling when they disagree). `nativeShell` only for a shell-typed
 * call whose spellings agree, since the engine runs one of them; `commandsDisagree` when they do not. */
export function acpShellRequest(isShellCommand: boolean, rawInput: unknown, launchCwd: string | undefined):
  ReturnType<typeof shellRequest> & { nativeShell?: true; commandsDisagree?: true } {
  const spellings = acpCommandSpellings(rawInput);
  return {
    command: isShellCommand ? acpPermissionCommand(rawInput, launchCwd) : undefined,
    commandLine: spellings.length ? worstSpelling(spellings) : undefined,
    ...(isShellCommand && spellings.length === 1 ? { nativeShell: true as const } : {}),
    ...(spellings.length > 1 ? { commandsDisagree: true as const } : {}),
  };
}

/** An ACP permission request's exact operation, for the driver's own session allow; null for a generic title with no input. */
export function acpSessionOperationKey(toolCall: any): string | null {
  const rawInput = toolCall?.rawInput;
  const command = typeof rawInput?.command === "string" ? rawInput.command : undefined;
  const hasInput = rawInput && typeof rawInput === "object" && Object.keys(rawInput).length > 0;
  if (!command && !hasInput) return null;
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]))
        : value;
  return JSON.stringify(stable({
    kind: toolCall?.kind,
    title: toolCall?.title,
    command,
    input: rawInput,
    locations: toolCall?.locations,
  }));
}
