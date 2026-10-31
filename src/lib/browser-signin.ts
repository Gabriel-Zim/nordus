import type { ComputerHelpRef } from "../../shared/wire";
import { signInOutcome } from "../../shared/sign-in-request";
import { visibleMessages, type Bot } from "@/state/store";

/**
 * The sign-in the bot waits for in its own browser, from wherever the request came: the computer's help request, or the
 * bot's latest open sign-in card in the chat. A settled, stopped or replaced card asks for nothing.
 */
export function pendingBrowserSignIn(bot: Pick<Bot, "id" | "threadId" | "messages" | "activeLeafId"> | undefined, help: ComputerHelpRef | null | undefined): ComputerHelpRef | null {
  if (help?.place === "browser") return help;
  if (!bot?.messages) return null;
  const messages = visibleMessages(bot);
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const card = message.signIn;
    if (message.kind !== "signin" || !card) continue;
    if (card.place !== "browser" || signInOutcome(card) || card.superseded === true || (card as { stopped?: boolean }).stopped === true) return null;
    return { botId: bot.id, threadId: bot.threadId, messageId: message.id, site: card.site, place: "browser" };
  }
  return null;
}
