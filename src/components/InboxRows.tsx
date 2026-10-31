import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/memory";
import { api } from "@/state/api";
import type { Bot } from "@/state/store";
import { APPROVALS_PATH, decidableOutsideCard, type ApprovalItem, type InboxNote } from "../../shared/approvals";
import { ApprovalFacts, ApprovalPill } from "./ApprovalCardParts";
import { ApprovalHoldButton } from "./ApprovalHoldButton";
import { BotAvatar } from "./Avatar";
import { APPROVAL_CONTROL, DeclineForm } from "./PendingApproval";

export type Outcome = { kind: "approved" } | { kind: "declined"; lesson: boolean };

export async function decideItem(item: ApprovalItem, approve: boolean, reason?: string): Promise<Outcome> {
  const answer = await api<{ lesson?: unknown }>(`${APPROVALS_PATH}/${item.id}/${approve ? "approve" : "decline"}`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
  return approve ? { kind: "approved" } : { kind: "declined", lesson: Boolean(answer.lesson) };
}

function Face({ bot, size }: { bot: Bot | undefined; size: number }) {
  return (
    <span className="mt-0.5 shrink-0" aria-hidden="true">
      {bot ? <BotAvatar bot={bot} size={size} animated={false} /> : <span className="block rounded-full bg-raised" style={{ width: size, height: size }} />}
    </span>
  );
}

const ago = (at: number) => localizedRelativeTime(at, activeLocale());

export function WaitingRow({
  item,
  bot,
  onOpen,
  onDecided,
  onFailed,
}: {
  item: ApprovalItem;
  bot: Bot | undefined;
  onOpen: (item: ApprovalItem) => void;
  onDecided: (item: ApprovalItem, outcome: Outcome) => void;
  onFailed: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decidable = decidableOutsideCard(item, "list");

  const run = (approve: boolean, reason?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setAsking(false);
    decideItem(item, approve, reason).then(
      (outcome) => onDecided(item, outcome),
      (failure: unknown) => {
        setError(failure instanceof Error && failure.message ? failure.message : t("inbox.error.generic"));
        onFailed();
      },
    ).finally(() => setBusy(false));
  };

  return (
    <li
      data-approval-item={item.id}
      data-approval-kind={item.kind}
      data-approval-risk={item.risk}
      className="flex items-start gap-3 px-4 py-3"
    >
      <Face bot={bot} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <ApprovalPill you={item.canDecide} decider={item.decider} deadline={item.expiresAt} critical={item.risk === "critical"} />
          <time className="text-[11.5px] tabular-nums text-ink-tertiary" dateTime={new Date(item.requestedAt).toISOString()}>{ago(item.requestedAt)}</time>
        </div>
        <p className="mt-1 text-[13.5px] font-medium leading-5 text-ink">{item.title}</p>
        {item.summary && <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-5 text-ink-secondary">{item.summary}</p>}
        <ApprovalFacts fields={item.fields} className="mt-2" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {asking ? (
            <DeclineForm onDecline={(reason) => run(false, reason)} onCancel={() => setAsking(false)} />
          ) : (
            <>
              {decidable && (item.risk === "critical"
                ? <ApprovalHoldButton onApprove={() => run(true)} disabled={busy} />
                : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(true)}
                    className={cn(APPROVAL_CONTROL, "bg-accent text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40")}
                  >
                    <Check size={14} aria-hidden="true" />
                    {t("inbox.action.approve")}
                  </button>
                ))}
              {decidable && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAsking(true)}
                  className={cn(APPROVAL_CONTROL, "bg-ink/[0.07] text-danger hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-40")}
                >
                  {t("approvals.decline.label")}
                </button>
              )}
              {item.canDecide && !decidable && (
                <button type="button" onClick={() => onOpen(item)} className={cn(APPROVAL_CONTROL, "bg-accent text-white hover:bg-accent/90")}>
                  {t("inbox.action.review")}
                </button>
              )}
              <button type="button" onClick={() => onOpen(item)} className="ml-auto rounded-md px-1 text-[12px] text-ink-tertiary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {t("inbox.open")}
              </button>
            </>
          )}
        </div>
        {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      </div>
    </li>
  );
}

export function SettledRow({ item, outcome }: { item: ApprovalItem; outcome: Outcome }) {
  const approved = outcome.kind === "approved";
  const label = approved ? t("approvals.record.approved") : outcome.lesson ? t("approvals.record.declinedLesson") : t("approvals.record.declined");
  return (
    <li data-approval-item={item.id} data-approval-settled={outcome.kind} className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-ink-tertiary">
      {approved ? <Check size={14} className="shrink-0 text-success" aria-hidden="true" /> : <X size={14} className="shrink-0" aria-hidden="true" />}
      <span role="status">{label}</span>
      <span className="min-w-0 truncate">· {item.title}</span>
    </li>
  );
}

export function NoteRow({ note, bot, onOpen }: { note: InboxNote; bot: Bot | undefined; onOpen: (note: InboxNote) => void }) {
  return (
    <li data-inbox-note={note.id} data-inbox-read={note.read ? "true" : "false"}>
      <button
        type="button"
        onClick={() => onOpen(note)}
        className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-raised/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      >
        <Face bot={bot} size={24} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 text-[13px]">
            {!note.read && <span className="size-1.5 shrink-0 self-center rounded-full bg-accent"><span className="sr-only">{t("inbox.note.unread")}</span></span>}
            <span className={cn("min-w-0 flex-1 truncate", note.read ? "text-ink-secondary" : "font-medium text-ink")}>{note.title}</span>
            <time className="shrink-0 text-[11.5px] tabular-nums text-ink-tertiary" dateTime={new Date(note.at).toISOString()}>{ago(note.at)}</time>
          </span>
          {note.body && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-5 text-ink-secondary">{note.body}</span>}
          {note.resolvedAt !== undefined && <span className="mt-0.5 block text-[11.5px] text-ink-tertiary">{t("inbox.note.resolved")}</span>}
        </span>
      </button>
    </li>
  );
}
