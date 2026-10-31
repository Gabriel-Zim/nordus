import { promptWithDataContext } from "../../shared/data-context.ts";
import type { SteerQueueReason } from "../../shared/wire.ts";
import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { Decider } from "../decider/index.ts";
import { deciderReady } from "../decider/index.ts";
import { appendDeciderLog, stateHash } from "../decider/log.ts";
import { decideTaskLane, laneResult, laneTitle, laneWork, MAX_PARALLEL_LANES } from "../decider/task-lanes.ts";
import type { DataContext } from "../data-context.ts";
import { redactSecretsInText } from "../redact.ts";
import type { BotRecord, Message, Store } from "../store.ts";
import { classifyTurnError } from "../../shared/turn-error.ts";
import { extractTurnImages } from "../turn-images.ts";
import type { queueSteeredMessage } from "../steer-queue.ts";
import type { UsageTrigger } from "../usage-ledger.ts";
import { taskHome } from "../leader-task-home.ts";
import { diskHasRoom as defaultDiskHasRoom } from "./capacity.ts";
import { createPlanLimit, PLAN_LIMIT_RESUME_TEXT } from "./plan-limit.ts";
import { routeDeskMessage } from "./route.ts";
import { cleanupTaskTmp, taskShortId } from "./workspace.ts";

type Sender = Message["sender"];

export type DirectSendReceipt =
  | { ok: true; threadId: string; message: Message; steered?: true }
  | { ok: true; queued: true; queueId: string; threadId: string; reason?: SteerQueueReason };

export type DeskInput = {
  botId: string;
  threadId: string;
  text: string;
  sendId?: string;
  replyTo?: Message;
  sender?: Sender;
  trigger: UsageTrigger;
  dataContext?: DataContext;
  via?: "call";
  callId?: string;
  personPresent: boolean;
};

export interface DeskDeps {
  store: Store;
  startTurn: (botId: string, text: string, opts: { threadId: string; sender?: Sender; trigger?: UsageTrigger; dataContext?: DataContext; onTurnSettled?: () => void }) => Promise<unknown>;
  threadBusy: (botId: string, threadId: string) => boolean;
  awaitingTeammates: (threadId: string) => boolean;
  botAtThreadCapacity: (botId: string) => boolean;
  serverAtSessionCapacity: () => boolean;
  queueSteeredMessage: typeof queueSteeredMessage;
  queuedThreadPosition: (botId: string, threadId: string) => number | null;
  /** Whether the task still has a message waiting in the persisted queue. */
  hasQueuedSteeredMessages: (botId: string, threadId: string) => boolean;
  decider: Decider;
  cfg: Parameters<typeof deciderReady>[0];
  DATA_DIR: string;
  /** The ordinary send path, entered again for a task so a continued message steers or resumes it. */
  continueTask: (input: DeskInput) => Promise<DirectSendReceipt>;
  /** Room on disk for another task; defaults to the real check. */
  diskHasRoom?: (path: string) => boolean;
  /** Clock and timer for the plan-limit pause; default to the real ones. */
  now?: () => number;
  setTimer?: (ms: number, fn: () => void) => void;
  /** Sends the queue again; called when the plan-limit window ends and while the disk is held. */
  drain?: () => void;
}

/** How long one reading of the disk is trusted when the queue asks again. */
const DISK_READING_MS = 5_000;
/** While a task waits for disk space, the queue is looked at again this often. */
const DISK_RETRY_MS = 60_000;

const QUESTION_NOTICE_CHARS = 200;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

type DeskState = NonNullable<NonNullable<ReturnType<Store["taskByThread"]>>["desk"]>["state"];

/** The desk (balcão): every new message of a taskSessions bot opens its own task; results come back here.
 *  Bots with the mode off keep the earlier parallel line, which lives here too. */
export function createDesk(deps: DeskDeps) {
  const { store, DATA_DIR } = deps;
  const diskHasRoom = deps.diskHasRoom ?? defaultDiskHasRoom;
  /** Parallel lines running per bot (mode off), each with the conversation its answer goes back to. */
  const lanes = new Map<string, { botId: string; originThreadId: string; title: string }>();
  /** Threads whose last turn ended in failure, read when the delivery timer fires. */
  const failedTurns = new Set<string>();
  /** When the plan limit said it resets (epoch ms), by thread, from the error event until the turn settles. */
  const limitResets = new Map<string, number>();
  const clock = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((ms: number, fn: () => void) => { setTimeout(fn, ms).unref?.(); });
  const readings = new Map<string, { at: number; ok: boolean }>();
  /** Room at both places a task lives: its folder (cwd) and the temp folder under the data directory. */
  const roomFor = (bot: BotRecord, fresh: boolean): boolean => [bot.cwd ?? DATA_DIR, DATA_DIR].every((path) => {
    const seen = readings.get(path);
    if (!fresh && seen && clock() - seen.at < DISK_READING_MS) return seen.ok;
    const ok = diskHasRoom(path);
    readings.set(path, { at: clock(), ok });
    return ok;
  });
  let diskRetry = false;
  /** A desk task waits in the queue while the disk is below the floor, however the queue got drained. */
  function diskHolds(threadId: string): boolean {
    const bot = store.botByThread(threadId);
    if (!bot || !store.taskByThread(bot.id, threadId)?.desk || roomFor(bot, false)) return false;
    if (!diskRetry) { diskRetry = true; setTimer(DISK_RETRY_MS, () => { diskRetry = false; deps.drain?.(); }); }
    return true;
  }
  const speaker = (bot: BotRecord) => ({ botId: bot.id, name: bot.name, color: bot.color });

  async function chooseLane(bot: BotRecord, threadId: string, text: string): Promise<"continue" | "queue" | "parallel" | null> {
    if (!deciderReady(deps.cfg, "taskLanes")) return null;
    const { ask, update } = laneWork(store.activePath(threadId));
    const task = store.taskByThread(bot.id, threadId);
    const picked = await decideTaskLane(deps.decider, {
      bot: bot.name,
      currentWork: redactSecretsInText(`${task?.title ? `${task.title}: ` : ""}${ask ?? ""}`),
      ...(update ? { recent: redactSecretsInText(update) } : {}),
      message: redactSecretsInText(extractTurnImages(text).text),
    });
    if (picked) {
      appendDeciderLog(DATA_DIR, { at: new Date().toISOString(), seam: "taskLanes", provider: "jev", ok: true, choice: `lane:${picked.choice}`, pTop: picked.probability, margin: null, latencyMs: 0, stateHash: stateHash(threadId) });
    }
    return picked?.choice ?? null;
  }

  /** A new conversation of the same bot for the message; null when the bot has no room for another line. */
  async function openLane(
    bot: BotRecord,
    originThreadId: string,
    text: string,
    options: { replyTo?: Message; sendId?: string; sender?: Sender; trigger: UsageTrigger; dataContext?: DataContext },
  ): Promise<DirectSendReceipt | null> {
    const running = [...lanes.values()].filter((lane) => lane.botId === bot.id).length;
    if (running >= MAX_PARALLEL_LANES || deps.botAtThreadCapacity(bot.id)) return null;
    const title = laneTitle(extractTurnImages(text).text);
    const task = store.createTask(bot.id, title, false);
    if (!task) return null;
    // The person's words stay where they wrote them; the work runs in the new conversation.
    const message = store.appendMessage(originThreadId, {
      role: "user", kind: "text", text, replyToId: options.replyTo?.id, sendId: options.sendId,
      ...(options.dataContext ? { dataContext: options.dataContext } : {}), sender: options.sender,
    });
    store.appendMessage(originThreadId, {
      role: "bot", kind: "activity", from: speaker(bot),
      tool: { name: `Comecei em paralelo: ${title}`, ok: true },
    });
    lanes.set(task.threadId, { botId: bot.id, originThreadId, title });
    try {
      await deps.startTurn(bot.id, text, {
        threadId: task.threadId, sender: options.sender, trigger: options.trigger,
        ...(options.dataContext ? { dataContext: options.dataContext } : {}), onTurnSettled: () => settled(task.threadId),
      });
    } catch {
      lanes.delete(task.threadId);
      return null;
    }
    return { ok: true as const, threadId: originThreadId, message };
  }

  const setState = (botId: string, threadId: string, state: DeskState) => {
    const desk = store.taskByThread(botId, threadId)?.desk;
    if (desk && desk.state !== state) store.patchTask(botId, threadId, { desk: { ...desk, state } });
  };

  async function openTask(bot: BotRecord, input: DeskInput): Promise<DirectSendReceipt> {
    const { threadId: origin, text, replyTo, sendId, sender, trigger, dataContext } = input;
    const title = laneTitle(extractTurnImages(text).text);
    const task = store.createTask(bot.id, title, false);
    if (!task) throw Object.assign(new Error("no such bot"), { status: 404 });
    const taskThreadId = task.threadId;
    const threadRef = { botId: bot.id, threadId: taskThreadId, title };
    store.patchTask(bot.id, taskThreadId, { desk: { origin, title, state: "queued" } });
    const message = store.appendMessage(origin, {
      role: "user", kind: "text", text, replyToId: replyTo?.id, sendId, threadRef,
      ...(dataContext ? { dataContext } : {}), sender,
    });
    const say = (line: string) => store.appendMessage(origin, { role: "bot", kind: "text", text: line, from: speaker(bot), threadRef });
    if (replyTo?.threadRef) {
      store.appendMessage(origin, { role: "bot", kind: "text", from: speaker(bot), text: `A tarefa "${replyTo.threadRef.title || "anterior"}" não existe mais. Abri uma nova.` });
    }
    say(`Comecei: ${title}`);
    const shortId = taskShortId(taskThreadId);
    const prompt = `${text}\n\n(Tarefa ${shortId}: inclua "${shortId}" no nome da pasta do pedido.)`;
    const receipt = { ok: true as const, threadId: origin, message };
    const wait = (why: "slot" | "disk" | "pause") => {
      const queued = deps.queueSteeredMessage(bot.id, taskThreadId, text, {
        reason: "capacity", prompt: promptWithDataContext(prompt, dataContext), dataContext, sender, trigger,
      });
      setState(bot.id, taskThreadId, "queued");
      say(why === "disk" ? `Aguardando espaço em disco: ${title}` : why === "pause" ? planLimit.pauseLine(title)! : `Aguardando vaga: ${title} (posição ${deps.queuedThreadPosition(bot.id, taskThreadId) ?? 1})`);
      return queued;
    };
    if (!roomFor(bot, true)) { wait("disk"); return receipt; }
    if (planLimit.blocked()) { wait("pause"); return receipt; }
    if (deps.botAtThreadCapacity(bot.id) || deps.serverAtSessionCapacity()) { wait("slot"); return receipt; }
    setState(bot.id, taskThreadId, "running");
    try {
      await deps.startTurn(bot.id, prompt, { threadId: taskThreadId, sender, trigger, ...(dataContext ? { dataContext } : {}) });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "thread_busy" || code === "thread_limit") { wait("slot"); return receipt; }
      setState(bot.id, taskThreadId, "failed");
      cleanupTaskTmp(DATA_DIR, bot.id, taskThreadId);
      say(failureLine(title, "não consegui começar"));
    }
    return receipt;
  }

  /** Paused tasks come back by themselves at the reset, with one notice per desk. */
  const planLimit = createPlanLimit({
    now: clock,
    setTimer,
    resume: (threadId) => {
      const bot = store.botByThread(threadId);
      if (!bot || store.taskByThread(bot.id, threadId)?.desk?.state !== "paused") return;
      setState(bot.id, threadId, "running");
      deps.startTurn(bot.id, PLAN_LIMIT_RESUME_TEXT, { threadId, trigger: { kind: "bot", botId: bot.id } }).catch(() => startFailed(bot.id, threadId));
    },
    drain: deps.drain,
    notify: (text, origins) => {
      for (const origin of origins) {
        const bot = store.botByThread(origin);
        if (bot && store.taskByThread(bot.id, origin)) store.appendMessage(origin, { role: "bot", kind: "text", from: speaker(bot), text });
      }
    },
  });

  /** The failed turn ended on the plan limit of a desk task: pause it. True when the desk took it, so the host skips the quota card. */
  function planLimitHit(threadId: string, cause: string): boolean {
    const bot = store.botByThread(threadId);
    const desk = bot && store.taskByThread(bot.id, threadId)?.desk;
    if (!bot || !desk || (desk.state !== "running" && desk.state !== "paused") || (classifyTurnError(cause)?.class !== "usage-limit")) return false;
    const resetsAt = limitResets.get(threadId);
    limitResets.delete(threadId);
    failedTurns.delete(threadId);
    setState(bot.id, threadId, "paused");
    planLimit.onLimit(threadId, desk.origin, resetsAt ? Math.floor(resetsAt / 1000) : null);
    return true;
  }

  const watches = (threadId: string) => lanes.has(threadId) || Boolean(store.botByThread(threadId) && store.taskByThread(store.botByThread(threadId)!.id, threadId)?.desk);

  /** Every runtime event: remembers when the limit resets and reports each finished turn to `settled`. */
  function observe(event: RuntimeEvent): void {
    if (event.type === "runtime.error" && event.retryAt && watches(event.threadId)) limitResets.set(event.threadId, event.retryAt);
    else if (event.type === "turn.completed" && watches(event.threadId)) settled(event.threadId, event.ok);
  }

  const failureLine = (title: string, why: string) => `A tarefa "${title}" não terminou: ${why}. Responda esta mensagem para retomar.`;
  const restartLine = (title: string) => `A tarefa "${title}" foi interrompida por um reinício. Responda esta mensagem para retomar.`;

  /** Boot, after the queue is restored: nothing is busy now, so no desk task may stay claiming to run. A running task is
   *  failed and announced (a reply resumes it); a paused one waits out the window again; a queued one keeps its place,
   *  unless its queue entry is gone, which would leave it waiting forever. */
  function restore(): void {
    for (const bot of store.bots) {
      for (const task of (bot.tasks ?? [])) {
        const desk = task.desk;
        if (!desk) continue;
        if (desk.state === "paused") { planLimit.onLimit(task.threadId, desk.origin, null); continue; }
        if (desk.state === "running" && (deps.threadBusy(bot.id, task.threadId) || deps.awaitingTeammates(task.threadId))) continue;
        const lost = desk.state === "queued" && !deps.hasQueuedSteeredMessages(bot.id, task.threadId);
        if (desk.state !== "running" && !lost) continue;
        setState(bot.id, task.threadId, "failed");
        cleanupTaskTmp(DATA_DIR, bot.id, task.threadId);
        if (!store.taskByThread(bot.id, desk.origin)) continue;
        store.appendMessage(desk.origin, {
          role: "bot", kind: "text", from: speaker(bot), threadRef: { botId: bot.id, threadId: task.threadId, title: desk.title }, text: restartLine(desk.title),
        });
      }
    }
  }

  /** A reply from the desk to a task stopped on a card: the desk never answers it (who may answer is decided in the task's
   *  conversation) and never steers into the blocked turn. The reply is kept and the card stays open. */
  function pointToCard(bot: BotRecord, taskThreadId: string, input: DeskInput, title: string): DirectSendReceipt {
    const threadRef = { botId: bot.id, threadId: taskThreadId, title };
    const message = store.appendMessage(input.threadId, {
      role: "user", kind: "text", text: input.text, replyToId: input.replyTo?.id, sendId: input.sendId, threadRef,
      ...(input.dataContext ? { dataContext: input.dataContext } : {}), sender: input.sender,
    });
    store.appendMessage(input.threadId, { role: "bot", kind: "text", from: speaker(bot), threadRef, text: `Essa pergunta precisa ser respondida na conversa da tarefa "${title}".` });
    return { ok: true as const, threadId: input.threadId, message };
  }

  async function continueTask(bot: BotRecord, taskThreadId: string, input: DeskInput): Promise<DirectSendReceipt> {
    const task = store.taskByThread(bot.id, taskThreadId);
    if (taskThreadId !== input.threadId && task?.activity === "waiting-on-you") {
      const card = store.messagesFor(taskThreadId).findLast((m) => m.card?.requestId && !m.card.answered && !m.card.dismissed && !m.card.expired);
      if (card) return pointToCard(bot, taskThreadId, input, task.desk?.title ?? task.title ?? "");
    }
    // The ordinary path starts or steers the turn; the task turns "running" when that turn really starts.
    const receipt = await deps.continueTask({ ...input, threadId: taskThreadId, replyTo: undefined, sendId: undefined });
    if (taskThreadId === input.threadId) return receipt;
    const threadRef = { botId: bot.id, threadId: taskThreadId, title: task?.desk?.title ?? task?.title ?? "" };
    const message = store.appendMessage(input.threadId, {
      role: "user", kind: "text", text: input.text, replyToId: input.replyTo?.id, sendId: input.sendId, threadRef,
      ...(input.dataContext ? { dataContext: input.dataContext } : {}), sender: input.sender,
    });
    if ("queued" in receipt) return receipt;
    return { ok: true as const, threadId: input.threadId, message, ...(receipt.steered ? { steered: true as const } : {}) };
  }

  async function handle(bot: BotRecord, input: DeskInput): Promise<DirectSendReceipt> {
    const route = routeDeskMessage({
      thread: store.taskByThread(bot.id, input.threadId) ?? null,
      threadId: input.threadId,
      replyTo: input.replyTo,
      taskExists: (id) => {
        const task = store.taskByThread(bot.id, id);
        return Boolean(task?.desk && !task.archivedAt && input.replyTo?.threadRef?.botId === bot.id);
      },
    });
    return route.action === "continue" ? continueTask(bot, route.taskThreadId, input) : openTask(bot, input);
  }

  /** The answer goes home only when the work is really done: no turn running and nothing out with teammates, so a
   *  hand-off to the Revisor brings back the final text, not the "I sent it for review" line. */
  function settled(threadId: string, ok?: boolean): void {
    if (ok === false) failedTurns.add(threadId);
    else if (ok === true) failedTurns.delete(threadId);
    setTimeout(() => {
      limitResets.delete(threadId);
      const lane = lanes.get(threadId);
      if (lane) return deliverLane(threadId, lane);
      const bot = store.botByThread(threadId);
      const task = bot && store.taskByThread(bot.id, threadId);
      const desk = task?.desk;
      if (!bot || !task || !desk || (desk.state !== "running" && desk.state !== "paused")) return;
      if (planLimit.paused(threadId) || deps.threadBusy(bot.id, threadId) || deps.awaitingTeammates(threadId)) return;
      const failed = failedTurns.delete(threadId);
      const threadRef = { botId: bot.id, threadId, title: desk.title };
      const answer = store.activePath(threadId).findLast((m) => m.role === "bot" && m.kind === "text" && m.text)?.text;
      setState(bot.id, threadId, failed ? "failed" : "done");
      // The person gets the answer first: a folder that will not go must never cost them the delivery.
      if (store.taskByThread(bot.id, desk.origin)) store.appendMessage(desk.origin, {
        role: "bot", kind: "text", from: speaker(bot), threadRef,
        text: failed ? failureLine(desk.title, "o robô parou antes de terminar") : laneResult(desk.title, answer),
      });
      cleanupTaskTmp(DATA_DIR, bot.id, threadId);
    }, 500);
  }

  function deliverLane(threadId: string, lane: { botId: string; originThreadId: string; title: string }): void {
    if (deps.threadBusy(lane.botId, threadId) || deps.awaitingTeammates(threadId)) return;
    lanes.delete(threadId);
    const bot = store.bot(lane.botId);
    if (!bot || (!store.taskByThread(bot.id, lane.originThreadId) && !store.groupByThread(lane.originThreadId))) return;
    // A team leader's own task already copies its last words home (reportHome): never twice.
    if (taskHome(store, bot.id, threadId)) return;
    const answer = store.activePath(threadId).findLast((m) => m.role === "bot" && m.kind === "text" && m.text)?.text;
    store.appendMessage(lane.originThreadId, { role: "bot", kind: "text", text: laneResult(lane.title, answer), from: speaker(bot) });
  }

  /** The desk takes a message when the bot has the mode on, it is not a call, it was not written inside a task, and nobody relayed it (a board card goes straight to the bot's own conversation). */
  const owns = (bot: { id: string; taskSessions?: boolean }, input: { threadId: string; via?: string; relayed?: boolean }) =>
    bot.taskSessions === true && !input.via && !input.relayed && !store.taskByThread(bot.id, input.threadId)?.desk;

  /** A turn of a desk task really starts: it is running now, whatever it was (queued, delivered, failed). */
  const turnStarted = (botId: string, threadId: string) => setState(botId, threadId, "running");

  /** A start that never produced a turn (queued, or failed in setup after the task turned running): no completion will come, so say it here. */
  function startFailed(botId: string, threadId: string): void {
    const bot = store.bot(botId);
    const desk = store.taskByThread(botId, threadId)?.desk;
    if (!bot || !desk || (desk.state !== "queued" && desk.state !== "running")) return;
    setState(botId, threadId, "failed");
    cleanupTaskTmp(DATA_DIR, botId, threadId);
    if (!store.taskByThread(botId, desk.origin)) return;
    store.appendMessage(desk.origin, {
      role: "bot", kind: "text", from: speaker(bot), threadRef: { botId, threadId, title: desk.title }, text: failureLine(desk.title, "não consegui começar"),
    });
  }

  /** A desk task's bot put a question or approval card in the task conversation, so the task is stopped on the person.
   *  Called before the host marks the task "waiting-on-you": that mark is the open card, and it clears when the card
   *  resolves or the next turn starts, so a second card meanwhile adds no second notice. */
  function questionAsked(threadId: string, summary?: string): void {
    const bot = store.botByThread(threadId);
    const task = bot && store.taskByThread(bot.id, threadId);
    const desk = task?.desk;
    if (!bot || !desk || task.activity === "waiting-on-you" || !store.taskByThread(bot.id, desk.origin)) return;
    store.appendMessage(desk.origin, {
      role: "bot", kind: "text", from: speaker(bot), threadRef: { botId: bot.id, threadId, title: desk.title },
      text: `A tarefa "${desk.title}" tem uma pergunta para você.${summary?.trim() ? ` ${clip(summary.trim(), QUESTION_NOTICE_CHARS)}` : ""}`,
    });
  }

  const planLimitHolds = (threadId: string) => planLimit.blocked() && Boolean(store.botByThread(threadId) && store.taskByThread(store.botByThread(threadId)!.id, threadId)?.desk);

  /** A thread the bot opened on itself (start_thread): its answer comes back to the conversation it was opened from. */
  const addLane = (threadId: string, lane: { botId: string; originThreadId: string; title: string }) => { lanes.set(threadId, lane); };

  return { handle, restore, settled, addLane, owns, turnStarted, startFailed, questionAsked, chooseLane, openLane, watches, observe, planLimitHit, planLimitBlocked: planLimit.blocked, holds: (threadId: string) => diskHolds(threadId) || planLimitHolds(threadId), planLimitHolds };
}

export type Desk = ReturnType<typeof createDesk>;
