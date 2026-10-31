import { useEffect, useRef, useState, type ReactNode } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { phraseAt, phraseHoldMs } from "@/lib/live-activity";
import { presenceLine } from "@/lib/command-presence";
import { humanDuration } from "@/lib/human-elapsed";

const CLOCK_MS = 15_000;
const TURN_TIME_FROM_MS = 10_000;

function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const FADE_MS = 320;

export function useRotatingPhrase(
  phrases: readonly string[],
  phase: string,
  seed: string,
  active: boolean,
): { current: string; previous: string | null } {
  const phaseSeed = `${seed}|${phase}`;
  const [clock, setClock] = useState({ phaseSeed, step: 0 });
  if (clock.phaseSeed !== phaseSeed) setClock({ phaseSeed, step: 0 });
  const step = clock.phaseSeed === phaseSeed ? clock.step : 0;
  const [previous, setPrevious] = useState<string | null>(null);
  const current = phraseAt(phrases, phaseSeed, step);
  const shown = useRef(current);

  useEffect(() => {
    if (!active || phrases.length < 2) return;
    const timer = setTimeout(() => setClock({ phaseSeed, step: step + 1 }), phraseHoldMs(phaseSeed, step));
    return () => clearTimeout(timer);
  }, [active, phrases.length, phaseSeed, step]);

  useEffect(() => {
    if (shown.current === current) return;
    setPrevious(shown.current);
    shown.current = current;
    const timer = setTimeout(() => setPrevious(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [current]);

  return { current, previous };
}

// 2s matches --animate-shimmer.
function ShimmerPhrase({ text, className, hidden }: { text: string; className?: string; hidden?: boolean }) {
  const [delay] = useState(() => `-${Date.now() % 2000}ms`);
  return (
    <span
      aria-hidden={hidden || undefined}
      className={cn("thinking-shimmer animate-shimmer [grid-area:1/1]", className)}
      style={{ animationDelay: `${delay}, 0ms` }}
    >
      {text}
    </span>
  );
}

export function TurnPresence({
  visible,
  label = t("chat.activity.thinking"),
  phrases,
  phase,
  seed = "",
  answering = false,
  names = [],
  goal = null,
  roster = false,
  after,
  since = null,
  turnSince = null,
  place = null,
}: {
  /** A room with several bots: one line of names, whoever works first and then the queue, and no activity phrase. */
  roster?: boolean;
  /** Drawn at the end of the same line (a room's small stop button). */
  after?: ReactNode;
  /** A team goal is running: the line says so, with the round. */
  goal?: { turn: number; max: number; minutesLeft?: number } | null;
  avatar?: ReactNode;
  names?: readonly string[];
  visible: boolean;
  label?: string;
  phrases?: readonly string[];
  phase?: string;
  seed?: string;
  answering?: boolean;
  /** A shell command has run since this time: from a minute on, the line says for how long. */
  since?: number | null;
  /** The turn began at this time: from ten seconds on, the line says for how long it has run. */
  turnSince?: number | null;
  /** The in-flight tool works in the built-in browser: the line says where. */
  place?: "browser" | null;
}) {
  const [mounted, setMounted] = useState(visible);
  const [presencePhase, setPhase] = useState<"think" | "answer" | "out">(answering ? "answer" : "think");
  const wasAnswering = useRef(answering);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setPhase(answering ? "answer" : "think");
      wasAnswering.current = answering;
      return;
    }
    if (!mounted) return;
    const handoff = wasAnswering.current;
    wasAnswering.current = false;
    if (handoff) {
      setMounted(false);
      return;
    }
    setPhase("out");
    const timer = setTimeout(() => setMounted(false), 280);
    return () => clearTimeout(timer);
  }, [visible, answering, mounted]);

  const showWorking = presencePhase === "think";
  const list = phrases && phrases.length > 0 ? phrases : [label];
  const { current } = useRotatingPhrase(list, phase ?? list[0], seed, mounted && showWorking);
  const now = useClock(mounted && showWorking && (since !== null || turnSince !== null));
  if (!mounted || !showWorking) return null;
  const sentence = roster && names.length && !goal
    ? `${names.join(", ")}…`
    : goal
    ? goal.minutesLeft !== undefined
      ? t("presence.goalDirect", { name: names[0] ?? "", turn: String(goal.turn), max: String(goal.max), minutes: String(goal.minutesLeft) })
      : t(names.length === 1 ? "presence.goal" : "presence.goalTeam", { name: names[0] ?? "", turn: String(goal.turn), max: String(goal.max) })
    : names.length > 1
    ? t("presence.many", { names: joinNames(names) })
    : names.length === 1
      ? presenceLine({ name: names[0]!, doing: current, since, now })
      : `${current}…`;
  const turnElapsed = turnSince !== null && since === null && !roster && !goal && now - turnSince >= TURN_TIME_FROM_MS ? humanDuration(now - turnSince) : null;
  const shown = turnElapsed ? `${sentence} · ${turnElapsed}` : sentence;
  const line = (
    <button
      type="button"
      data-turn-presence=""
      data-roster={roster || undefined}
      title={roster ? sentence : undefined}
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_WORKING_NOW))}
      className={cn(
        "turn-presence flex items-center gap-2 rounded-[10px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        roster && "min-w-0 max-w-full",
      )}
    >
      <span className="flex h-5 shrink-0 items-center gap-[3px] rounded-full bg-ink/[0.08] px-2" aria-hidden="true">
        {[0, 200, 400].map((delay) => (
          <span key={delay} className="presence-dot size-[4px] rounded-full bg-ink-secondary" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      <span className={cn("turn-phrase-in relative grid text-[13px] leading-none", roster && "min-w-0")}>
        <ShimmerPhrase key={sentence} text={shown} className={roster ? "truncate py-0.5" : undefined} />
      </span>
      {place === "browser" && !roster && (
        <span data-presence-place="browser" className="flex shrink-0 items-center gap-1 text-[13px] leading-none text-ink-tertiary">
          <span aria-hidden="true">·</span>
          <Globe size={12} aria-hidden="true" />
          {t("presence.inBrowser")}
        </span>
      )}
    </button>
  );
  if (!after) return line;
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      {line}
      {after}
    </div>
  );
}

export const OPEN_WORKING_NOW = "nordus:open-working-now";

function joinNames(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${t("presence.and")} ${names.at(-1)}`;
}
