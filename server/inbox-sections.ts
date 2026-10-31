// Nordus: the inbox page's three lists. What waits on the person is the approvals index's; what was sent to them and what
// came before are cut out of the notification feed, by who may see each.
import type { ApprovalItem, InboxNote, InboxSections } from "../shared/approvals.ts";
import type { NotificationLogEntry } from "../shared/notification.ts";

const FOR_YOU_LIMIT = 30;
const BEFORE_LIMIT = 50;
/** The spend alert and the day's summary name money and the bots and rooms of every client, and are filed under one bot's conversation. */
const ADMIN_ONLY_KINDS: ReadonlySet<string> = new Set(["spend", "daily-digest"]);

export interface InboxViewer {
  email?: string;
  admin: boolean;
  visible: { bot(id: string): boolean; thread(id: string): boolean; group(id: string): boolean };
}

function note(entry: NotificationLogEntry): InboxNote {
  return {
    id: entry.id,
    at: entry.at,
    kind: entry.kind,
    botId: entry.botId,
    botName: entry.botName,
    threadId: entry.threadId,
    ...(entry.groupId ? { groupId: entry.groupId } : {}),
    title: entry.title,
    body: entry.body,
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    read: entry.read,
    ...(entry.resolvedAt !== undefined ? { resolvedAt: entry.resolvedAt } : {}),
  };
}

export function inboxSections(input: {
  waiting: readonly ApprovalItem[];
  log: readonly NotificationLogEntry[];
  viewer: InboxViewer;
}): InboxSections {
  const { viewer } = input;
  const email = viewer.email?.trim().toLowerCase();
  const open = new Set(input.waiting.flatMap((item) => (item.requestId ? [item.requestId] : [])));
  const forYou: InboxNote[] = [];
  const before: InboxNote[] = [];
  for (const entry of [...input.log].sort((a, b) => b.at - a.at)) {
    if (!viewer.visible.bot(entry.botId) || !viewer.visible.thread(entry.threadId)) continue;
    if (entry.groupId && !viewer.visible.group(entry.groupId)) continue;
    if (ADMIN_ONLY_KINDS.has(entry.kind) && !viewer.admin) continue;
    if (entry.requestId && open.has(entry.requestId)) continue;
    const addressed = entry.toPersons?.map((person) => person.toLowerCase());
    if (addressed) {
      if (email && addressed.includes(email) && forYou.length < FOR_YOU_LIMIT) forYou.push(note(entry));
    } else if (before.length < BEFORE_LIMIT) {
      before.push(note(entry));
    }
  }
  return { waiting: [...input.waiting], forYou, before };
}
