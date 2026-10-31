import type { Notification, NotifyKind } from "../shared/notification.ts";
import { personMentionExcerpt, personMentions, type MentionablePerson } from "../shared/person-mention.ts";

export type { Notification, NotifyKind } from "../shared/notification.ts";

export function summarize(text: string, max = 140): string {
  const line = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export interface NotifyBot {
  id: string;
  name: string;
  threadId: string;
  notifications?: boolean;
}

export function buildSpendNotification(
  bot: Pick<NotifyBot, "id" | "name">,
  threadId: string,
  text: { title: string; body: string },
): Notification {
  return { kind: "spend", botId: bot.id, botName: bot.name, threadId, title: text.title, body: summarize(text.body, 200) };
}

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("pt-BR") + text.slice(1);

/** The banner's title is the app speaking, so it is in Portuguese; the body stays as the bot wrote it. An approval
 * names what it authorizes only from a Portuguese phrase made for people (`action`), never from the engine's summary. */
function notificationTitle(kind: NotifyKind, who: string, action: string | undefined, site?: string): string {
  switch (kind) {
    case "approval": {
      const asked = summarize(action ?? "", 100).replace(/[.:;]+$/, "");
      return asked ? `${who} precisa de você: autorizar ${lowerFirst(asked)}` : `${who} precisa da sua aprovação`;
    }
    case "question": return `${who} tem uma pergunta`;
    case "sign-in": return `${who} precisa que você entre em ${site ?? "um site"}`;
    case "routine-failed": return `A rotina de ${who} falhou`;
    case "routine-deferred": return `A rotina de ${who} está esperando`;
    case "turn-failed": return `${who} não conseguiu começar`;
    case "incident": return `${who} encontrou um problema`;
    case "delegation-settled": return `${who} voltou com os resultados`;
    case "mention": return `${who} mencionou você`;
    default: return `${who} terminou`;
  }
}

export function buildNotification(
  kind: NotifyKind,
  bot: NotifyBot,
  threadId: string,
  detail: string,
  extra?: { avatarUrl?: string; group?: { id: string; name: string }; site?: string; requestId?: string; action?: string },
): Notification | null {
  if (bot.notifications === false) return null;

  const body = summarize(detail);
  const who = extra?.group ? `${bot.name} em ${extra.group.name}` : bot.name;
  const title = notificationTitle(kind, who, extra?.action, extra?.site);

  if ((kind === "done" || kind === "mention") && !body) return null;

  const notification: Notification = { kind, botId: bot.id, botName: bot.name, threadId, title, body };
  if (extra?.avatarUrl) notification.avatarUrl = extra.avatarUrl;
  if (extra?.group) notification.groupId = extra.group.id;
  if (extra?.requestId) notification.requestId = extra.requestId;
  return notification;
}

type MentionSource = {
  activePath(threadId: string): readonly { role: string; kind: string; text?: string; turnId?: string; from?: { botId: string } }[];
  bot(id: string): { name: string; hidden?: boolean } | null | undefined;
};

type MentionRoom = { id: string; name: string; dm?: boolean; memberIds: readonly string[] };
type MentionTurn = { threadId: string; turnId?: string; reply: string };

function replyTexts(source: MentionSource, bot: Pick<NotifyBot, "id">, turn: MentionTurn): string[] {
  return turn.turnId
    ? source.activePath(turn.threadId).filter((m) => m.role === "bot" && m.kind === "text" && m.turnId === turn.turnId && m.from?.botId === bot.id).map((m) => m.text ?? "")
    : [turn.reply];
}

function rosterNames(source: MentionSource, room: MentionRoom): string[] {
  return room.memberIds.flatMap((id) => {
    const member = source.bot(id);
    return member && !member.hidden ? [member.name] : [];
  });
}

/** One notification for each person a bot's settled reply tags by name, to that person alone. */
export function buildPersonMentionNotifications(
  source: MentionSource,
  bot: Omit<NotifyBot, "threadId"> & { avatarUrl?: string },
  room: MentionRoom,
  turn: MentionTurn,
  people: readonly MentionablePerson[],
): Notification[] {
  if (room.dm || !people.length) return [];
  const botNames = rosterNames(source, room);
  const found = new Map<string, Notification>();
  for (const text of replyTexts(source, bot, turn)) {
    for (const mention of personMentions(text, people, { botNames })) {
      if (found.has(mention.email)) continue;
      const base = buildNotification("mention", { ...bot, threadId: turn.threadId }, turn.threadId, mention.excerpt, { avatarUrl: bot.avatarUrl, group: room });
      if (base) found.set(mention.email, { ...base, toPersons: [mention.email] });
    }
  }
  return [...found.values()];
}

export function buildMentionNotification(
  source: MentionSource,
  bot: Omit<NotifyBot, "threadId"> & { avatarUrl?: string },
  room: MentionRoom,
  turn: MentionTurn & { profileName?: string },
): Notification | null {
  if (room.dm) return null;
  const texts = replyTexts(source, bot, turn);
  const botNames = rosterNames(source, room);
  for (const text of texts) {
    const excerpt = personMentionExcerpt(text, { profileName: turn.profileName, botNames });
    if (excerpt) return buildNotification("mention", { ...bot, threadId: turn.threadId }, turn.threadId, excerpt, { avatarUrl: bot.avatarUrl, group: room });
  }
  return null;
}
