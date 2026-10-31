import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowRight, Check, ChevronDown, ChevronRight, Clock, FileText, List, Pencil, Shield, Square, User, X,
  type LucideIcon,
} from "lucide-react";
import { t } from "@/lib/i18n";
import { openBrowserStage, useBrowserFloat } from "@/lib/browser-stage";
import { pendingBrowserSignIn } from "@/lib/browser-signin";
import {
  clockLabel, endedSummary, goalCardLive, goalCardNote, goalOfInput, lastActionPhrase, pickRun, stepPhrase,
  type GoalLiveRun, type GoalStepKind,
} from "@/lib/browser-goal";
import { api, useStore, type Message } from "@/state/store";

const POLL_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const RECONNECT_MS = 2_000;

// Cards that read the same run share one request a second, however many of them are on screen.
const recentGoalReads = new Map<string, { at: number; read: Promise<{ ok: boolean; status: number; body: unknown }> }>();

function fetchGoalRuns(url: string, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: unknown }> {
  const known = recentGoalReads.get(url);
  if (known && Date.now() - known.at < POLL_MS - 100) return known.read;
  const read = fetch(url, { signal, credentials: "same-origin" }).then(async (response) => ({
    ok: response.ok, status: response.status, body: response.ok ? await response.json() : null,
  }));
  recentGoalReads.set(url, { at: Date.now(), read });
  if (recentGoalReads.size > 64) recentGoalReads.delete(recentGoalReads.keys().next().value!);
  read.catch(() => { if (recentGoalReads.get(url)?.read === read) recentGoalReads.delete(url); });
  return read;
}
const VISIBLE_STEPS = 6;

const STEP_ICONS: Record<GoalStepKind, LucideIcon> = {
  click: ArrowRight,
  fill: Pencil,
  read: FileText,
  select: List,
  scroll: ArrowDown,
  wait: Clock,
  cookies: Shield,
  dismiss: X,
};

export function useGoalRun(threadId: string, goal: string | null, messageAt: number, finished: boolean, turnBusy = false): {
  run: GoalLiveRun | null;
  newest: boolean;
} {
  const [run, setRun] = useState<GoalLiveRun | null>(null);
  const [newest, setNewest] = useState(false);
  const runId = useRef<string | null>(null);

  useEffect(() => {
    if (!threadId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MS;
    const poll = async () => {
      let ended = false;
      try {
        const query = runId.current ? `?run=${encodeURIComponent(runId.current)}` : "";
        const response = await fetchGoalRuns(`/api/threads/${encodeURIComponent(threadId)}/browser-goals${query}`, controller.signal);
        if (response.status === 429) delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        else if (response.ok) {
          delay = POLL_MS;
          const body = response.body as { runs?: GoalLiveRun[] };
          const picked = pickRun(body.runs ?? [], goal, messageAt);
          if (picked) {
            runId.current = picked.id;
            setRun(picked);
            setNewest(body.runs?.at(-1)?.id === picked.id);
            ended = picked.endedAt !== null;
          } else {
            ended = true;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      // A run that has ended asks for nothing more: a finished step never polls again, and neither does an old one nobody waits on.
      if (ended && (finished || !turnBusy)) { setNewest(false); return; }
      timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [threadId, goal, messageAt, finished, turnBusy]);

  return { run, newest };
}

type BrowserFrame = { seq: number; data: string; format?: "jpeg" | "png" };
type Screencast = { frame: BrowserFrame; width: number; height: number; acknowledge: (seq: number) => void };

/** A small preview asks for a few pictures a second: the server sends the next one only after the last was acknowledged, so a paced ack paces the stream. */
export function useScreencast(botId: string | undefined, active: boolean, options: { maxFps?: number } = {}): { cast: Screencast | null; blocked: boolean } {
  const gap = options.maxFps && options.maxFps > 0 ? 1000 / options.maxFps : 0;
  const [cast, setCast] = useState<Screencast | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!botId || !active || typeof EventSource === "undefined") return;
    let stopped = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wait = RECONNECT_MS;
    const connect = () => {
      let viewerId = "";
      let size = { width: 1280, height: 720 };
      const opened = new EventSource(`/api/bots/${encodeURIComponent(botId)}/browser/live`);
      source = opened;
      let lastAck = 0;
      const send = (seq: number) => {
        if (stopped || !viewerId) return;
        void api(`/api/bots/${encodeURIComponent(botId)}/browser/action`, {
          method: "POST",
          body: JSON.stringify({ type: "ack", seq, viewerId }),
          timeoutMs: 120_000,
        }).catch(() => {});
      };
      const acknowledge = (seq: number) => {
        const wait = Math.max(0, lastAck + gap - Date.now());
        lastAck = Date.now() + wait;
        if (wait > 0) setTimeout(() => send(seq), wait);
        else send(seq);
      };
      const listen = (name: string, handler: (data: any) => void) => opened.addEventListener(name, (event) => {
        if (stopped) return;
        try { handler(JSON.parse((event as MessageEvent).data)); } catch {}
      });
      listen("ready", (data) => { if (typeof data.viewerId === "string") viewerId = data.viewerId; wait = RECONNECT_MS; });
      listen("status", (data) => {
        if (data.viewportWidth > 0 && data.viewportHeight > 0) size = { width: data.viewportWidth, height: data.viewportHeight };
      });
      listen("frame", (data) => { if (viewerId) { setBlocked(false); setCast({ frame: data, ...size, acknowledge }); } });
      opened.addEventListener("error", () => {
        opened.close();
        setCast(null);
        if (stopped) return;
        setBlocked(true);
        // A refused or dropped stream (a busy server answers 429) is tried again, slower each time, never abandoned.
        retry = setTimeout(connect, wait);
        wait = Math.min(wait * 2, MAX_BACKOFF_MS);
      });
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
      setCast(null);
      setBlocked(false);
    };
  }, [botId, active, gap]);
  return { cast, blocked };
}

export function Frame({ frame, running, cast, blocked = false, onOpen, needsYou }: { frame: string | null; running: boolean; cast: Screencast | null; blocked?: boolean; onOpen?: () => void; needsYou?: boolean }) {
  const inner = (
    <div className={`relative rounded-[12px] ${needsYou ? "ring-2 ring-[#ff6633]" : ""}`} data-needs-you={needsYou || undefined}>
      <FrameImage frame={frame} running={running} cast={cast} blocked={blocked} />
      {running && (
        <span className="pointer-events-none absolute start-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm" data-testid="browser-goal-live">
          <span aria-hidden="true" className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-red-500" />
          </span>
          {t("browser.stage.live")}
        </span>
      )}
    </div>
  );
  return onOpen
    ? <button type="button" onClick={onOpen} data-testid="browser-goal-thumb" aria-label={t("browser.stage.open")} title={t("browser.stage.open")} className="block w-full cursor-pointer rounded-[12px] text-left focus-visible:outline-2 focus-visible:outline-accent">{inner}</button>
    : inner;
}

function FrameImage({ frame, running, cast, blocked = false }: { frame: string | null; running: boolean; cast: Screencast | null; blocked?: boolean }) {
  const [shown, setShown] = useState(frame);
  const [previous, setPrevious] = useState<string | null>(null);
  if (frame !== shown) {
    setPrevious(shown);
    setShown(frame);
  }
  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), 260);
    return () => clearTimeout(timer);
  }, [previous]);
  if (cast) {
    return (
      <div className="goal-frame relative aspect-[16/10] w-full overflow-hidden rounded-[12px] border-2 border-white bg-white" data-live="">
        <img
          alt={t("browserGoal.frameAlt")}
          src={`data:image/${cast.frame.format === "png" ? "png" : "jpeg"};base64,${cast.frame.data}`}
          onLoad={() => cast.acknowledge(cast.frame.seq)}
          onError={() => cast.acknowledge(cast.frame.seq)}
          className="absolute inset-0 size-full object-cover object-top"
        />
      </div>
    );
  }
  return (
    <div className="goal-frame relative aspect-[16/10] w-full overflow-hidden rounded-[12px] border-2 border-white bg-white">
      {previous && <img alt="" src={`data:image/jpeg;base64,${previous}`} className="absolute inset-0 size-full object-cover object-top" />}
      {shown ? (
        <img
          key={shown.length + shown.slice(-16)}
          alt={t("browserGoal.frameAlt")}
          src={`data:image/jpeg;base64,${shown}`}
          className="goal-frame-in absolute inset-0 size-full object-cover object-top"
        />
      ) : (
        <div className="grid size-full place-items-center bg-inset text-[12px] text-ink-tertiary">
          {running ? t(blocked ? "browser.float.elsewhere" : "browserGoal.opening") : ""}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: GoalLiveRun["steps"][number] }) {
  const Icon = STEP_ICONS[step.kind];
  const detail = step.kind === "fill" && step.text ? `"${step.text}"` : step.label;
  return (
    <li className="goal-step-in flex items-start gap-2.5 py-1.5">
      <Icon size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight text-ink">{stepPhrase(step.kind)}</div>
        {detail && <div className="truncate text-[12px] leading-tight text-ink-tertiary">{detail}</div>}
      </div>
      <time className="shrink-0 pt-0.5 font-mono text-[11px] text-ink-tertiary">{clockLabel(step.at)}</time>
    </li>
  );
}

const DRAWER_MS = 420;

/** The browser drops down when the card opens and folds up before the card turns back into its one-line summary. */
function useDrawer(open: boolean): { mounted: boolean; expanded: boolean } {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return () => cancelAnimationFrame(frame);
    }
    setExpanded(false);
    const timer = setTimeout(() => setMounted(false), DRAWER_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { mounted, expanded };
}

export function BrowserGoalCard({ message, threadId, botId, botName, onStop, turnBusy = false }: {
  message: Message;
  turnBusy?: boolean;
  threadId: string;
  botId?: string;
  botName: string;
  onStop?: () => void;
}) {
  const { state } = useStore();
  const tool = message.tool;
  const goal = tool ? goalOfInput(tool.input, tool.name) : null;
  const finished = tool?.ok !== undefined;
  const { run, newest } = useGoalRun(threadId, goal, message.at, finished, turnBusy);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const stepsRef = useRef<HTMLUListElement>(null);
  const running = !finished && (run === null || run.endedAt === null);
  const live = goalCardLive({ running, turnBusy, newest });
  const open = userOpen ?? live;
  const steps = run?.steps ?? [];
  const floating = useBrowserFloat(run?.botId ?? botId);
  const drawer = useDrawer(open);

  useEffect(() => {
    const list = stepsRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [steps.length, open]);

  const bot = state.bots.find((candidate) => candidate.id === botId);
  const needsYou = live && botId ? pendingBrowserSignIn(bot, state.computerControl?.[botId]?.help) : null;
  const name = run?.botName || botName;
  const title = t("browserGoal.title", { name: bot?.name ?? name });
  const note = goalCardNote(run?.status ?? null, { running, live });

  const takeOver = () => {
    if (!botId) return;
    openBrowserStage(botId);
  };

  if (!drawer.mounted) {
    return (
      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => setUserOpen(true)}
          aria-expanded={false}
          data-testid="browser-goal-collapsed"
          title={t("browserGoal.seeWhatItDid")}
          className="flex min-h-7 max-w-full items-center gap-1.5 rounded-lg px-1 py-1 text-[12.5px] text-ink-tertiary hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {run?.status === "done" || (run === null && tool?.ok) ? <Check size={12} aria-hidden="true" className="shrink-0 text-success" /> : null}
          <span className="min-w-0 truncate">{goal ?? t("browserGoal.seeWhatItDid")}</span>
          {run && <span className="shrink-0">· {endedSummary(run)}</span>}
          <ChevronRight size={12} aria-hidden="true" className="shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <section
        data-testid="browser-goal-card"
        data-running={live || undefined}
        aria-label={title}
        className="relative w-[min(46rem,100%)] overflow-hidden rounded-xl border border-hairline/20 text-ink"
      >
        {live && <div className="goal-shimmer absolute inset-x-0 top-0 h-[2px]" aria-hidden="true" />}
        <header className="flex items-center gap-2 px-3.5 py-2.5">
          <div className="min-w-0 flex-1 truncate text-[13.5px] leading-tight" data-testid="browser-goal-title">
            <span className="font-semibold">{t("browserGoal.title", { name: bot?.name ?? name })}</span>
            <span className="text-ink-tertiary"> · {lastActionPhrase(run)}</span>
          </div>
          {needsYou && botId && !floating && (
            <span className="flex shrink-0 items-center gap-2 rounded-full px-1 ring-2 ring-[#ff6633]" data-testid="browser-goal-needs-you">
              <span className="ps-1.5 text-[12px] text-ink">{t("browser.float.needsYou")}</span>
              <button type="button" onClick={takeOver} className="h-6 shrink-0 rounded-full bg-[#ff6633] px-2.5 text-[12px] font-medium text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent">
                {t("browser.stage.openScreen")}
              </button>
            </span>
          )}
          {!needsYou && live && botId && !floating && (
            <button
              type="button"
              onClick={takeOver}
              data-testid="browser-goal-see-screen"
              className="flex h-7 shrink-0 items-center rounded-full border border-hairline/60 px-2.5 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t("browser.float.seeScreen")}
            </button>
          )}
          {botId && (
            <button
              type="button"
              onClick={takeOver}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-hairline/60 px-2.5 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              <User size={12} aria-hidden="true" />
              {t("browserGoal.takeOver")}
            </button>
          )}
          {live && onStop && (
            <button
              type="button"
              onClick={onStop}
              aria-label={t("browserGoal.stop")}
              title={t("browserGoal.stop")}
              className="grid size-7 shrink-0 place-items-center rounded-full border border-hairline/60 text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Square size={11} aria-hidden="true" className="fill-current" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setUserOpen(false)}
            aria-label={t("browserGoal.collapse")}
            title={t("browserGoal.collapse")}
            className="grid size-7 shrink-0 place-items-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="goal-drawer" data-open={drawer.expanded || undefined} data-testid="browser-goal-drawer">
          <div>
            <div className="px-3.5 pb-3">
              <ul
                ref={stepsRef}
                aria-label={t("browserGoal.steps")}
                className="min-w-0 divide-y divide-hairline/30 overflow-y-auto"
                style={{ maxHeight: `calc(${VISIBLE_STEPS} * 2.9rem)` }}
              >
                {steps.map((step, index) => <StepRow key={`${step.at}:${index}`} step={step} />)}
              </ul>
            </div>
            {note && <div className="px-3.5 pb-3 text-[12px] text-ink-tertiary" data-testid="browser-goal-note">{note}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
