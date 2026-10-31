import { describe, expect, it } from "vitest";
import { botOpensTo } from "./thread-navigation";

describe("picking a bot that is showing a routine run", () => {
  const bot = {
    threadId: "run", mainThreadId: "main",
    tasks: [{ threadId: "run", routineRunId: "r1" }, { threadId: "main" }],
  } as unknown as Parameters<typeof botOpensTo>[0];

  it("goes back to its main conversation, with threads shown or not", () => {
    expect(botOpensTo(bot, false)).toBe("main");
    expect(botOpensTo(bot, true)).toBe("main");
  });

  it("keeps an ordinary thread open when threads are shown", () => {
    expect(botOpensTo({ ...bot, threadId: "other", tasks: [...(bot.tasks ?? []), { threadId: "other" }] } as typeof bot, true)).toBe("other");
  });
});
