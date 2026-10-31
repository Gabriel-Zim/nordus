import { describe, expect, it } from "vitest";

import { createAutomationDestinations, RESULTS_SUFFIX, WEBHOOK_POST_TITLE, webhookPostThread } from "./automation-destinations.ts";

function fakeStore() {
  const tasks: Array<{ threadId: string; title: string; botId: string }> = [];
  let n = 0;
  return {
    tasks,
    bot: (id: string) => (id === "gerentedeoperacao" ? { id, hidden: false } : undefined) as any,
    createTask: (botId: string, title?: string) => {
      const task = { threadId: `t${++n}`, title: title ?? "", botId };
      tasks.push(task);
      return task as any;
    },
    taskByThread: (botId: string, threadId: string) => tasks.find((task) => task.botId === botId && task.threadId === threadId) as any,
    messagesFor: () => [],
    remove: (threadId: string) => tasks.splice(tasks.findIndex((task) => task.threadId === threadId), 1),
  };
}

describe("a webhook that posts to chat", () => {
  it("keeps one conversation named after it, never a new \"Updates\"", () => {
    const store = fakeStore();
    const trigger: { botId: string; name: string; resultsThreadId?: string } = { botId: "gerentedeoperacao", name: "Vigia" };
    const first = webhookPostThread(store, trigger)!;
    expect(store.tasks).toEqual([{ threadId: first, title: "Vigia", botId: "gerentedeoperacao" }]);
    trigger.resultsThreadId = first;
    // The Vigia reads its answers where it posted: the same conversation every time.
    expect(webhookPostThread(store, trigger)).toBe(first);
    expect(webhookPostThread(store, trigger)).toBe(first);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks.some((task) => task.title === "Updates")).toBe(false);
  });

  it("opens it again only when it was deleted, and names it in Portuguese when the webhook has no name", () => {
    const store = fakeStore();
    const trigger = { botId: "gerentedeoperacao", name: "  ", resultsThreadId: "gone" };
    const again = webhookPostThread(store, trigger)!;
    expect(store.taskByThread("gerentedeoperacao", again).title).toBe(WEBHOOK_POST_TITLE);
    expect(webhookPostThread(store, { botId: "nobody", name: "x" })).toBeUndefined();
  });
});

describe("an automation's results", () => {
  it("go to the bot's own chat, and a chat of their own on a Cloud home reads in Portuguese", () => {
    const store = fakeStore();
    const local = createAutomationDestinations({ store: store as any, mainThread: () => "main", runs: () => [], cloud: null });
    expect(local.routine({ id: "r", name: "Resumo", botId: "gerentedeoperacao" } as any, false)).toEqual({ threadId: "main", main: true });
    expect(local.event({ webhookId: "w", webhookName: "Vigia", botId: "gerentedeoperacao" })).toBe("main");
    expect(store.tasks).toHaveLength(0);

    const cloud = createAutomationDestinations({ store: store as any, mainThread: () => "main", runs: () => [],
      cloud: { owner: "dono", opener: () => "outro", reportFromOthers: () => false, opened: () => {} } });
    const own = cloud.routine({ id: "r", name: "Resumo", botId: "gerentedeoperacao" } as any, false)!;
    expect(store.taskByThread("gerentedeoperacao", own.threadId).title).toBe(`Resumo${RESULTS_SUFFIX}`);
    expect(RESULTS_SUFFIX).toBe(" · Resultados");
  });
});
