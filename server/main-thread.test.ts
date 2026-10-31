import { describe, expect, it } from "vitest";

import { mainThread, oldestThread, wasOldestThread } from "./main-thread.ts";

const first = { threadId: "first", createdAt: 1 };
const later = { threadId: "later", createdAt: 2 };
const latest = { threadId: "latest", createdAt: 3 };

describe("a bot's main thread", () => {
  it("is the open thread a person last wrote in, wherever the selection is", () => {
    const tasks = [{ ...latest, askedAt: 10 }, { ...later, askedAt: 30 }, { ...first, askedAt: 20 }];
    expect(mainThread(tasks, "ada", "first")).toBe("later");
    expect(mainThread(tasks, "ada")).toBe("later");
  });

  it("is never a routine run or an archived thread, however recently written in", () => {
    const tasks = [
      { ...latest, askedAt: 50, routineRunId: "run" },
      { ...later, askedAt: 40, archivedAt: 41 },
      { ...first, askedAt: 10 },
    ];
    expect(mainThread(tasks, "ada", "later")).toBe("first");
  });

  it("is the selected thread before anyone writes, while that is an open conversation", () => {
    expect(mainThread([latest, later, first], "ada", "later")).toBe("later");
    expect(mainThread([latest, { ...later, archivedAt: 5 }, first], "ada", "later")).toBe("first");
    expect(mainThread([{ ...latest, routineRunId: "run" }, later, first], "ada", "latest")).toBe("first");
    expect(mainThread([latest, later, first], "ada", "deleted")).toBe("first");
  });

  it("is never a work thread another bot opened while the bot has an open conversation of its own", () => {
    const work = { ...latest, openedBy: { botId: "designergrafico" } };
    expect(mainThread([work, later, first], "ada", "latest")).toBe("first");
    expect(mainThread([work, later, first], "ada", "later")).toBe("later");
    expect(mainThread([{ ...work, askedAt: 90 }, later, first], "ada", "latest")).toBe("first");
    expect(mainThread([{ ...work, askedAt: 90 }, { ...later, askedAt: 5 }, first], "ada")).toBe("later");
  });

  it("is a thread the bot opened on itself only when the person has no open conversation", () => {
    // Nordus: a parallel line or a start_thread job runs hidden; reports and posts never land there.
    const own = { ...latest, openedBy: { botId: "ada" } };
    expect(mainThread([own, later, first], "ada", "latest")).toBe("first");
    expect(mainThread([{ ...own, askedAt: 9 }, later, first], "ada")).toBe("first");
    expect(mainThread([{ ...own, askedAt: 9 }, { ...later, archivedAt: 3 }], "ada")).toBe("latest");
    expect(mainThread([own, { ...later, openedBy: { botId: "designergrafico" } }], "ada", "later")).toBe("latest");
  });

  it("falls back to the bot-opened threads when they are all the bot has open", () => {
    const work = { ...latest, openedBy: { botId: "designergrafico" } };
    const older = { ...later, openedBy: { botId: "designergrafico" } };
    expect(mainThread([work, older], "ada", "latest")).toBe("latest");
    expect(mainThread([work, older], "ada")).toBe("later");
    expect(mainThread([work, { ...first, archivedAt: 4 }], "ada", "latest")).toBe("latest");
    expect(mainThread([{ ...work, routineRunId: "run" }, { ...first, archivedAt: 4 }], "ada", "latest")).toBe("first");
  });

  it("is the oldest archived thread when every thread is archived, and nothing without threads", () => {
    expect(mainThread([{ ...latest, archivedAt: 9, askedAt: 9 }, { ...later, archivedAt: 8 }], "ada", "latest")).toBe("later");
    expect(mainThread([{ ...first, routineRunId: "run" }], "ada")).toBeUndefined();
    expect(mainThread([], "ada")).toBeUndefined();
  });
});

describe("the oldest thread", () => {
  it("is the oldest open conversation, else the oldest archived one, never a routine run", () => {
    expect(oldestThread([latest, later, { ...first, routineRunId: "run" }])).toBe("later");
    expect(oldestThread([latest, { ...first, archivedAt: 4 }])).toBe("latest");
    expect(oldestThread([{ ...latest, archivedAt: 6 }, { ...later, archivedAt: 5 }])).toBe("later");
  });
});

describe("a thread saved on a routine as the oldest one", () => {
  it("is a conversation no open thread is older than, open still or archived since", () => {
    expect(wasOldestThread([latest, later, first], "first")).toBe(true);
    expect(wasOldestThread([latest, later, { ...first, archivedAt: 9 }], "first")).toBe(true);
    expect(wasOldestThread([latest, { ...later, archivedAt: 9 }, { ...first, archivedAt: 8 }], "later")).toBe(true);
    expect(wasOldestThread([latest, later, first], "later")).toBe(false);
    expect(wasOldestThread([latest, { ...later, archivedAt: 9 }, first], "later")).toBe(false);
    expect(wasOldestThread([latest, later, { ...first, routineRunId: "run" }], "later")).toBe(true);
    expect(wasOldestThread([latest, { ...later, routineRunId: "run" }], "later")).toBe(false);
    expect(wasOldestThread([latest, later], "deleted")).toBe(false);
  });
});
