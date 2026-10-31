import type { KnowledgeSpaceId, WireKnowledgeSpace } from "../../shared/knowledge.ts";
import { CLIENT_SLUG } from "../../shared/wire.ts";
import { audienceWithin, viewerSees, type Viewer } from "../bot-visibility.ts";
import type { KnowledgeActor } from "./actors.ts";

export const INTERNAL_SPACE: KnowledgeSpaceId = "internal";

export function clientSpace(slug: unknown): KnowledgeSpaceId | null {
  return typeof slug === "string" && CLIENT_SLUG.test(slug) ? `client:${slug}` : null;
}

export function parseSpace(value: unknown): KnowledgeSpaceId | null {
  if (value === INTERNAL_SPACE) return INTERNAL_SPACE;
  return typeof value === "string" && value.startsWith("client:") ? clientSpace(value.slice("client:".length)) : null;
}

export function describeSpace(id: KnowledgeSpaceId): WireKnowledgeSpace {
  return id === INTERNAL_SPACE ? { id, kind: "internal" } : { id, kind: "client", client: id.slice("client:".length) };
}

/** Relative folder under the knowledge root. A client name is a validated slug, so it can never climb out. */
export function spaceFolder(id: KnowledgeSpaceId): string {
  return id === INTERNAL_SPACE ? "internal" : `clients/${id.slice("client:".length)}`;
}

export interface SpaceBot {
  id: string;
  name: string;
  client?: string;
  visibility?: unknown;
}

/** A bot with a client works in that client's space only, internal or not. An internal bot without one works in the company's. Any other bot has no space. */
export function spaceOfBot(bot: { client?: string }, internal: boolean): KnowledgeSpaceId | null {
  if (bot.client !== undefined && bot.client !== "") return clientSpace(bot.client);
  return internal ? INTERNAL_SPACE : null;
}

export interface AccessInputs<B extends SpaceBot = SpaceBot> {
  bots: readonly B[];
  internal: (bot: B) => boolean;
  /** Spaces that already hold something. An admin sees them even when no bot points to them any more. */
  known?: () => readonly KnowledgeSpaceId[];
  /** The addresses an admin opened the company's space to. Without one on the list, that space is for admins alone. */
  internalPeople?: () => readonly string[];
}

export interface KnowledgeAccess {
  readonly admin: boolean;
  spaces(): KnowledgeSpaceId[];
  allows(space: KnowledgeSpaceId): boolean;
  /** Whether what this author wrote may be shown to the asker. */
  sees(actor: KnowledgeActor): boolean;
  /** Why an asker who has no space at all has none, in words they can pass on. */
  readonly closed?: string;
}

const MORE_THAN_ONE_CLIENT = "This conversation works for more than one client, so the Drive and the Wiki stay closed here. Ask in a room or a chat about a single client.";
const DIFFERENT_PLACES = "The agents in this conversation work in different places, so there is no single Drive to use here.";

/** The space an agent's turn works in. A client's agent keeps its client. A company agent follows the clients the conversation is about: none is the company's, one is that client's, several are nowhere. */
export function spaceOfTurn(bot: { client?: string }, internal: boolean, clients: readonly string[]): { space: KnowledgeSpaceId | null; closed?: string } {
  if (!internal) return { space: spaceOfBot(bot, false) };
  const about = [...new Set([...(bot.client ? [bot.client] : []), ...clients])];
  if (about.length > 1) return { space: null, closed: MORE_THAN_ONE_CLIENT };
  return { space: about.length === 0 ? INTERNAL_SPACE : clientSpace(about[0]) };
}

/** What the server knows about a conversation from its thread. */
export interface ConversationFacts {
  /** The client a room is for, whatever its agents are. */
  roomClient?: string;
  /** The agents in it: a room's members, or the one agent of a chat. */
  members: readonly string[];
  /** Clients the conversation has been recorded as working for. */
  named: readonly string[];
  /** Clients a delegated turn inherits from whoever asked for it. */
  inherited: readonly string[];
}

/** A room's own client alone; otherwise every client the conversation was named for or inherited, so a mix is never narrowed to one of them. */
export function clientsOfConversation(facts: ConversationFacts): string[] {
  return facts.roomClient ? [facts.roomClient] : [...new Set([...facts.inherited, ...facts.named])];
}

/** Where a file from this conversation may be saved: the one space every agent in it works in, or nowhere. */
export function spaceOfConversation<B extends SpaceBot>(facts: ConversationFacts, inputs: AccessInputs<B>): { space: KnowledgeSpaceId | null; closed?: string } {
  if (facts.roomClient) return { space: clientSpace(facts.roomClient) };
  const clients = clientsOfConversation(facts);
  const byId = new Map(inputs.bots.map((bot) => [bot.id, bot]));
  const turns = facts.members.flatMap((id) => {
    const bot = byId.get(id);
    return bot ? [spaceOfTurn(bot, inputs.internal(bot), clients)] : [];
  });
  const first = turns[0];
  if (!first?.space) return first?.closed ? { space: null, closed: first.closed } : { space: null };
  return turns.every((turn) => turn.space === first.space) ? { space: first.space } : { space: null, closed: DIFFERENT_PLACES };
}

function order(spaces: Iterable<KnowledgeSpaceId>): KnowledgeSpaceId[] {
  const unique = [...new Set(spaces)];
  return unique.sort((a, b) => (a === INTERNAL_SPACE ? -1 : b === INTERNAL_SPACE ? 1 : a.localeCompare(b)));
}

/** An admin sees every space, the company's even when it is empty. Anyone else sees the spaces of the clients whose agents they can see, and the company's only when an admin named them. */
export function accessForViewer<B extends SpaceBot>(viewer: Viewer, inputs: AccessInputs<B>): KnowledgeAccess {
  const admin = viewer.kind === "all";
  const byId = new Map(inputs.bots.map((bot) => [bot.id, bot]));
  const email = viewer.kind === "member" ? viewer.email?.trim().toLowerCase() : undefined;
  const opened = Boolean(email) && (inputs.internalPeople?.() ?? []).some((entry) => entry.trim().toLowerCase() === email);
  const spaces = admin
    ? order([INTERNAL_SPACE, ...(inputs.known?.() ?? []), ...inputs.bots.flatMap((bot) => spaceOfBot(bot, inputs.internal(bot)) ?? [])])
    : order([
        ...(opened ? [INTERNAL_SPACE] : []),
        ...inputs.bots.filter((bot) => viewerSees(viewer, bot.visibility)).flatMap((bot) => {
          const space = spaceOfBot(bot, inputs.internal(bot));
          return space && space !== INTERNAL_SPACE ? [space] : [];
        }),
      ]);
  const allowed = new Set(spaces);
  return {
    admin,
    spaces: () => [...spaces],
    allows: (space) => allowed.has(space),
    sees: (actor) => {
      if (admin || actor.kind === "person") return true;
      const author = byId.get(actor.id);
      return viewerSees(viewer, author ? author.visibility : actor.visibility);
    },
  };
}

/** A bot works in the space of its turn, and reads only what everyone who can see it could also see its author say: the rule for bots that talk to each other. */
export function accessForBot<B extends SpaceBot>(botId: string, inputs: AccessInputs<B>, clients: readonly string[] = []): KnowledgeAccess {
  const byId = new Map(inputs.bots.map((bot) => [bot.id, bot]));
  const self = byId.get(botId);
  const turn = self ? spaceOfTurn(self, inputs.internal(self), clients) : { space: null };
  const space = turn.space;
  return {
    admin: false,
    ...("closed" in turn && turn.closed ? { closed: turn.closed } : {}),
    spaces: () => (space ? [space] : []),
    allows: (candidate) => space !== null && candidate === space,
    sees: (actor) => {
      if (actor.kind === "person") return true;
      if (!self) return false;
      if (actor.id === self.id) return true;
      const author = byId.get(actor.id);
      return audienceWithin(self.visibility, author ? author.visibility : actor.visibility);
    },
  };
}
