import { describe, expect, it } from "vitest";

import type { Bot, Message } from "@/state/store";
import { pendingBrowserSignIn } from "./browser-signin";

const card = (over: Record<string, unknown> = {}): Message => ({
  id: "card-1", role: "bot", kind: "signin", at: 1,
  signIn: { url: "https://x.com/login", site: "x.com", place: "browser", ...over },
} as Message);
const bot = (messages: Message[]) => ({ id: "pepper", threadId: "t1", messages, activeLeafId: null }) as unknown as Pick<Bot, "id" | "threadId" | "messages" | "activeLeafId">;

describe("pendingBrowserSignIn", () => {
  it("takes the computer's own help request first", () => {
    const help = { botId: "pepper", threadId: "t1", messageId: "m", site: "x.com", place: "browser" as const };
    expect(pendingBrowserSignIn(bot([]), help)).toBe(help);
  });

  it("finds the bot's open sign-in card in the chat when there is no help request", () => {
    expect(pendingBrowserSignIn(bot([card()]), null)).toEqual({ botId: "pepper", threadId: "t1", messageId: "card-1", site: "x.com", place: "browser" });
  });

  it("asks for nothing once the card is done, cancelled, replaced or stopped, or when it is for another place", () => {
    for (const settled of [{ done: true }, { cancelled: true }, { superseded: true }, { stopped: true }, { place: "vm" }]) {
      expect(pendingBrowserSignIn(bot([card(settled)]), null)).toBeNull();
    }
    expect(pendingBrowserSignIn(bot([card(), card({ done: true })].map((message, index) => ({ ...message, id: `c${index}` }))), null)).toBeNull();
    expect(pendingBrowserSignIn(undefined, null)).toBeNull();
  });
});
