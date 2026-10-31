import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { commandDoing, commandKind, lowerGerund, runningCommand, type CommandKind } from "../../shared/command-words";
import type { WorkStepLine } from "../../shared/work-steps";
import { humanElapsed } from "./human-elapsed";

const KIND_KEYS: Record<CommandKind, LocaleKey> = {
  allTests: "command.kind.allTests",
  someTests: "command.kind.someTests",
  typeCheck: "command.kind.typeCheck",
  lint: "command.kind.lint",
  install: "command.kind.install",
  build: "command.kind.build",
  gitPush: "command.kind.gitPush",
  gitPull: "command.kind.gitPull",
  gitMerge: "command.kind.gitMerge",
  gitCommit: "command.kind.gitCommit",
  video: "command.kind.video",
  transcribe: "command.kind.transcribe",
  web: "command.kind.web",
  copyFiles: "command.kind.copyFiles",
  remote: "command.kind.remote",
  wait: "command.kind.wait",
};

export function commandPhrase(kind: CommandKind): string {
  return t(KIND_KEYS[kind]);
}

const SHOW_TIME_FROM_MS = 60_000;

export type CommandPresence = { phrases: string[]; phase: string; since: number };

type PathMessage = Parameters<typeof runningCommand>[0][number] & { id: string };

/** The server's transcript: a message still on its way shows early on the client and would end the command there. */
function onServer(messages: readonly PathMessage[]): PathMessage[] {
  return messages.filter((message) => !message.id.startsWith("optimistic-"));
}

/** The presence line while a shell command runs, in the same words as the bot's notice. The command itself is never
 *  part of it. */
export function commandPresence(messages: readonly PathMessage[], steps?: readonly WorkStepLine[]): CommandPresence | null {
  const running = runningCommand(onServer(messages));
  if (!running) return null;
  const step = steps?.findLast((line) => line.text?.trim())?.text;
  const phrase = commandDoing(running.command, step, commandPhrase, t("command.unknown"));
  return { phrases: [phrase], phase: `command:${commandKind(running.command) ?? phrase}`, since: running.since };
}

export function elapsedSince(since: number, now: number): string | null {
  return now - since >= SHOW_TIME_FROM_MS ? humanElapsed(now - since) : null;
}

/** "PROGRAMADOR está rodando todos os testes · há 21 min": the time joins from a minute on. */
export function presenceLine({ name, doing, since, now }: { name: string; doing: string; since?: number | null; now: number }): string {
  if (since == null) return t("presence.one", { name, doing: doing.toLocaleLowerCase() });
  const elapsed = elapsedSince(since, now);
  return elapsed
    ? t("presence.oneSince", { name, doing: lowerGerund(doing), since: elapsed })
    : t("presence.one", { name, doing: lowerGerund(doing) });
}

const WEB_ADDRESS = /\bhttps?:\/\/[^\s'"`]+/gi;

/** A web address keeps only scheme and host: its path or query can carry a signed link's secret, and userinfo a password. */
function withoutAddressSecrets(command: string): string {
  return command.replace(WEB_ADDRESS, (address) => {
    try {
      const { protocol, host } = new URL(address);
      return `${protocol}//${host}`;
    } catch {
      return "";
    }
  });
}

/** The raw command under "Ver detalhes", for someone who chose to see tool calls or uses the advanced view. */
export function detailsCommand(messages: readonly PathMessage[], view: { showToolCalls: boolean; advanced: boolean }): string | undefined {
  if (!view.showToolCalls && !view.advanced) return undefined;
  const running = runningCommand(onServer(messages));
  return running ? withoutAddressSecrets(running.command) : undefined;
}
