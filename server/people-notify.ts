import type { Notification, NotifyKind } from "../shared/notification.ts";
import { DIRECT_THREAD_PREFIX, normalizePersonEmail, personDisplayName } from "../shared/people.ts";
import { personMentions, type MentionablePerson } from "../shared/person-mention.ts";
import type { BotBudgetState } from "./bot-budgets.ts";

export interface Recipient {
  email?: string;
  admin: boolean;
}

/** Addressed to people, these also go to the workspace admins: they answer for what an agent does when its owner does not. */
const ALSO_TO_ADMINS: ReadonlySet<NotifyKind> = new Set(["approval", "question", "sign-in", "incident", "turn-failed", "routine-failed", "routine-deferred"]);

/** What an agent's owner hears about it; the rest of an agent's news stays with whoever can see the conversation. */
const OWNER_HEARS: ReadonlySet<NotifyKind> = new Set(["approval", "question", "incident", "turn-failed", "routine-failed", "routine-deferred"]);

/** What only the admins hear when nothing names anyone: the workspace's spending, in dollars, and the day's summary across every conversation. */
const ADMINS_ONLY: ReadonlySet<NotifyKind> = new Set(["spend", "daily-digest"]);

export function reaches(notification: Pick<Notification, "kind" | "toPersons">, recipient: Recipient): boolean {
  const list = notification.toPersons;
  if (!list) return recipient.admin || !ADMINS_ONLY.has(notification.kind);
  const email = recipient.email?.trim().toLowerCase();
  if (email && list.includes(email)) return true;
  return recipient.admin && ALSO_TO_ADMINS.has(notification.kind);
}

/** Who a live window is told for a `notify` frame: the same rule as the feed and the pushes. */
export function frameReaches(payload: { notification?: Pick<Notification, "kind" | "toPersons"> } | null | undefined, client: Recipient): boolean {
  const notification = payload?.notification;
  return !notification || reaches(notification, client);
}

/** Who a signed-in session is as a recipient: the address it carries, or nobody in particular. */
export function sessionRecipient(session: { email?: string; scopes: readonly string[] }): Recipient {
  const email = normalizePersonEmail(session.email);
  return { admin: session.scopes.includes("admin"), ...(email ? { email } : {}) };
}

/** The owner's own devices on the machine: their profile address, only while the machine trusts its loopback as the owner. */
export function desktopRecipient(profileEmail: string | undefined, trust: "owner" | "service"): Recipient {
  const email = trust === "owner" ? normalizePersonEmail(profileEmail) : null;
  return { admin: true, ...(email ? { email } : {}) };
}

export function routeToOwner(notification: Notification, owner: string | undefined, alsoThem: readonly string[] = []): Notification {
  if (!owner || notification.toPersons || !OWNER_HEARS.has(notification.kind)) return notification;
  return { ...notification, toPersons: [...new Set([owner.trim().toLowerCase(), ...alsoThem])] };
}

/** Whether a push may go to a session's devices: what the live stream would send that person, nothing more. */
export function pushReaches(
  notification: Pick<Notification, "kind" | "toPersons" | "threadId" | "botId">,
  recipient: Recipient & { guest?: boolean },
  adminOnly: boolean,
  visibleFor: (who: { email?: string; guest?: boolean }) => { thread(threadId: string): boolean; bot(botId: string): boolean },
): boolean {
  if (!reaches(notification, recipient)) return false;
  if (recipient.admin) return true;
  if (adminOnly) return false;
  if (notification.toPersons && notification.threadId.startsWith(DIRECT_THREAD_PREFIX)) return true;
  const visible = visibleFor(recipient);
  return visible.thread(notification.threadId) && (!notification.botId || visible.bot(notification.botId));
}

const EXCERPT = 140;

function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1)}…` : flat;
}

export interface MentionContext {
  threadId: string;
  groupId: string;
  groupName: string;
  /** Who is speaking: a person's name, or an agent's. */
  speaker: string;
  speakerEmail?: string;
  avatarUrl?: string;
  text: string;
  people: readonly MentionablePerson[];
  botNames: readonly string[];
}

/** One notification for each person the text tags, never for whoever wrote it. */
export function personMentionNotifications(context: MentionContext): Notification[] {
  const own = context.speakerEmail?.trim().toLowerCase();
  return personMentions(context.text, context.people, { botNames: context.botNames })
    .filter((mention) => mention.email !== own)
    .map((mention) => ({
      kind: "mention" as const,
      botId: "",
      botName: context.speaker,
      threadId: context.threadId,
      groupId: context.groupId,
      title: `${context.speaker} mencionou você em ${context.groupName}`,
      body: excerptOf(mention.excerpt || context.text),
      toPersons: [mention.email],
      ...(context.avatarUrl ? { avatarUrl: context.avatarUrl } : {}),
    }));
}

export function directMessageNotification(input: { threadId: string; groupId: string; from: MentionablePerson; to: string; text: string }): Notification {
  return {
    kind: "mention",
    botId: "",
    botName: personDisplayName(input.from),
    threadId: input.threadId,
    groupId: input.groupId,
    title: personDisplayName(input.from),
    body: excerptOf(input.text),
    toPersons: [input.to],
  };
}

/** The owner reads a limit in percent and tokens, never what the month cost. */
export function ownerBudgetNotification(
  bot: { id: string; name: string },
  owner: string,
  threadId: string,
  state: Pick<BotBudgetState, "percent">,
  alert: "cap" | "warn",
): Notification {
  return {
    kind: "spend",
    botId: bot.id,
    botName: bot.name,
    threadId,
    title: alert === "cap" ? `${bot.name} chegou ao limite do mês` : `${bot.name} usou ${state.percent}% do limite do mês`,
    body: alert === "cap"
      ? `${bot.name} para até você aumentar o limite nas configurações dele.`
      : `${bot.name} está perto do limite que você definiu para este mês.`,
    toPersons: [owner.trim().toLowerCase()],
  };
}
