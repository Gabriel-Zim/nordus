import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { KnowledgeActor } from "./actors.ts";
import { accessForBot, accessForViewer, type AccessInputs, type ConversationFacts, type SpaceBot } from "./audience.ts";
import { DEFAULT_KNOWLEDGE_LIMITS, type KnowledgeLimits } from "./limits.ts";
import { KnowledgeService } from "./service.ts";
import type { Requester } from "./wire.ts";

export const ana: KnowledgeActor = { kind: "person", name: "Ana", key: "u-ana", email: "ana@zorg.test" };
export const beto: KnowledgeActor = { kind: "person", name: "Beto", key: "u-beto", email: "beto@evergreen.test" };
export const gerentedeoperacao: KnowledgeActor = { kind: "bot", id: "gerentedeoperacao", name: "GerenteDeOperacao" };

export interface TestBot extends SpaceBot {
  internal?: boolean;
}

/** Two internal agents, two client agents, one private to admins, and one that is neither internal nor a client's. */
export const roster: TestBot[] = [
  { id: "gerentedeoperacao", name: "GerenteDeOperacao", internal: true },
  { id: "secret", name: "Secret", internal: true, visibility: "admins" },
  { id: "evergreen-bot", name: "EVERGREEN Bot", client: "evergreen", visibility: { people: ["beto@evergreen.test"] } },
  { id: "fabrikam-bot", name: "Fabrikam Bot", client: "fabrikam", visibility: { people: ["carla@fabrikam.test"] } },
  { id: "loose", name: "Unmarked" },
];

/** The company's agent is shown to ZORG's people only and the client's to the client's, as a shared workspace sets them. */
export const isolated: TestBot[] = roster.map((bot) =>
  bot.id === "gerentedeoperacao" ? { ...bot, visibility: { people: ["@zorg.test"] } } : bot.id === "evergreen-bot" ? { ...bot, visibility: { people: ["@evergreen.test"] } } : bot,
);

export const inputsFor = (bots: readonly TestBot[] = roster, known: () => never[] = () => [], internalPeople: readonly string[] = []): AccessInputs<TestBot> => ({
  bots, internal: (bot) => bot.internal === true, known, internalPeople: () => internalPeople,
});

export const admin = (bots: readonly TestBot[] = roster): Requester => ({ access: accessForViewer({ kind: "all" }, inputsFor(bots)), actor: ana });
export const member = (email: string, actor: KnowledgeActor, bots: readonly TestBot[] = roster, internalPeople: readonly string[] = []): Requester => ({
  access: accessForViewer({ kind: "member", email }, inputsFor(bots, () => [], internalPeople)), actor,
});
export const botAsker = (id: string, bots: readonly TestBot[] = roster, clients: readonly string[] = []): Requester => {
  const bot = bots.find((candidate) => candidate.id === id)!;
  return { access: accessForBot(id, inputsFor(bots), clients), actor: { kind: "bot", id, name: bot.name, ...(bot.visibility !== undefined ? { visibility: bot.visibility } : {}) } };
};

/** Every content file a space keeps on disk and every half-written one: after a refusal nothing of the refused content should be in either. */
export function diskOf(space: { blobs: { root: string } }): { blobs: string[]; staging: string[] } {
  const content = join(space.blobs.root, "blobs");
  const staging = join(space.blobs.root, "tmp");
  return {
    blobs: existsSync(content) ? readdirSync(content).flatMap((bucket) => readdirSync(join(content, bucket))).sort() : [],
    staging: existsSync(staging) ? readdirSync(staging).sort() : [],
  };
}

/** What a test says about its conversations, by thread. A thread nobody described has no room, no agent and no client. */
export type ConversationBook = Map<string, Partial<ConversationFacts>>;

export const lookupIn = (book: ConversationBook) => (threadId: string): ConversationFacts => {
  const known = book.get(threadId);
  return { ...(known?.roomClient ? { roomClient: known.roomClient } : {}), members: known?.members ?? [], named: known?.named ?? [], inherited: known?.inherited ?? [] };
};

export function tempService(limits: Partial<KnowledgeLimits> = {}): { service: KnowledgeService; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "knowledge-test-"));
  const service = new KnowledgeService({ root: join(root, "knowledge"), limits: { ...DEFAULT_KNOWLEDGE_LIMITS, ...limits } });
  return { service, root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export async function* chunksOf(text: string | Uint8Array, size = 7): AsyncGenerator<Uint8Array> {
  const bytes = typeof text === "string" ? Buffer.from(text, "utf8") : text;
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}
