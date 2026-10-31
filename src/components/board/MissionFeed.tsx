import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, AlertTriangle, CircleCheck, CircleHelp, ListChecks, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Directory } from "@/lib/board";
import { feedStamp } from "@/lib/board-text";
import { BOARD_LIMITS } from "../../../shared/board";
import type { BoardMission, MissionFeedKind, MissionReceipt as Receipt } from "../../../shared/board";
import type { LocaleKey } from "@/locales";
import { MissionReceipt } from "./MissionReceipt";

const KIND: Record<MissionFeedKind, { Icon: LucideIcon; label: LocaleKey; tone: string }> = {
  plan: { Icon: ListChecks, label: "missions.feed.kind.plan", tone: "text-accent-text" },
  progress: { Icon: Activity, label: "missions.feed.kind.progress", tone: "text-ink-secondary" },
  decision: { Icon: CircleHelp, label: "missions.feed.kind.decision", tone: "text-warning" },
  done: { Icon: CircleCheck, label: "missions.feed.kind.done", tone: "text-success" },
  error: { Icon: AlertTriangle, label: "missions.feed.kind.error", tone: "text-danger" },
};

function DecisionCard({ mission, directory, onAnswer }: {
  mission: BoardMission;
  directory: Directory;
  onAnswer: (answer: string) => Promise<boolean>;
}) {
  const decision = mission.pendingDecision!;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (answer: string) => {
    const clean = answer.trim();
    if (!clean || busy) return;
    setBusy(true);
    const sent = await onAnswer(clean);
    setBusy(false);
    if (sent) setText("");
  };
  return (
    <section aria-labelledby="mission-decision" data-mission-decision="" className="mt-3 space-y-2.5 rounded-xl border border-warning/40 bg-card p-3.5">
      <h4 id="mission-decision" className="text-[12px] font-semibold text-warning">{t("missions.decision.title", { name: directory.assigneeName(decision.askedBy) })}</h4>
      <p className="text-[13.5px] leading-snug text-ink">{decision.question}</p>
      {decision.options && decision.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {decision.options.map((option) => (
            <button key={option} type="button" disabled={busy} className="ui-button ui-button-sm" data-decision-option="" onClick={() => void send(option)}>{option}</button>
          ))}
        </div>
      )}
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void send(text); }} className="flex gap-1.5">
        <input
          value={text}
          maxLength={BOARD_LIMITS.answer}
          disabled={busy}
          autoComplete="off"
          aria-label={t("missions.decision.answerLabel")}
          placeholder={t("missions.decision.placeholder")}
          onChange={(event) => setText(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-tertiary"
        />
        <button type="submit" disabled={busy || !text.trim()} className="ui-button ui-button-primary ui-button-sm">{t("missions.decision.send")}</button>
      </form>
    </section>
  );
}

export function MissionFeed({ mission, directory, receipt, onAnswer }: {
  mission: BoardMission;
  directory: Directory;
  receipt?: Receipt;
  onAnswer: (answer: string) => Promise<boolean>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const open = Boolean(mission.pendingDecision && !mission.pendingDecision.answer);
  const finished = mission.status === "done" || mission.status === "failed";
  const lastKind = mission.feed.at(-1)?.kind;
  useEffect(() => {
    const element = scroller.current;
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [mission.feed.length, open, finished, receipt]);
  return (
    <aside aria-labelledby="mission-feed-title" data-testid="mission-feed" className="flex min-h-0 flex-col rounded-xl border border-hairline/40 bg-panel max-lg:min-h-[320px]">
      <h3 id="mission-feed-title" className="border-b border-hairline/40 px-4 py-3 text-[13px] font-semibold text-ink">{t("missions.feed.title")}</h3>
      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {mission.feed.length === 0 && !open && <p className="text-[12.5px] text-ink-tertiary">{t("missions.feed.empty")}</p>}
        <ol className="space-y-3" data-mission-feed="">
          {mission.feed.map((entry, index) => {
            const { Icon, label, tone } = KIND[entry.kind] ?? KIND.progress;
            return (
              <li key={`${entry.at}-${index}`} data-feed-kind={entry.kind} className="flex gap-2.5">
                <span role="img" aria-label={t(label)} className={cn("mt-0.5 shrink-0", tone)}><Icon size={15} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-ink"><span className="font-medium">{directory.actorName(entry.author)}</span> · {entry.text}</p>
                  <time dateTime={new Date(entry.at).toISOString()} className="text-[11.5px] tabular-nums text-ink-tertiary">{feedStamp(entry.at, mission)}</time>
                </div>
              </li>
            );
          })}
        </ol>
        {open && <DecisionCard mission={mission} directory={directory} onAnswer={onAnswer} />}
        {mission.status === "done" && lastKind !== "done" && <p data-mission-end="" className="mt-4 text-[13px] font-medium text-success">{t("missions.done.end")}</p>}
        {mission.status === "failed" && lastKind !== "error" && <p data-mission-end="" className="mt-4 text-[13px] font-medium text-danger">{t("missions.failed.end")}</p>}
        {finished && receipt && <MissionReceipt receipt={receipt} />}
      </div>
    </aside>
  );
}
