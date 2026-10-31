// "Parou no meio" is no longer a block in the sidebar: each new item reaches the person once, as a notification.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { buildNotification, type Notification, type NotifyBot } from "./notify.ts";
import { collectInterrupted, type InterruptedWorkDeps } from "./routes/interrupted-work.ts";

const KEPT_DAYS = 14;

export interface InterruptedNotifierDeps extends Pick<InterruptedWorkDeps, "cutTurns" | "doneFor" | "succeededAfter" | "routineRuns" | "botName" | "threadTitle" | "dismissedFile" | "now"> {
  /** The bot as the notification builder needs it (its own mute setting included). */
  bot(botId: string): (Omit<NotifyBot, "threadId"> & { avatarUrl?: string; threadId?: string }) | undefined;
  notify(notification: Notification | null): void;
  /** Ids already announced, persisted next to the dismissed file. */
  notifiedFile: string;
}

function readNotified(file: string): Record<string, number> | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, number> : null;
  } catch {
    return null;
  }
}

function writeNotified(file: string, value: Record<string, number>): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, file);
}

/** One pass: announces what is new in the list. With no record yet, whatever is there already counts as announced. */
export function checkInterruptedNotices(deps: InterruptedNotifierDeps): number {
  const items = collectInterrupted(deps);
  const record = readNotified(deps.notifiedFile);
  const now = deps.now();
  const kept = Object.fromEntries(Object.entries(record ?? {}).filter(([, at]) => at >= now - KEPT_DAYS * 24 * 60 * 60_000));
  if (record === null) {
    writeNotified(deps.notifiedFile, Object.fromEntries(items.map((item) => [item.id, now])));
    return 0;
  }
  const fresh = items.filter((item) => !(item.id in kept));
  if (fresh.length === 0) {
    if (Object.keys(kept).length !== Object.keys(record).length) writeNotified(deps.notifiedFile, kept);
    return 0;
  }
  // Recorded before sending: a crash in between loses one banner rather than repeating it.
  for (const item of fresh) kept[item.id] = now;
  writeNotified(deps.notifiedFile, kept);
  let sent = 0;
  for (const item of fresh) {
    const bot = deps.bot(item.botId);
    if (!bot) continue;
    const threadId = item.threadId || bot.threadId || "";
    const detail = `${item.threadTitle}: ${item.cause}`;
    const base = buildNotification(item.kind === "routine" ? "routine-failed" : "incident", { ...bot, threadId }, threadId, detail, { avatarUrl: bot.avatarUrl });
    if (!base) continue;
    deps.notify({ ...base, title: item.botName });
    sent += 1;
  }
  return sent;
}

export function startInterruptedNotifier(deps: InterruptedNotifierDeps, everyMs = 60_000): () => void {
  const run = () => { try { checkInterruptedNotices(deps); } catch (error) { console.error("[interrupted-notify]", error); } };
  // The first pass waits for the coordinator and routines to load their state.
  const first = setTimeout(run, 20_000);
  const timer = setInterval(run, everyMs);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
