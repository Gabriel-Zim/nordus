import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesk, type DeskDeps } from "./desk.ts";

const bot = { id: "b1", name: "Bot", color: "blue", threadId: "main", taskSessions: true as const };

function fakeStore() {
  const tasks = new Map<string, any>([["main", { threadId: "main", title: "Main" }]]);
  const lines: any[] = [];
  const cards = new Map<string, any[]>();
  let next = 0;
  const store = {
    bot: () => bot,
    botByThread: (id: string) => (tasks.has(id) ? bot : undefined),
    taskByThread: (_b: string, id: string) => tasks.get(id),
    createTask: (_b: string, title: string) => {
      const task = { threadId: `t${++next}`, title };
      tasks.set(task.threadId, task);
      return task;
    },
    patchTask: (_b: string, id: string, patch: object) => Object.assign(tasks.get(id), patch),
    appendMessage: (threadId: string, m: object) => { const line = { id: `m${lines.length}`, threadId, ...m }; lines.push(line); return line; },
    activePath: () => [],
    messagesFor: (id: string) => (cards.get(id) ?? []),
  };
  return { store, tasks, lines, cards };
}

describe("desk without a server", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  const build = (overrides: Partial<DeskDeps> = {}) => {
    const fake = fakeStore();
    const dataDir = mkdtempSync(join(tmpdir(), "desk-unit-"));
    dirs.push(dataDir);
    const queued: any[] = [];
    const startTurn = vi.fn(async () => undefined);
    const desk = createDesk({
      store: fake.store as never, startTurn, threadBusy: () => false, awaitingTeammates: () => false,
      botAtThreadCapacity: () => false, serverAtSessionCapacity: () => false,
      queueSteeredMessage: ((b: string, t: string, text: string, o: object) => { queued.push({ b, t, text, o }); return { id: "q1" }; }) as never,
      queuedThreadPosition: () => 1, hasQueuedSteeredMessages: () => true, decider: {} as never, cfg: {} as never, DATA_DIR: dataDir,
      continueTask: vi.fn() as never, ...overrides,
    });
    return { ...fake, desk, queued, startTurn };
  };
  const withTasks = (b: ReturnType<typeof build>, states: Record<string, string>) => {
    for (const [id, state] of Object.entries(states)) b.tasks.set(id, { threadId: id, title: id, desk: { origin: "main", title: id, state } });
    (b.store as any).bots = [{ ...bot, tasks: [...b.tasks.values()] }];
  };
  const input = { botId: "b1", threadId: "main", text: "Fazer X", trigger: { kind: "user" } as never, personPresent: true };

  it("restore: queued task without its queue entry fails with the restart line; paused re-arms; queued with entry stays", () => {
    const timers: number[] = [];
    const b = build({ hasQueuedSteeredMessages: (_b, t) => t === "kept", setTimer: (ms) => { timers.push(ms); } });
    withTasks(b, { kept: "queued", lost: "queued", paused: "paused", done: "done" });
    b.desk.restore();
    expect(b.tasks.get("kept").desk.state).toBe("queued");
    expect(b.tasks.get("lost").desk.state).toBe("failed");
    expect(b.tasks.get("paused").desk.state).toBe("paused");
    expect(b.tasks.get("done").desk.state).toBe("done");
    expect(timers).toEqual([30 * 60_000]);
    const texts = b.lines.map((l) => l.text);
    expect(texts.filter((t) => t.includes("interrompida por um reinício"))).toEqual(['A tarefa "lost" foi interrompida por um reinício. Responda esta mensagem para retomar.']);
    expect(texts.filter((t) => t.startsWith("Pausei as tarefas"))).toHaveLength(1);
  });

  it("restore: a running task still out with teammates stays running and gets no notice", () => {
    const b = build({ awaitingTeammates: (t) => t === "away" });
    withTasks(b, { away: "running", gone: "running" });
    b.desk.restore();
    expect(b.tasks.get("away").desk.state).toBe("running");
    expect(b.tasks.get("gone").desk.state).toBe("failed");
    expect(b.lines.filter((l) => l.text.includes("interrompida"))).toHaveLength(1);
    expect(b.lines[0].threadRef.threadId).toBe("gone");
  });

  it("a full disk queues the task and says so", async () => {
    const { desk, tasks, lines, queued, startTurn } = build({ diskHasRoom: () => false });
    await desk.handle(bot as never, input);
    expect(startTurn).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    expect(lines.map((l) => l.text)).toEqual(expect.arrayContaining(["Comecei: Fazer X", "Aguardando espaço em disco: Fazer X"]));
    expect(tasks.get("t1").desk).toEqual({ origin: "main", title: "Fazer X", state: "queued" });
  });

  it("pergunta na tarefa avisa o balcão", async () => {
    const { desk, tasks, lines } = build();
    await desk.handle(bot as never, input);
    const before = lines.length;
    desk.questionAsked("t1");
    const notice = lines.slice(before);
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatchObject({
      threadId: "main", role: "bot", kind: "text", text: 'A tarefa "Fazer X" tem uma pergunta para você.',
      from: { botId: "b1" }, threadRef: { botId: "b1", threadId: "t1", title: "Fazer X" },
    });
    // The host marks the task as waiting on the person once the card is up; a second card adds no second notice.
    tasks.get("t1").activity = "waiting-on-you";
    desk.questionAsked("t1");
    expect(lines).toHaveLength(before + 1);
    // Answered (the host sets it back to working): the next question is announced again.
    tasks.get("t1").activity = "working";
    desk.questionAsked("t1");
    expect(lines).toHaveLength(before + 2);
  });

  it("a question outside a desk task says nothing", () => {
    const { desk, lines } = build();
    desk.questionAsked("main");
    expect(lines).toHaveLength(0);
  });

  it("a queued start that fails marks the task failed and tells the desk", async () => {
    const { desk, tasks, lines } = build({ diskHasRoom: () => false });
    await desk.handle(bot as never, input);
    desk.startFailed("b1", "t1");
    expect(tasks.get("t1").desk.state).toBe("failed");
    const last = lines.at(-1);
    expect(last).toMatchObject({ threadId: "main", threadRef: { threadId: "t1" } });
    expect(last.text).toBe('A tarefa "Fazer X" não terminou: não consegui começar. Responda esta mensagem para retomar.');
  });

  it("a setup failure after the task turned running fails it once, even if settled fires too", async () => {
    vi.useFakeTimers();
    try {
      const { desk, tasks, lines } = build();
      await desk.handle(bot as never, input);
      expect(tasks.get("t1").desk.state).toBe("running");
      desk.startFailed("b1", "t1");
      desk.settled("t1", false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(tasks.get("t1").desk.state).toBe("failed");
      expect(lines.filter((l) => l.text?.includes("não terminou"))).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it("a turn start turns a queued task into running", async () => {
    const { desk, tasks } = build({ diskHasRoom: () => false });
    await desk.handle(bot as never, input);
    desk.turnStarted("b1", "t1");
    expect(tasks.get("t1").desk.state).toBe("running");
  });

  it("owns plain messages, but never calls or messages written inside a task", async () => {
    const { desk, tasks } = build();
    await desk.handle(bot as never, input);
    expect(desk.owns(bot, { threadId: "main" })).toBe(true);
    expect(desk.owns(bot, { threadId: "main", via: "call" })).toBe(false);
    expect(desk.owns(bot, { threadId: "main", relayed: true })).toBe(false);
    expect(desk.owns(bot, { threadId: "t1" })).toBe(false);
    expect(desk.owns({ id: "b1" }, { threadId: "main" })).toBe(false);
    expect(tasks.get("t1").desk.origin).toBe("main");
  });

  it("the plan limit pauses the task, queues new ones and resumes at the reset", async () => {
    let fire: () => void = () => {};
    let now = 1_000_000;
    const drain = vi.fn();
    const { desk, tasks, lines, queued, startTurn } = build({ now: () => now, setTimer: (_ms, fn) => { fire = fn; }, drain });
    await desk.handle(bot as never, input);
    tasks.get("t1").desk.state = "running";
    desk.observe({ type: "runtime.error", threadId: "t1", message: "x", retryAt: now + 60_000 } as never);
    expect(desk.planLimitHit("t1", "This Claude account has reached its 5-hour limit")).toBe(true);
    expect(tasks.get("t1").desk.state).toBe("paused");
    expect(lines.filter((l) => l.text?.startsWith("Pausei as tarefas"))).toHaveLength(1);
    expect(desk.planLimitBlocked()).toBe(true);
    startTurn.mockClear();
    await desk.handle(bot as never, { ...input, text: "Fazer Y" });
    expect(startTurn).not.toHaveBeenCalled();
    expect(queued).toHaveLength(1);
    // Only desk threads are held; a thread the desk does not watch is not.
    expect(desk.planLimitHolds("t2")).toBe(true);
    expect(desk.planLimitHolds("elsewhere")).toBe(false);
    // A parallel line of a mode-off bot is watched by the desk but is not a desk task: never held.
    await desk.openLane(bot as never, "main", "Linha paralela", { trigger: { kind: "user" } as never });
    expect(desk.watches("t3")).toBe(true);
    expect(tasks.get("t3").desk).toBeUndefined();
    expect(desk.planLimitHolds("t3")).toBe(false);
    expect(drain).not.toHaveBeenCalled();
    now += 60_000;
    fire();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(desk.planLimitHolds("t2")).toBe(false);
    expect(tasks.get("t1").desk.state).toBe("running");
    expect(startTurn).toHaveBeenCalledWith("b1", expect.stringMatching(/^Continue de onde parou\./), expect.objectContaining({ threadId: "t1" }));
    expect(desk.planLimitBlocked()).toBe(false);
  });

  it("an error that is not the plan limit is left to the host", async () => {
    const { desk } = build();
    await desk.handle(bot as never, input);
    expect(desk.planLimitHit("t1", "connection reset")).toBe(false);
    expect(desk.planLimitHit("main", "usage limit reached")).toBe(false);
  });

  it("a billing or 402 failure is not the plan limit: no pause, no notice", async () => {
    const { desk, tasks, lines } = build();
    await desk.handle(bot as never, input);
    tasks.get("t1").desk.state = "running";
    for (const cause of ["402 Payment Required", "Your subscription billing failed"]) {
      expect(desk.planLimitHit("t1", cause)).toBe(false);
    }
    expect(tasks.get("t1").desk.state).toBe("running");
    expect(lines.some((l) => l.text?.startsWith("Pausei"))).toBe(false);
    expect(desk.planLimitBlocked()).toBe(false);
  });

  it("the question notice carries the clipped question", async () => {
    const { desk, lines } = build();
    await desk.handle(bot as never, input);
    desk.questionAsked("t1", `  ${"Qual cor? ".repeat(60)}`);
    const text = lines.at(-1).text as string;
    expect(text.startsWith('A tarefa "Fazer X" tem uma pergunta para você. Qual cor?')).toBe(true);
    expect(text.length).toBeLessThan(260);
    expect(text.endsWith("…")).toBe(true);
  });

  describe("reply from the desk to a task stopped on a card", () => {
    const setup = async (card: object) => {
      const continueTask = vi.fn(async () => ({ ok: true as const, threadId: "t1", message: {} as never }));
      const b = build({ continueTask: continueTask as never });
      await b.desk.handle(bot as never, input);
      b.tasks.get("t1").activity = "waiting-on-you";
      b.cards.set("t1", [{ id: "c1", card: { requestId: "r1", ...card } }]);
      const before = b.lines.length;
      const reply = { botId: "b1", threadId: "main", text: "azul", trigger: { kind: "user" } as never, personPresent: true, replyTo: { id: "n1", threadRef: { botId: "b1", threadId: "t1", title: "Fazer X" } } as never };
      return { ...b, continueTask, reply, before };
    };

    it("a reply to a waiting task posts the pointer: card stays unanswered, nothing answers it, no turn in the task", async () => {
      const t = await setup({ requestType: "question", options: [] });
      const receipt = await t.desk.handle(bot as never, t.reply);
      expect(t.continueTask).not.toHaveBeenCalled();
      expect(t.startTurn).toHaveBeenCalledTimes(1); // only the task's own opening turn
      expect(receipt).toMatchObject({ ok: true, threadId: "main" });
      expect(t.lines.slice(t.before).map((l) => l.text)).toEqual(["azul", 'Essa pergunta precisa ser respondida na conversa da tarefa "Fazer X".']);
      expect(t.cards.get("t1")![0].card.answered).toBeUndefined();
    });

    it("an approve/deny card gets the same pointer, card left open", async () => {
      const t = await setup({ requestType: "permission", tool: "Bash", options: ["Allow", "Deny"] });
      await t.desk.handle(bot as never, t.reply);
      expect(t.continueTask).not.toHaveBeenCalled();
      expect(t.lines.at(-1)).toMatchObject({ role: "bot", text: 'Essa pergunta precisa ser respondida na conversa da tarefa "Fazer X".' });
      expect(t.cards.get("t1")![0].card.answered).toBeUndefined();
    });

    it("without an open card the reply continues the task as before", async () => {
      const t = await setup({ answered: "answer" });
      await t.desk.handle(bot as never, t.reply);
      expect(t.continueTask).toHaveBeenCalledTimes(1);
    });
  });

  it("a reply to a message whose thread is not a desk task of this bot opens a new task", async () => {
    const continueTask = vi.fn();
    const b = build({ continueTask: continueTask as never });
    b.tasks.set("plain", { threadId: "plain", title: "Plain" });
    b.tasks.set("other", { threadId: "other", title: "O", desk: { origin: "main", title: "O", state: "done" } });
    for (const ref of [{ botId: "b1", threadId: "plain", title: "Plain" }, { botId: "b2", threadId: "other", title: "O" }]) {
      await b.desk.handle(bot as never, { ...input, replyTo: { id: "n", threadRef: ref } as never });
    }
    expect(continueTask).not.toHaveBeenCalled();
    expect([...b.tasks.keys()].filter((k) => k.startsWith("t"))).toEqual(["t1", "t2"]);
  });

  describe("disk floor on drain", () => {
    it("holds a queued desk task while the disk is low, re-checks on a timer, releases when space returns", async () => {
      let room = false;
      const timers: Array<() => void> = [];
      let clockNow = 1_000;
      const drain = vi.fn();
      const b = build({ diskHasRoom: () => room, now: () => clockNow, setTimer: (_ms, fn) => { timers.push(fn); }, drain });
      await b.desk.handle(bot as never, input);
      expect(b.desk.holds("t1")).toBe(true);
      expect(b.desk.holds("t1")).toBe(true);
      expect(timers).toHaveLength(1);
      room = true;
      expect(b.desk.holds("t1")).toBe(true); // reading cached for a few seconds
      clockNow += 6_000;
      expect(b.desk.holds("t1")).toBe(false);
      timers[0]!();
      expect(drain).toHaveBeenCalledTimes(1);
      expect(b.desk.holds("main")).toBe(false); // not a desk task
    });

    it("holds when either the bot cwd or the data dir is below the floor", async () => {
      const b = build({ diskHasRoom: (path) => path !== "/data-low" });
      (bot as any).cwd = "/data-low";
      try { expect(b.desk.holds("main")).toBe(false); await b.desk.handle(bot as never, input); expect(b.desk.holds("t1")).toBe(true); } finally { delete (bot as any).cwd; }
    });
  });

  it("a plan-limit pause queues new tasks with the pause line, not the slot line", async () => {
    const b = build({ now: () => 1_000_000, setTimer: () => {} });
    withTasks(b, { q: "paused" }); // restore re-opens the window for a paused task
    b.desk.restore();
    await b.desk.handle(bot as never, input);
    expect(b.lines.map((l) => l.text)).toContain("Pausado pelo limite do plano: Fazer X. Tento retomar em 30 minutos.");
    expect(b.lines.map((l) => l.text).some((t) => t.startsWith("Aguardando vaga"))).toBe(false);
  });

  it("delivers the answer before cleanup and survives a cleanup that cannot remove the folder", async () => {
    vi.useFakeTimers();
    try {
      const b = build();
      await b.desk.handle(bot as never, input);
      b.tasks.get("t1").desk.state = "running";
      b.store.activePath = () => [{ role: "bot", kind: "text", text: "pronto" }] as never;
      // A regular file where the task folder's parent should be makes rmSync fail with ENOTDIR.
      const tmp = join(dirs[dirs.length - 1]!, "task-tmp");
      writeFileSync(tmp, "x");
      b.desk.settled("t1", true);
      expect(() => vi.advanceTimersByTime(600)).not.toThrow();
      expect(b.tasks.get("t1").desk.state).toBe("done");
      expect(b.lines.at(-1).text).toContain("pronto");
    } finally { vi.useRealTimers(); }
  });

  it("a reset time from an earlier, recovered turn is dropped when that turn settles", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000_000_000);
      const timers: number[] = [];
      const b = build({ now: () => Date.now(), setTimer: (ms) => { timers.push(ms); } });
      await b.desk.handle(bot as never, input);
      b.tasks.get("t1").desk.state = "running";
      b.desk.observe({ type: "runtime.error", threadId: "t1", retryAt: Date.now() + 3_600_000 } as never);
      b.desk.observe({ type: "turn.completed", threadId: "t1", ok: true } as never);
      vi.advanceTimersByTime(600);
      b.tasks.get("t1").desk.state = "running";
      expect(b.desk.planLimitHit("t1", "usage limit reached")).toBe(true);
      expect(timers).toEqual([30 * 60_000]);
    } finally { vi.useRealTimers(); }
  });
});
