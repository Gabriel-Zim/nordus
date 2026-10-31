import type { BoardActor, BoardPerson } from "../../shared/board.ts";
import type { Notification } from "../../shared/notification.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { Viewer } from "../bot-visibility.ts";
import { canActOnPeer, canReachTeammate, type RosterMember } from "../peer-roster.ts";
import type { RequestAuth } from "../request-auth.ts";
import { cleanPersonName } from "../sender-label.ts";
import type { UsageRow, UsageTrigger } from "../usage-ledger.ts";
import { ANONYMOUS, type BoardBot, type BoardDirectory, type BoardRoom, type BotCaller, type PersonCaller, type Seen, type SendIdentity } from "./directory.ts";
import type { BoardHost } from "./feature.ts";
import { createBoardSender, type SenderDeps } from "./send.ts";

interface BotFact extends Pick<RosterMember, "section" | "chiefOfStaff" | "managedSections" | "peers" | "openTo" | "visibility"> {
  id: string;
  name: string;
  threadId: string;
  hidden?: boolean;
  client?: string;
}

/** What the request that is speaking for an agent allows: whether it still holds the agent's conversation, whether a person reviews its messages, and how many more rooms this turn may open. */
export interface BotCapability {
  active: boolean;
  peerReview: boolean;
  claimRoom(): boolean;
}

interface GroupFact {
  id: string;
  name: string;
  threadId: string;
  memberIds: readonly string[];
}

export interface BoardPrimitives {
  dataDir: string;
  desktopManaged: boolean;
  store: {
    readonly bots: readonly BotFact[];
    bot(id: string): BotFact | undefined | null;
    group(id: string): GroupFact | undefined | null;
    groupByThread(threadId: string): GroupFact | undefined | null;
    botByThread(threadId: string): BotFact | undefined | null;
  };
  isInternal(bot: BotFact): boolean;
  /** The key that tells one signed-in session's person from another's when none has an email. */
  actorKey(auth: RequestAuth): string | undefined;
  owner(): { name?: string; email?: string } | undefined;
  allowList(): { admins: readonly string[]; members: readonly string[] };
  sessionEmails(): string[];
  viewerFor(auth: RequestAuth): Viewer;
  visibleTo(viewer: Viewer): Seen;
  messageSender(auth: RequestAuth, options?: { room?: boolean }): ResolvedSender | undefined;
  usageTriggerFor(auth: RequestAuth): UsageTrigger;
  broadcast(payload: Record<string, unknown>): void;
  logNotification(notification: Notification): unknown;
  createChannel(value: unknown): { id: string; threadId: string };
  readUsage(range: { from: Date; to: Date }): UsageRow[];
  spendCheck(botId?: string): void;
  sender: Omit<SenderDeps, "spendBlock">;
}

export interface BoardWiring {
  host: BoardHost;
  dir: BoardDirectory;
  callerFor(auth: RequestAuth): PersonCaller;
  /** The id a live stream filters by: the lowercased email, else the session's own key. */
  viewerIdFor(auth: RequestAuth): string | undefined;
  botCallerFor(bot: BotFact, threadId: string, capability?: BotCapability): BotCaller;
}

const NO_CAPABILITY: BotCapability = { active: false, peerReview: true, claimRoom: () => false };

export function bucketOf(bot: BotFact, internal: boolean): string {
  if (internal) return "internal";
  const client = bot.client?.trim().toLowerCase();
  return client ? `client:${client}` : `open:${bot.id}`;
}

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export function createBoardWiring(p: BoardPrimitives): BoardWiring {
  const toBot = (bot: BotFact): BoardBot => ({
    id: bot.id,
    name: bot.name,
    threadId: bot.threadId,
    bucket: bucketOf(bot, p.isInternal(bot)),
    ...(bot.hidden ? { hidden: true } : {}),
  });
  const toRoom = (group: GroupFact): BoardRoom => ({ id: group.id, name: group.name, threadId: group.threadId, memberIds: group.memberIds });
  const dir: BoardDirectory = {
    bot: (id) => {
      const bot = p.store.bot(id);
      return bot ? toBot(bot) : undefined;
    },
    bots: () => p.store.bots.map(toBot),
    room: (id) => {
      const group = p.store.group(id);
      return group ? toRoom(group) : undefined;
    },
    roomOfThread: (threadId) => {
      const group = p.store.groupByThread(threadId);
      return group ? toRoom(group) : undefined;
    },
    botOfThread: (threadId) => {
      const bot = p.store.botByThread(threadId);
      return bot ? toBot(bot) : undefined;
    },
  };

  const people = (): BoardPerson[] => {
    const known = new Map<string, BoardPerson>();
    const owner = p.owner();
    const ownerEmail = owner?.email?.trim().toLowerCase();
    if (ownerEmail) known.set(ownerEmail, { id: ownerEmail, ...(owner?.name ? { name: owner.name } : {}) });
    const allow = p.allowList();
    for (const entry of [...allow.admins, ...allow.members, ...p.sessionEmails()]) {
      const email = entry.trim().toLowerCase();
      if (EMAIL.test(email) && !known.has(email)) known.set(email, { id: email });
    }
    return [...known.values()];
  };

  const identityFor = (actor: BoardActor): SendIdentity => {
    if (actor.kind === "bot") return { trigger: { kind: "bot", botId: actor.id }, personPresent: false };
    if (actor.kind === "system") return { trigger: { kind: "owner" }, personPresent: false };
    const owner = p.owner();
    const ownerEmail = owner?.email?.trim().toLowerCase();
    if (actor.id === "owner" || actor.id === ownerEmail) {
      const name = owner?.name?.trim() || actor.name;
      return { sender: name ? { name, ...(owner?.email ? { email: owner.email } : {}) } : undefined, trigger: { kind: "owner" }, personPresent: true };
    }
    const name = actor.name?.trim() || actor.id.split("@")[0]!;
    if (!actor.id.includes("@")) return { sender: { name, notOwner: true }, trigger: { kind: "user", label: name }, personPresent: true };
    return { sender: { name, email: actor.id, notOwner: true }, trigger: { kind: "user", email: actor.id }, personPresent: true };
  };

  const spendBlock = (botId?: string): { code: "spend_cap" | "bot_spend_cap"; botName?: string } | null => {
    try {
      p.spendCheck(botId);
      return null;
    } catch (error) {
      const code = (error as { code?: unknown }).code === "bot_spend_cap" ? "bot_spend_cap" : "spend_cap";
      const botName = botId ? p.store.bot(botId)?.name : undefined;
      return { code, ...(botName ? { botName } : {}) };
    }
  };

  const sender = createBoardSender({ ...p.sender, spendBlock });

  const host: BoardHost = {
    dataDir: p.dataDir,
    dir,
    sender,
    people,
    broadcast: p.broadcast,
    notify: (notification) => p.broadcast({ kind: "notify", notification: p.logNotification(notification) }),
    createRoom: ({ name, memberIds, leadBotId, bulletin, section }) => {
      const group = p.createChannel({
        name: redactSecretsInText(name),
        memberIds,
        ...(section ? { section } : {}),
        setup: { bulletin: redactSecretsInText(bulletin), defaultResponder: { kind: "member", botId: leadBotId } },
      });
      return { groupId: group.id, threadId: group.threadId };
    },
    usage: (from, to) => p.readUsage({ from: new Date(from), to: new Date(to) }).map((row) => ({
      botId: row.botId, botName: row.botName, threadId: row.threadId, input: row.input, output: row.output, costUsd: row.costUsd,
    })),
    identityFor,
    spendBlock: (botId) => spendBlock(botId),
    seenBy: (email) => p.visibleTo({ kind: "member", ...(email ? { email } : {}) }),
  };

  const emailOf = (auth: RequestAuth) => (auth.kind === "session" ? auth.session.email?.trim().toLowerCase() || undefined : undefined);

  return {
    host,
    dir,
    callerFor(auth) {
      const viewer = p.viewerFor(auth);
      const email = emailOf(auth);
      const sender = p.messageSender(auth, { room: true });
      const admin = viewer.kind === "all";
      const id = email ?? (admin ? p.owner()?.email?.trim().toLowerCase() || "owner" : p.actorKey(auth) ?? ANONYMOUS);
      const name = sender?.name ? cleanPersonName(sender.name) : "";
      return {
        kind: "person",
        actor: { kind: "person", id, ...(name ? { name } : {}) },
        admin,
        ...(email ? { email } : {}),
        seen: p.visibleTo(viewer),
        identity: { sender, trigger: p.usageTriggerFor(auth), personPresent: auth.kind === "session" || p.desktopManaged },
      };
    },
    viewerIdFor: (auth) => emailOf(auth) ?? p.actorKey(auth),
    botCallerFor(bot, threadId, capability = NO_CAPABILITY) {
      const other = (id: string) => p.store.bot(id) ?? undefined;
      return {
        kind: "bot",
        actor: { kind: "bot", id: bot.id, name: bot.name },
        bot: toBot(bot),
        threadId,
        reaches: (target) => {
          const peer = other(target);
          return Boolean(peer && canActOnPeer(bot, peer));
        },
        chief: Boolean(bot.chiefOfStaff && !bot.hidden && capability.active),
        peerReview: capability.peerReview,
        ...(bot.section ? { section: bot.section } : {}),
        teammate: (target) => {
          const peer = other(target);
          return Boolean(peer && canReachTeammate(bot, peer));
        },
        claimRoom: capability.claimRoom,
      };
    },
  };
}
