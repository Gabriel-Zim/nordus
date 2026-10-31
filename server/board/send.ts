import { randomUUID } from "node:crypto";
import type { ResolvedSender } from "../../shared/wire.ts";
import type { UsageTrigger } from "../usage-ledger.ts";
import type { SendIdentity } from "./directory.ts";
import * as text from "./texts.ts";

export type SendOutcome = { status: "sent" | "queued"; threadId: string } | { status: "skipped"; reason: string };

/** Who the room sees when the mission runner speaks: not the person, and never the owner. */
export const BOARD_SENDER: ResolvedSender = { name: "Nordus", notOwner: true };

/** Board text is never a person's own word, so what a send carries about them is a name, never the administrator stamp. */
function plain(sender: ResolvedSender | undefined): ResolvedSender | undefined {
  if (!sender) return undefined;
  const copy = { ...sender };
  delete copy.admin;
  return copy;
}

export interface BoardSender {
  toBot(input: { botId: string; text: string; sendId: string; identity: SendIdentity }): Promise<SendOutcome>;
  toRoom(input: { groupId: string; threadId: string; text: string; sendId: string; identity: SendIdentity }): Promise<SendOutcome>;
  roomBusy(groupId: string, threadId: string, sendId?: string): boolean;
}

export interface SenderDeps {
  botThread(botId: string): string | undefined;
  roomThreadOwned(groupId: string, threadId: string): boolean;
  acceptDirectSend(input: {
    botId: string; threadId: string; text: string; sendId: string; sender?: ResolvedSender; trigger: UsageTrigger; personPresent: boolean; relayed?: boolean;
  }): Promise<{ queued?: boolean; threadId: string }>;
  roomWorking(groupId: string, threadId: string): boolean;
  roomQueued(groupId: string, threadId: string, sendId: string): boolean;
  shouldQueue(working: boolean): boolean;
  queueRoom(groupId: string, threadId: string, body: string, options: { sendId: string; sender?: ResolvedSender; trigger: UsageTrigger; via?: "api" }): void;
  startRoom(groupId: string, body: string, options: { sendId: string; sender?: ResolvedSender; trigger: UsageTrigger; threadId: string; via?: "api" }): void;
  applyRoomHolds(groupId: string, body: string): void;
  spendBlock(botId?: string): { code: "spend_cap" | "bot_spend_cap"; botName?: string } | null;
}

export function newSendId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "")}`.slice(0, 64);
}

export function spendReason(block: { code: string; botName?: string }): string {
  return block.code === "bot_spend_cap" ? text.reasonBotSpendCap(block.botName ?? "O agente") : text.reasonSpendCap();
}

function refusalReason(error: unknown): string {
  const body = (error as { body?: { error?: unknown } } | null)?.body;
  const message = typeof body?.error === "string" ? body.error : error instanceof Error ? error.message : "";
  return message ? message.slice(0, 300) : "O envio foi recusado.";
}

export function createBoardSender(deps: SenderDeps): BoardSender {
  return {
    async toBot({ botId, text: body, sendId, identity }) {
      const threadId = deps.botThread(botId);
      if (!threadId) return { status: "skipped", reason: "O agente não existe mais." };
      const block = deps.spendBlock(botId);
      if (block) return { status: "skipped", reason: spendReason(block) };
      try {
        const receipt = await deps.acceptDirectSend({
          botId, threadId, text: body, sendId, sender: plain(identity.sender), trigger: identity.trigger, personPresent: identity.personPresent, relayed: true,
        });
        return { status: receipt.queued ? "queued" : "sent", threadId };
      } catch (error) {
        return { status: "skipped", reason: refusalReason(error) };
      }
    },

    async toRoom({ groupId, threadId, text: body, sendId, identity }) {
      if (!deps.roomThreadOwned(groupId, threadId)) return { status: "skipped", reason: "A sala não existe mais." };
      const block = deps.spendBlock();
      if (block) return { status: "skipped", reason: spendReason(block) };
      try {
        deps.applyRoomHolds(groupId, body);
        const working = deps.roomWorking(groupId, threadId);
        if (deps.shouldQueue(working)) {
          deps.queueRoom(groupId, threadId, body, { sendId, sender: plain(identity.sender), trigger: identity.trigger, via: "api" });
          return { status: "queued", threadId };
        }
        deps.startRoom(groupId, body, { sendId, sender: plain(identity.sender), trigger: identity.trigger, threadId, via: "api" });
        return { status: "sent", threadId };
      } catch (error) {
        return { status: "skipped", reason: refusalReason(error) };
      }
    },

    roomBusy(groupId, threadId, sendId) {
      return deps.roomWorking(groupId, threadId) || Boolean(sendId && deps.roomQueued(groupId, threadId, sendId));
    },
  };
}
