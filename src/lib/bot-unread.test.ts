import { describe, expect, it } from "vitest";
import { botShowsUnread, hiddenUnreadThreads } from "./bot-unread";

const main = { threadId: "main", unread: false };
const delegated = { threadId: "work", unread: true, openedBy: { botId: "diretor" } };
const email = { threadId: "email", unread: true };

describe("the bot's unread dot", () => {
  it("is not lit by a request another bot opened here, unless it waits for the person", () => {
    expect(botShowsUnread({ tasks: [main, delegated] })).toBe(false);
    expect(botShowsUnread({ tasks: [main, { ...delegated, activity: "waiting-on-you" }] })).toBe(true);
  });

  it("is lit by an unread side conversation the list does not show", () => {
    expect(botShowsUnread({ tasks: [main, email] })).toBe(true);
  });

  it("lists the hidden unread side conversations that opening the bot reads, keeping one that waits", () => {
    const waiting = { threadId: "approval", unread: true, activity: "waiting-on-you" };
    expect(hiddenUnreadThreads({ tasks: [{ ...main, unread: true }, delegated, email, waiting] }, "main")).toEqual(["work", "email"]);
    // Opened on a side conversation (a notification), the main one stays as it is: it is the bot's own row.
    expect(hiddenUnreadThreads({ mainThreadId: "main", tasks: [{ ...main, unread: true }, email] }, "email")).toEqual([]);
  });
});
