interface MainThreadCandidate {
  threadId: string;
  createdAt: number;
  askedAt?: number;
  archivedAt?: number;
  routineRunId?: string;
  openedBy?: { botId: string };
}

export function oldestThread(tasks: readonly MainThreadCandidate[]): string | undefined {
  const visible = tasks.filter((task) => !task.routineRunId);
  const open = visible.filter((task) => task.archivedAt === undefined);
  return (open.length ? open : visible).reduce<MainThreadCandidate | undefined>(
    (oldest, task) => (!oldest || task.createdAt < oldest.createdAt ? task : oldest), undefined,
  )?.threadId;
}

export function wasOldestThread(tasks: readonly MainThreadCandidate[], threadId: string): boolean {
  const saved = tasks.find((task) => task.threadId === threadId && !task.routineRunId);
  return saved !== undefined && !tasks.some((task) => !task.routineRunId && task.archivedAt === undefined && task.createdAt < saved.createdAt);
}

/** Nordus: the person's own conversations first; a thread the bot opened on itself (a parallel line, its own notices,
 * a start_thread job) runs out of sight and is the main one only when nothing else is open; another bot's last. */
export function mainThread(tasks: readonly MainThreadCandidate[], ownerId: string, selectedId?: string): string | undefined {
  const openIn = (list: readonly MainThreadCandidate[]) => list.some((task) => !task.routineRunId && task.archivedAt === undefined);
  const persons = tasks.filter((task) => !task.openedBy);
  const own = tasks.filter((task) => !task.openedBy || task.openedBy.botId === ownerId);
  const pool = openIn(persons) ? persons : openIn(own) ? own : tasks;
  const open = pool.filter((task) => !task.routineRunId && task.archivedAt === undefined);
  const asked = open.reduce<MainThreadCandidate | undefined>(
    (latest, task) => ((task.askedAt ?? -1) > (latest?.askedAt ?? -1) ? task : latest), undefined,
  );
  return asked?.threadId ?? open.find((task) => task.threadId === selectedId)?.threadId ?? oldestThread(pool);
}
