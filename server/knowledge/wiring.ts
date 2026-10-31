import { join } from "node:path";

import type { Viewer } from "../bot-visibility.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createDriveRoutes } from "../routes/drive.ts";
import { createKnowledgeInternalRoutes } from "../routes/knowledge-internal.ts";
import { createWikiRoutes } from "../routes/wiki.ts";
import type { KnowledgeActor } from "./actors.ts";
import { accessForBot, accessForViewer, clientsOfConversation, spaceOfConversation, type AccessInputs, type ConversationFacts, type SpaceBot } from "./audience.ts";
import { knowledgeLimitsFromEnv } from "./limits.ts";
import { KnowledgeService } from "./service.ts";

export interface KnowledgeWiringDeps<B extends SpaceBot> {
  dataDir: string;
  env: NodeJS.ProcessEnv;
  /** The live roster of agents. */
  bots: () => readonly B[];
  /** Read once per request, so a roster of many agents costs one look at the settings. */
  internal: () => (bot: B) => boolean;
  viewerFor: (auth: RequestAuth) => Viewer;
  sender: (auth: RequestAuth) => { name: string; id?: string; email?: string } | undefined;
  /** What the server knows about a conversation from its thread: its room's client, the agents in it, and the clients it has been working for. */
  conversation: (threadId: string) => ConversationFacts;
}

export function createKnowledge<B extends SpaceBot>(deps: KnowledgeWiringDeps<B>) {
  const service = new KnowledgeService({ root: join(deps.dataDir, "knowledge"), limits: knowledgeLimitsFromEnv(deps.env) });
  const inputs = (): AccessInputs<B> => ({ bots: deps.bots(), internal: deps.internal(), known: () => service.knownSpaces(), internalPeople: () => service.internalPeople() });
  const http = {
    service,
    access: (auth: RequestAuth) => accessForViewer(deps.viewerFor(auth), inputs()),
    conversationSpace: (threadId: string) => spaceOfConversation(deps.conversation(threadId), inputs()),
    person: (auth: RequestAuth): KnowledgeActor => {
      const sender = deps.sender(auth);
      return { kind: "person", name: sender?.name.trim() || "Admin", ...(sender?.id ? { key: sender.id } : {}), ...(sender?.email ? { email: sender.email } : {}) };
    },
  };
  return {
    service,
    routes: [createDriveRoutes(http), createWikiRoutes(http)],
    internal: createKnowledgeInternalRoutes({
      service,
      requester: (botId, threadId) => {
        const bot = deps.bots().find((candidate) => candidate.id === botId);
        if (!bot) return null;
        return {
          access: accessForBot(botId, inputs(), clientsOfConversation(deps.conversation(threadId))),
          actor: { kind: "bot", id: bot.id, name: bot.name, ...(bot.visibility !== undefined ? { visibility: bot.visibility } : {}) },
        };
      },
    }),
  };
}
