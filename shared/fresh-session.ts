/** Nordus: how long a bot's conversation may sit idle before its next turn starts a fresh provider session. */
export const MAX_FRESH_SESSION_IDLE_MINUTES = 10_080;

export function validFreshSessionIdleMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_FRESH_SESSION_IDLE_MINUTES;
}

/** The conversation's last activity is older than the bot's limit. Without a limit or without any earlier activity: false. */
export function freshSessionDue(input: { idleMinutes: number | undefined; lastActivityAt: number | undefined; now: number }): boolean {
  const { idleMinutes, lastActivityAt, now } = input;
  if (!validFreshSessionIdleMinutes(idleMinutes) || lastActivityAt === undefined || !Number.isFinite(lastActivityAt)) return false;
  return now - lastActivityAt > idleMinutes * 60_000;
}

/** Epoch ms of the newest message in the conversation other than the ones this turn is made of. */
export function lastConversationActivityAt(messages: ReadonlyArray<{ id: string; at: number }>, excludedIds: ReadonlySet<string>): number | undefined {
  let latest: number | undefined;
  for (const m of messages) {
    if (excludedIds.has(m.id) || !Number.isFinite(m.at)) continue;
    if (latest === undefined || m.at > latest) latest = m.at;
  }
  return latest;
}
