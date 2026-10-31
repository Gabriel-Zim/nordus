import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, GripVertical, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activityStepLabel, liveActivityLabel } from "@/lib/live-activity";
import { stepOnObject } from "@/lib/tool-step-label";
import { activeLocale } from "@/lib/i18n";
import { toolDoneLabel } from "@/lib/tool-step-label";
import { peerLine, peerRequest } from "@/lib/peer-message";
import { lastNonReceipt } from "@/lib/receipts";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { copyText } from "@/lib/copy-text";
import { humanDuration, humanElapsed } from "@/lib/human-elapsed";
import { detailsCommand } from "@/lib/command-presence";
import { showToolCallsEnabled } from "@/lib/feature-flags";
import { useAdvancedMode } from "@/lib/interface-mode";
import { roomSpeakerIds } from "@/lib/room-threads";
import { listenLiveFrames } from "@/lib/live-events";
import { teammateWork, workIn, type TeammateWork } from "../../shared/team-work";
import { membersOf } from "@/lib/team-members";
import { botSteps, journalOpen, journalView, stepClock, stepLines, taskStepNow, whoIsDoing, type StepLine } from "@/lib/work-steps";
import type { WorkJournal } from "../../shared/work-steps";

export type WorkStep = { id: string; label: string; state: "done" | "failed" | "running"; tool?: string; count?: number };

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

function isStep(message: Message): boolean {
  return message.kind === "activity" && Boolean(message.tool) && !message.threadRef && !message.comm && !message.tool?.setup;
}

/** The request as a short sentence: no leading mentions, no markdown, the first line, cut at a word. Too short to mean
 *  anything (a bare "work"), it is left out and the panel says what the bot is doing instead. */
function plainRequest(text: string): string {
  const line = text.replace(/^(?:\s*@\S+[,:]?\s*)+/, "").replace(/[*_`#>]/g, "").split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  if (line.length < 8 || !/\s/.test(line)) return "";
  return line.length > 90 ? `${line.slice(0, 90).replace(/\s+\S*$/, "")}…` : line;
}

/** What the current turn is about, who asked for it and the steps it took, read from the visible transcript. */
export function currentWork(messages: readonly Message[], bot: Pick<Bot, "id" | "tasks" | "threadId">, locale = activeLocale()): {
  request?: string;
  askedBy: { kind: "you" } | { kind: "bot"; name: string } | { kind: "routine"; name: string } | { kind: "task"; name: string };
  steps: WorkStep[];
} {
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") { start = i; break; }
  }
  const asked = start >= 0 ? messages[start]! : undefined;
  const peer = asked ? peerLine(asked) ?? peerRequest(asked, bot.id) : null;
  const task = bot.tasks?.find((candidate) => candidate.threadId === bot.threadId);
  const askedBy = peer?.botId === bot.id && task
    ? { kind: "task" as const, name: task.title }
    : peer
    ? { kind: "bot" as const, name: peer.name }
    : task?.routineRunId
      ? { kind: "routine" as const, name: task.title }
      : { kind: "you" as const };
  const request = plainRequest(peer?.body ?? asked?.text ?? task?.title ?? "");
  const object = task?.doingObject;
  // Steps as a person tells them: done ones in the past and grouped ("Li 3 arquivos"), the running one as what it is doing.
  // Never the engine's own English line, a command or a file name.
  const steps: WorkStep[] = [];
  for (const message of messages.slice(start + 1).filter(isStep)) {
    const tool = message.tool!;
    if (tool.ok === undefined) {
      steps.push({ id: message.id, label: stepOnObject(tool.name, object, locale) ?? activityStepLabel({ name: tool.name }), state: "running" });
      continue;
    }
    if (!tool.ok) continue;
    const name = tool.name.replace(/^Running /, "");
    if (toolDoneLabel(name) === null) continue;
    const previous = steps.at(-1);
    if (previous?.state === "done" && previous.tool === name) {
      previous.count = (previous.count ?? 1) + 1;
      previous.label = toolDoneLabel(name, previous.count) ?? previous.label;
      continue;
    }
    steps.push({ id: message.id, label: stepOnObject(name, object, locale, true) ?? toolDoneLabel(name) ?? "", state: "done", tool: name, count: 1 });
  }
  return { request: request || undefined, askedBy, steps };
}

export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** "Designer: diagramando a lâmina 3": a teammate and what it is doing, in a person's words. */
export function teammateLine(work: TeammateWork): string {
  return whoIsDoing(work.title ? `${work.name} · ${work.title}` : work.name, taskStepNow(work) ?? t("chat.activity.working"));
}

/** The teammates working on what this conversation sent them and, for a team's leader, every member working in any
 *  conversation of its own. */
export function teamWorkFor(bot: Bot, bots: readonly Bot[]): TeammateWork[] {
  const sent = teammateWork(bot, bots);
  const seen = new Set(sent.map((work) => work.threadId));
  const led = membersOf(bots, bot).flatMap((member) => {
    const own = { threadId: member.threadId, busy: member.busy, activity: member.activity, turnStartedAt: member.turnStartedAt };
    const working = (member.tasks ?? []).flatMap((task) => workIn(member, task, bots) ?? []);
    const fallback = working.length ? null : workIn(member, own);
    return (fallback ? [fallback] : working).filter((entry) => !seen.has(entry.threadId));
  });
  return [...sent, ...led];
}

const PREVIOUS_SHOWN = 3;

/** The step running now with how long it has run, and the ones before it, newest first, each with a discreet ✓ and the
 *  time it began. Many earlier steps fold behind "Ver etapas". */
export function StepList({ lines, now }: { lines: StepLine[]; now: number }) {
  const [open, setOpen] = useState(false);
  const current = lines.at(-1)!;
  const previous = lines.slice(0, -1).reverse();
  const shown = open ? previous : previous.slice(0, PREVIOUS_SHOWN);
  return (
    <div data-work-steps="" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 px-1">
      <div data-work-step-now="" className="flex min-w-0 items-start gap-2" aria-label={t("workingNow.currentStep")}>
        <span aria-hidden="true" className="mt-[6px] size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="line-clamp-2 min-w-0 flex-1 break-words text-[13px] font-medium leading-snug text-ink">{current.label}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap pt-px text-[11.5px] tabular-nums text-ink-tertiary">{humanElapsed(now - current.at)}</span>
      </div>
      {shown.length > 0 && (
        <ol className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5" aria-label={t("workingNow.previousSteps")}>
          {shown.map((step) => (
            <li key={`${step.at}-${step.label}`} data-work-step-done="" className="flex min-w-0 items-start gap-2 text-[12px] text-ink-tertiary">
              <span aria-hidden="true" className="w-1.5 shrink-0 pt-px text-center text-[10.5px]">✓</span>
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-ink-secondary">{step.label}</span>
              <span className="ml-auto shrink-0 whitespace-nowrap pt-px text-[11px] tabular-nums">{stepClock(step.at)}</span>
            </li>
          ))}
        </ol>
      )}
      {previous.length > PREVIOUS_SHOWN && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="w-fit rounded-[8px] px-1 py-0.5 text-[11.5px] font-medium text-ink-tertiary hover:bg-ink/[0.06] hover:text-ink-secondary"
        >
          {open ? t("workingNow.hideSteps") : t("workingNow.seeSteps", { count: previous.length - PREVIOUS_SHOWN })}
        </button>
      )}
    </div>
  );
}

const DONE_SHOWN = 4;

function JournalCard({ journal, now }: { journal: WorkJournal; now: number }) {
  const [open, setOpen] = useState(false);
  const view = journalView(journal);
  const done = open ? view.done : view.done.slice(-DONE_SHOWN);
  const count = new Intl.NumberFormat(activeLocale());
  const credits = view.credits && (view.credits.cap !== undefined
    ? t("workingNow.creditsOfCap", { used: count.format(view.credits.used), cap: count.format(view.credits.cap) })
    : view.credits.used === 1 ? t("workingNow.creditsUsedOne") : t("workingNow.creditsUsed", { used: count.format(view.credits.used) }));
  const where = view.where && t(view.where === "modal" ? "workingNow.onModal" : "workingNow.onServer");
  const footer = [credits, where].filter(Boolean).join(" · ");
  return (
    <div data-task-journal="" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 px-1">
      {view.running.map((entry) => (
        <div key={`${entry.at}-${entry.botId}`} data-journal-now="" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
          <span className="truncate text-[11px] font-medium text-ink-tertiary">{`${t("workingNow.now")} · ${humanElapsed(now - entry.at)}`}</span>
          <b className="line-clamp-2 break-words text-[13px] font-semibold leading-snug text-ink">{whoIsDoing(entry.name, entry.text)}</b>
        </div>
      ))}
      {view.percent !== undefined && (
        <div
          role="progressbar"
          aria-label={t("workingNow.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          className="h-1 w-full overflow-hidden rounded-full bg-ink/[0.08]"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${view.percent}%` }} />
        </div>
      )}
      {view.done.length > DONE_SHOWN && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="w-fit rounded-[8px] px-1 py-0.5 text-[11.5px] font-medium text-ink-tertiary hover:bg-ink/[0.06] hover:text-ink-secondary"
        >
          {open ? t("workingNow.hideSteps") : t("workingNow.seeSteps", { count: view.done.length - DONE_SHOWN })}
        </button>
      )}
      {(done.length > 0 || view.left.length > 0) && (
        <ol className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5" aria-label={t("workingNow.steps")}>
          {done.map((entry) => (
            <li key={`${entry.at}-${entry.botId}-${entry.text}`} data-journal-done="" className="flex min-w-0 items-start gap-2 text-[12px] text-ink-tertiary">
              <span aria-hidden="true" className="w-1.5 shrink-0 pt-px text-center text-[10.5px]">✓</span>
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-ink-secondary">{entry.text}</span>
              <span className="ml-auto shrink-0 whitespace-nowrap pt-px text-[11px] tabular-nums">
                {`${entry.name} · ${humanDuration(entry.end - entry.at)}`}
              </span>
            </li>
          ))}
          {view.left.map((item, index) => (
            <li key={`left-${index}`} data-journal-left="" className="flex min-w-0 items-start gap-2 text-[12px] text-ink-tertiary/70">
              <span aria-hidden="true" className="mt-[5px] size-1.5 shrink-0 rounded-full border border-current" />
              <span className="line-clamp-2 min-w-0 flex-1 break-words">{item}</span>
            </li>
          ))}
        </ol>
      )}
      {footer && <span data-journal-footer="" className="text-[11px] tabular-nums text-ink-tertiary">{footer}</span>}
    </div>
  );
}

function TeamWorking({ team, prominent, now }: { team: TeammateWork[]; prominent: boolean; now: number }) {
  return (
    <div data-working-team="" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 px-1">
      {!prominent && <span className="text-[11px] font-medium text-ink-tertiary">{t("chat.teammatesWorking")}</span>}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5" aria-label={t("chat.teammatesWorking")}>
        {team.map((mate) => (
          <li key={mate.threadId} data-working-mate="" className="flex min-w-0 items-start gap-2">
            <span className={cn("line-clamp-2 min-w-0 flex-1 break-words", prominent ? "text-[13px] font-semibold leading-snug text-ink" : "text-[12.5px] text-ink-secondary")}>
              {teammateLine(mate)}
            </span>
            {mate.startedAt && <span className="ml-auto shrink-0 whitespace-nowrap pt-px text-[11.5px] tabular-nums text-ink-tertiary">{humanElapsed(now - mate.startedAt)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where a bot works right now: its own chat, the room it is speaking in, or through teammates of its team working on
 *  what this conversation sent them or, when it leads the team, on anything. Null when none of that is happening. */
export function useBotWork(bot: Bot): { here: boolean; room?: { id: string; name: string }; team: TeammateWork[] } | null {
  const { state } = useStore();
  const team = useMemo(() => teamWorkFor(bot, state.bots), [bot, state.bots]);
  const here = Boolean(bot.busy) && bot.activity !== "waiting-on-you";
  const group = state.groups.find((candidate) => roomSpeakerIds(candidate).includes(bot.id));
  if (!here && !group && team.length === 0) return null;
  return { here, team, ...(group ? { room: { id: group.id, name: group.name } } : {}) };
}

/** Three small dots that walk while the bot is on a task; nothing at all when it is idle. */
export function TaskDots() {
  return (
    <span data-working-dots="" className="flex h-[5px] items-center gap-[3px]" aria-hidden="true">
      {[0, 160, 320].map((delay) => (
        <span key={delay} className="working-dot size-[3px] rounded-full bg-ink-secondary" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

type QueueItem = {
  queueId: string;
  threadId: string;
  text: string;
  queuedAt: number;
  from: { kind: "person"; name?: string } | { kind: "bot"; name: string } | { kind: "routine"; name?: string };
  room: string | null;
};

function queueOrigin(item: QueueItem): string {
  const who = item.from.kind === "bot"
    ? item.room ? t("workingNow.askedByBotInRoom", { name: item.from.name, room: item.room }) : t("workingNow.askedByBot", { name: item.from.name })
    : item.from.kind === "routine"
      ? t("workingNow.askedByRoutine", { name: item.from.name ?? "" })
      : item.from.name
        ? t("workingNow.askedByPerson", { name: item.from.name })
        : item.room ? t("workingNow.youInRoom", { room: item.room }) : t("workingNow.askedByYouQueue");
  return `${who} · ${t("workingNow.at", { time: stepClock(item.queuedAt) })}`;
}

/** The bot's waiting work: drag to change the order it runs in, X to take one out (asks first). */
function BotQueue({ botId }: { botId: string }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const body = await api<{ items: QueueItem[] }>(`/api/bots/${botId}/work-queue`);
      setItems(body.items);
    } catch {
      setItems((current) => current ?? []);
    }
  }, [botId]);
  useEffect(() => {
    void load();
    return listenLiveFrames({ onMissedFrames: () => void load(), onFrame: (frame) => { if (frame.kind === "bot.queued") void load(); } });
  }, [load]);
  // Nothing waiting: the queue takes no room at all.
  if (!items || items.length === 0) return null;

  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = [...items];
    const source = next.findIndex((item) => item.queueId === from);
    const target = next.findIndex((item) => item.queueId === to);
    if (source < 0 || target < 0) return;
    next.splice(target, 0, next.splice(source, 1)[0]!);
    setItems(next);
    void api(`/api/bots/${botId}/work-queue`, { method: "PUT", body: JSON.stringify({ ids: next.map((item) => item.queueId) }) }).catch(() => void load());
  };
  const remove = (queueId: string) => {
    setConfirming(null);
    setItems(items.filter((item) => item.queueId !== queueId));
    void api(`/api/bots/${botId}/work-queue/${queueId}`, { method: "DELETE" }).catch(() => void load());
  };

  return (
    <div data-working-queue="" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 border-t border-ink/10 pt-2">
    <span className="px-1 text-[11px] font-medium text-ink-tertiary">{t("workingNow.queueTitle")}</span>
    <ol className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1" aria-label={t("workingNow.queueTitle")}>
      {items.map((item, index) => (
        <li
          key={item.queueId}
          draggable
          onDragStart={(event) => { setDragging(item.queueId); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.queueId); }}
          onDragOver={(event) => { if (dragging) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); if (dragging) move(dragging, item.queueId); setDragging(null); }}
          onDragEnd={() => setDragging(null)}
          data-queue-item=""
          className={cn(
            "group/queue grid min-w-0 cursor-grab grid-cols-[14px_18px_minmax(0,1fr)_auto] items-start gap-2 rounded-[10px] border border-ink/[0.06] bg-ink/[0.03] px-2 py-2 active:cursor-grabbing",
            dragging === item.queueId && "opacity-50",
          )}
        >
          <GripVertical size={14} aria-hidden="true" className="mt-0.5 text-ink-tertiary" />
          <span className="mt-px text-[11px] tabular-nums text-ink-tertiary">{index + 1}</span>
          <span className="min-w-0">
            <span className="line-clamp-2 break-words text-[12.5px] text-ink">{item.text}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-ink-tertiary">{queueOrigin(item)}</span>
          </span>
          {confirming === item.queueId ? (
            <span className="flex items-center gap-1 text-[11.5px]">
              <button type="button" onClick={() => remove(item.queueId)} className="rounded-[8px] px-1.5 py-0.5 font-medium text-danger hover:bg-danger/10">{t("workingNow.removeYes")}</button>
              <button type="button" onClick={() => setConfirming(null)} className="rounded-[8px] px-1.5 py-0.5 text-ink-secondary hover:bg-ink/[0.06]">{t("workingNow.removeNo")}</button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(item.queueId)}
              aria-label={t("workingNow.remove")}
              title={t("workingNow.remove")}
              className="rounded-[8px] p-1 text-ink-tertiary opacity-0 hover:bg-ink/[0.06] hover:text-ink touch:opacity-100 focus-visible:opacity-100 group-hover/queue:opacity-100"
            >
              <X size={13} />
            </button>
          )}
        </li>
      ))}
    </ol>
    </div>
  );
}

/** "Agora": opened from the header pill while the bot is on a task. What it is doing in plain words, where it was asked,
 *  for how long, the task's id to copy for support, and the work waiting behind it. */
/** "Agora" at the top of the bot's profile: the current task in plain words, how long it has run, where it came from,
 *  Stop, and the queue below it. Shown only while the bot works; the conversation's name pill opens the profile. */
export function WorkingNow({ bot, messages, onStop }: {
  bot: Bot;
  messages: readonly Message[];
  onStop: () => void;
}) {
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const { state } = useStore();
  const advanced = useAdvancedMode();
  const work = useBotWork(bot);
  const journal = bot.tasks?.find((task) => task.threadId === bot.threadId)?.journal;
  const taskJournal = journalOpen(journal) ? journal : undefined;
  const now = useNow(Boolean(work) || Boolean(taskJournal));
  if (!work && !taskJournal) return null;

  const here = Boolean(work?.here);
  const team = work?.team ?? [];
  const room = work?.room;
  const teamOnly = !here && !room;
  const started = here ? bot.turnStartedAt : undefined;
  const current = currentWork(messages, bot);
  const last = lastNonReceipt(messages);
  // Nordus: what it is doing in a person's words, once the light model said it; until then the usual label.
  const doing = here ? bot.tasks?.find((task) => task.threadId === bot.threadId)?.doing : undefined;
  const liveLabel = doing ?? liveActivityLabel(last);
  const steps = !here ? [] : current.steps.some((step) => step.state === "running")
    ? current.steps
    : [...current.steps, { id: "now", label: liveLabel, state: "running" as const }];
  // What the server saw this turn do: the bot's own steps, else the tools it used. Without them, the transcript's steps.
  const lines = stepLines(here
    ? bot.tasks?.find((task) => task.threadId === bot.threadId)?.steps
    : room ? botSteps({ ...bot, tasks: [] }, state.groups.filter((group) => group.id === room.id)) : undefined);
  const headlineText = here ? doing || current.request || liveLabel : undefined;
  // The running step that only repeats the title adds a line and says nothing new.
  const distinct = steps.filter((step) => !(step.state === "running" && step.label === headlineText));
  const shown = details ? distinct : distinct.slice(-4);
  const origin = teamOnly
    ? ""
    : !here
    ? t("workingNow.inRoomTitle", { room: room!.name })
    : current.askedBy.kind === "bot"
      ? t("workingNow.askedByBot", { name: current.askedBy.name })
      : current.askedBy.kind === "routine"
        ? t("workingNow.askedByRoutine", { name: current.askedBy.name })
        : current.askedBy.kind === "task"
        ? t("workingNow.ownTask", { name: current.askedBy.name })
        : t("workingNow.askedByYouInline");
  const command = here ? detailsCommand(messages, { showToolCalls: showToolCallsEnabled(state.config), advanced }) : undefined;
  const taskId = here ? [...messages].reverse().find((message) => message.role === "user")?.id : undefined;
  const headline = here ? doing || current.request || (lines.length ? "" : liveLabel) : room ? t("workingNow.roomWork", { room: room.name }) : "";

  const journalRunning = taskJournal?.entries.filter((entry) => entry.end === undefined) ?? [];
  const ownNow = taskJournal && here ? lines.at(-1) : undefined;
  const ownLine = ownNow && !journalRunning.some((entry) => entry.botId === bot.id && entry.text === ownNow.label)
    ? { at: ownNow.at, label: whoIsDoing(bot.name, ownNow.label) } : undefined;
  const teamApart = team.filter((mate) => !journalRunning.some((entry) => entry.botId === mate.botId));

  const header = (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 px-1">
      <span className="truncate text-[11px] font-medium text-ink-tertiary">
        {[t("workingNow.now"), origin, started ? humanElapsed(now - started) : ""].filter(Boolean).join(" · ")}
      </span>
      {/* The bot's own phrase may take two lines; the person's raw words, until that phrase arrives, take one. */}
      {headline && <b className={cn("break-words text-[13px] font-semibold leading-snug text-ink", doing || !here ? "line-clamp-2" : "truncate")}>{headline}</b>}
    </div>
  );

  return (
    <section
      data-working-now=""
      aria-label={t("workingNow.title", { name: bot.name })}
      // One column that never grows past the panel: long titles and steps wrap, never push the card wider.
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 overflow-hidden rounded-[14px] border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left"
    >
      {taskJournal ? (
        <>
          {here && journalRunning.length === 0 && header}
          {ownLine && <StepList lines={[ownLine]} now={now} />}
          {teamApart.length > 0 && <TeamWorking team={teamApart} prominent={false} now={now} />}
          <JournalCard journal={taskJournal} now={now} />
        </>
      ) : (
        <>
          {header}
          {team.length > 0 && <TeamWorking team={team} prominent={teamOnly} now={now} />}
          {lines.length > 0 ? <StepList lines={lines} now={now} /> : shown.length > 0 && (
            <ol className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 px-1" aria-label={t("workingNow.steps")}>
              {shown.map((step) => (
                <li key={step.id} className="flex min-w-0 items-start gap-2 text-[12.5px] text-ink-secondary">
                  <span aria-hidden="true" className="w-3 shrink-0 pt-px text-center text-[11px] text-ink-tertiary">{step.state === "done" ? "✓" : ""}</span>
                  <span className={cn("line-clamp-2 min-w-0 flex-1 break-words", step.state === "running" && "text-ink")}>{step.label}</span>
                  {step.state === "running" && <span className="ml-auto shrink-0 whitespace-nowrap pt-px text-[11.5px] text-ink-tertiary">{t("workingNow.stepNow")}</span>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {details && command && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 px-1">
          <span className="text-[11px] font-medium text-ink-tertiary">{t("workingNow.command")}</span>
          <code dir="ltr" className="select-text whitespace-pre-wrap break-all rounded-[8px] bg-ink/[0.05] px-2 py-1 text-left font-mono text-[11.5px] leading-snug text-ink-secondary">{command}</code>
        </div>
      )}
      {details && taskId && (
        <button
          type="button"
          onClick={() => { void copyText(taskId); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
          title={t("workingNow.copyId")}
          className="flex w-fit items-center gap-1.5 rounded-[8px] px-1 py-0.5 text-[11px] text-ink-tertiary hover:bg-ink/[0.06] hover:text-ink-secondary"
        >
          <Copy size={11} aria-hidden="true" />
          <span>{copied ? t("workingNow.copied") : t("workingNow.taskId", { id: taskId.slice(0, 8) })}</span>
        </button>
      )}
      <BotQueue botId={bot.id} />
      {(here || (teamOnly && bot.waitingForTeammates)) && (
        <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
          {here && (
            <button
              type="button"
              onClick={() => setDetails((value) => !value)}
              className="rounded-[9px] bg-ink/[0.06] px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-ink/[0.1]"
            >
              {details ? t("workingNow.fewerSteps") : t("workingNow.details")}
            </button>
          )}
          <button
            type="button"
            onClick={onStop}
            className="rounded-[9px] px-2.5 py-1 text-[12px] font-medium text-danger hover:bg-danger/10"
          >
            {t("chat.stop")}
          </button>
        </div>
      )}
    </section>
  );
}
