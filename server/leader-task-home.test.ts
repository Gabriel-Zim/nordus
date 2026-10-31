import { describe, expect, it } from "vitest";
import { announceHome, bringFilesHome, homeAnswerTask, homeCard, homePress, openHomeQuestions, peerHome, reportHome, settleCopies, taskHome, type TaskHomeStore } from "./leader-task-home.ts";
import type { Message } from "./store.ts";

const CARD = { v: 1 as const, root: { type: "Card", id: "n1", title: "Lumon · Carrossel", confirm: { label: "Aprovar", action: { type: "aprovar" } } } };

function fixture(teamLead = true) {
  const threads = new Map<string, Message[]>([["home", []], ["task", []], ["other", []], ["untitled", []]]);
  let next = 0;
  const tasks = [
    { threadId: "home", title: "Conversa" },
    { threadId: "task", title: "Lumon · Carrossel", openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", at: 1, threadId: "home" } },
    { threadId: "other", title: "Fabrikam · Post", openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", at: 2, threadId: "home" } },
    { threadId: "untitled", title: "  ", openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", at: 3, threadId: "home" } },
  ];
  const store = {
    bot: (id: string) => (id === "designergrafico" ? { id, name: "DESIGNERGRAFICO", ...(teamLead ? { teamLead: { allow: [], ask: [] } } : {}) } : null),
    taskByThread: (botId: string, threadId: string) => (botId === "designergrafico" ? tasks.find((task) => task.threadId === threadId) : undefined),
    activePath: (threadId: string) => threads.get(threadId) ?? [],
    messagesFor: (threadId: string) => threads.get(threadId) ?? [],
    appendMessage: (threadId: string, message: Omit<Message, "id" | "at">) => {
      const row = { ...message, id: `m${++next}`, at: next } as Message;
      threads.get(threadId)!.push(row);
      return row;
    },
    patchMessage: (threadId: string, messageId: string, patch: Partial<Message>) => {
      const row = threads.get(threadId)!.find((message) => message.id === messageId);
      if (row) Object.assign(row, patch);
      return row ?? null;
    },
  } as unknown as TaskHomeStore;
  const say = (threadId: string, message: Omit<Message, "id" | "at">) => store.appendMessage(threadId, message);
  return { store, threads, say };
}

describe("a leader's own task at home", () => {
  it("copies an open card and the turn's last words home once, and the copy is answered in the task", () => {
    const { store, threads, say } = fixture();
    say("task", { role: "user", kind: "text", text: "pedido" });
    const card = say("task", { role: "bot", kind: "widget", text: "Aprova?", widget: structuredClone(CARD) });
    say("task", { role: "bot", kind: "text", text: "Versão leve pronta.", turnId: "t1" });
    expect(reportHome(store, { botId: "designergrafico", taskThreadId: "task", turnId: "t1", final: true })).toBe("Versão leve pronta.");
    expect(reportHome(store, { botId: "designergrafico", taskThreadId: "task", turnId: "t1", final: true })).toBeUndefined();
    const home = threads.get("home")!;
    expect(home.map((message) => [message.kind, message.fromTask?.messageId])).toEqual([["widget", card.id], ["text", expect.any(String)]]);
    expect(openHomeQuestions(store, "home")).toEqual(["task"]);
    expect(homePress(store, "home", { messageId: home[0]!.id, ref: "confirm", rev: 0 })).toEqual({
      threadId: "task", widgetAction: { messageId: card.id, ref: "confirm", rev: 0 },
    });

    store.patchMessage("task", card.id, { widget: { ...card.widget!, settled: { ref: "confirm", label: "Aprovar", tone: "confirm", at: 9 } } });
    settleCopies(store, "designergrafico", "task", card.id);
    expect(home[0]!.widget!.settled).toMatchObject({ ref: "confirm", label: "Aprovar" });
    expect(openHomeQuestions(store, "home")).toEqual([]);
  });

  it("stops asking at home once the person wrote in the task, or at home", () => {
    const { store, say } = fixture();
    say("task", { role: "user", kind: "text", text: "pedido" });
    say("task", { role: "bot", kind: "widget", text: "Aprova?", widget: structuredClone(CARD) });
    reportHome(store, { botId: "designergrafico", taskThreadId: "task", turnId: "t1", final: true });
    expect(openHomeQuestions(store, "home")).toEqual(["task"]);
    say("task", { role: "user", kind: "text", text: "pode seguir" });
    say("task", { role: "bot", kind: "text", text: "Seguindo.", turnId: "t2" });
    reportHome(store, { botId: "designergrafico", taskThreadId: "task", turnId: "t2", final: true });
    expect(openHomeQuestions(store, "home")).toEqual([]);

    const next = fixture();
    next.say("task", { role: "user", kind: "text", text: "pedido" });
    next.say("task", { role: "bot", kind: "widget", text: "Aprova?", widget: structuredClone(CARD) });
    reportHome(next.store, { botId: "designergrafico", taskThreadId: "task", turnId: "t1", final: true });
    next.say("home", { role: "user", kind: "text", text: "aprovado" });
    expect(homeAnswerTask(next.store, "designergrafico", "home", undefined)).toBe("task");
  });

  it("brings nothing home while work is out with a teammate and nothing is asked, and nothing from a bot that leads no team", () => {
    const { store, threads, say } = fixture();
    say("task", { role: "user", kind: "text", text: "pedido" });
    say("task", { role: "bot", kind: "text", text: "Mira está nisso.", turnId: "t1" });
    expect(reportHome(store, { botId: "designergrafico", taskThreadId: "task", turnId: "t1", final: false })).toBeUndefined();
    expect(threads.get("home")).toEqual([]);

    const plain = fixture(false);
    plain.say("task", { role: "bot", kind: "widget", text: "Aprova?", widget: structuredClone(CARD) });
    expect(taskHome(plain.store, "designergrafico", "task")).toBeUndefined();
    expect(reportHome(plain.store, { botId: "designergrafico", taskThreadId: "task", turnId: "t1", final: true })).toBeUndefined();
  });

  it("with two tasks asking at the same home, typed words go only where they reply, and both keep the home waiting", () => {
    const { store, threads, say } = fixture();
    for (const task of ["task", "other"]) {
      say(task, { role: "user", kind: "text", text: "pedido" });
      say(task, { role: "bot", kind: "widget", text: "Aprova?", widget: structuredClone(CARD) });
      reportHome(store, { botId: "designergrafico", taskThreadId: task, turnId: "t1", final: true });
    }
    expect(openHomeQuestions(store, "home")).toEqual(["other", "task"]);
    expect(homeAnswerTask(store, "designergrafico", "home", undefined)).toBeUndefined();
    const lumon = threads.get("home")!.find((message) => message.fromTask?.threadId === "task" && message.kind === "widget")!;
    expect(homeAnswerTask(store, "designergrafico", "home", lumon.id)).toBe("task");

    say("home", { role: "user", kind: "text", text: "pode seguir", replyToId: lumon.id });
    say("task", { role: "user", kind: "text", text: "pode seguir" });
    expect(openHomeQuestions(store, "home")).toEqual(["other"]);
    expect(homeAnswerTask(store, "designergrafico", "home", undefined)).toBe("other");
  });

  it("brings home the files attached before the card, in order, with the card and the last words", () => {
    const { store, threads, say } = fixture();
    say("task", { role: "user", kind: "text", text: "pedido" });
    const image = (name: string) => ({ kind: "image" as const, path: `/api/attachments/${name}.png`, mime: "image/png", name });
    for (const name of ["01", "02", "03"]) say("task", { role: "bot", kind: "text", text: "", attachments: [image(name)] });
    say("task", { role: "bot", kind: "widget", text: "Aprova?", widget: structuredClone(CARD) });
    say("task", { role: "bot", kind: "text", text: "Pronto para aprovar.", turnId: "t1" });
    expect(reportHome(store, { botId: "designergrafico", taskThreadId: "task", turnId: "t1", final: true })).toBe("Pronto para aprovar.");
    expect(threads.get("home")!.map((message) => message.attachments?.[0]?.path ?? message.kind)).toEqual([
      "/api/attachments/01.png", "/api/attachments/02.png", "/api/attachments/03.png", "widget", "text"]);
  });

  it("brings the files home ahead of a card the task's engine raises, once, and finds that card by its request", () => {
    const { store, threads, say } = fixture();
    say("task", { role: "user", kind: "text", text: "pedido" });
    say("task", { role: "bot", kind: "text", text: "", attachments: [{ kind: "image", path: "/api/attachments/a.png", mime: "image/png" }] });
    bringFilesHome(store, "designergrafico", "task");
    bringFilesHome(store, "designergrafico", "task");
    expect(threads.get("home")!.map((message) => message.attachments?.[0]?.path)).toEqual(["/api/attachments/a.png"]);
    const card = say("home", { role: "bot", kind: "options", card: { title: "q", subtitle: "q", options: [], requestId: "r1", relayFor: { botId: "designergrafico", name: "DESIGNERGRAFICO", threadId: "task", requester: "p1" } } });
    expect(homeCard(store, "designergrafico", "task", "r1")?.id).toBe(card.id);
    expect(homeCard(store, "designergrafico", "other", "r1")).toBeUndefined();
  });

  it("names the task above each card at home: again when another task asked in between, once for cards in a row, never blank", () => {
    const { store, threads, say } = fixture();
    const card = (task: string) => {
      announceHome(store, "designergrafico", task, "DESIGNERGRAFICO");
      say("home", { role: "bot", kind: "options", card: { title: "q", subtitle: task, options: [], requestId: `r-${threads.get("home")!.length}`, relayFor: { botId: "designergrafico", name: "DESIGNERGRAFICO", threadId: task } } });
    };
    say("task", { role: "user", kind: "text", text: "pedido" });
    say("task", { role: "bot", kind: "text", text: "", attachments: [{ kind: "image", path: "/api/attachments/a.png", mime: "image/png" }] });
    card("task");
    card("other");
    card("task");
    card("task");
    card("untitled");
    expect(threads.get("home")!.map((line) => line.text?.startsWith("Sobre") ? line.text : line.attachments ? "arquivo" : `cartão ${line.card!.subtitle}`)).toEqual([
      'Sobre a tarefa "Lumon · Carrossel":', "arquivo", "cartão task",
      'Sobre a tarefa "Fabrikam · Post":', "cartão other",
      'Sobre a tarefa "Lumon · Carrossel":', "cartão task", "cartão task",
      'Sobre a tarefa "DESIGNERGRAFICO":', "cartão untitled",
    ]);
  });
});

describe("work another bot sent", () => {
  const tasks: Record<string, Record<string, { openedBy?: { botId: string; name: string; at: number; threadId: string } }>> = {
    gerentedeoperacao: { "gerentedeoperacao-main": {}, "gerentedeoperacao-own": { openedBy: { botId: "gerentedeoperacao", name: "GerenteDeOperacao", at: 1, threadId: "gerentedeoperacao-main" } } },
    designergrafico: { "designergrafico-work": { openedBy: { botId: "gerentedeoperacao", name: "GerenteDeOperacao", at: 2, threadId: "gerentedeoperacao-own" } }, "designergrafico-room": { openedBy: { botId: "gerentedeoperacao", name: "GerenteDeOperacao", at: 3, threadId: "room" } } },
    editordevideo: { "editordevideo-work": { openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", at: 4, threadId: "designergrafico-work" } } },
  };
  const store = { taskByThread: (botId: string, threadId: string) => tasks[botId]?.[threadId] } as unknown as TaskHomeStore;

  it("asks the person in the conversation of whoever sent it, up the chain", () => {
    expect(peerHome(store, "designergrafico", "designergrafico-work")).toBe("gerentedeoperacao-own");
    expect(peerHome(store, "editordevideo", "editordevideo-work")).toBe("gerentedeoperacao-own");
  });

  it("leaves the person's own conversations, and rooms, where they are", () => {
    expect(peerHome(store, "gerentedeoperacao", "gerentedeoperacao-main")).toBeUndefined();
    expect(peerHome(store, "gerentedeoperacao", "gerentedeoperacao-own")).toBeUndefined();
    expect(peerHome(store, "designergrafico", "designergrafico-room")).toBeUndefined();
  });
});
