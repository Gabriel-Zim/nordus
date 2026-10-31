import { useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Loader2 } from "lucide-react";
import { decidableCount, loadApprovals, refreshApprovals, useApprovalsFeed } from "@/lib/approvals-feed";
import { t } from "@/lib/i18n";
import { useInboxNotes } from "@/lib/inbox-notes";
import { useShowThreads } from "@/lib/thread-preferences";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { openThread, useStore } from "@/state/store";
import type { ApprovalItem, InboxNote } from "../../shared/approvals";
import { useViewer } from "./ApprovalCardParts";
import { useCaptionChrome } from "./DesktopCapabilities";
import { InboxExpiryPicker } from "./InboxExpiryPicker";
import { NoteRow, SettledRow, WaitingRow, type Outcome } from "./InboxRows";

const SETTLED_MS = 4_500;

type Settled = ReadonlyMap<string, { item: ApprovalItem; outcome: Outcome }>;

function useSettled() {
  const [settled, setSettled] = useState<Settled>(new Map());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);
  const settle = (item: ApprovalItem, outcome: Outcome) => {
    setSettled((current) => new Map(current).set(item.id, { item, outcome }));
    refreshApprovals();
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setSettled((current) => {
        const next = new Map(current);
        next.delete(item.id);
        return next;
      });
    }, SETTLED_MS);
    timers.current.add(timer);
  };
  return { settled, settle };
}

function Loading() {
  return (
    <div role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      {t("inbox.loading")}
    </div>
  );
}

function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-card px-4 py-3 text-[13px]">
      <span className="text-danger">{message}</span>
      <button type="button" className="ui-button ui-button-sm" onClick={onRetry}>{t("inbox.retry")}</button>
    </div>
  );
}

function Empty({ id, text }: { id?: string; text: string }) {
  return <p data-testid={id} className="rounded-xl bg-card px-4 py-4 text-[13px] text-ink-secondary">{text}</p>;
}

export function InboxPage() {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { dragProps, noDragStyle } = useCaptionChrome();
  const feed = useApprovalsFeed();
  const viewer = useViewer().name;
  const admin = useOwnerOrAdmin();
  const { settled, settle } = useSettled();
  const waitingKey = useMemo(() => feed.items.map((item) => item.id).join(" "), [feed.items]);
  const notes = useInboxNotes(waitingKey);

  const botOf = (id: string) => state.bots.find((bot) => bot.id === id);
  const open = (target: { botId: string; threadId: string; requestId?: string }) => openThread(dispatch, target, state, showThreads);
  const openItem = (item: ApprovalItem) => open({ botId: item.botId, threadId: item.threadId, ...(item.requestId ? { requestId: item.requestId } : {}) });
  const openNote = (note: InboxNote) => open({ botId: note.botId, threadId: note.threadId, ...(note.requestId ? { requestId: note.requestId } : {}) });

  const waiting = feed.items;
  const count = decidableCount(waiting);
  const closed = [...settled.values()].filter(({ item }) => !waiting.some((candidate) => candidate.id === item.id));

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink" data-testid="inbox-page">
      <header {...dragProps} className="flex shrink-0 items-center gap-2.5 border-b border-hairline/40 px-6 py-4 max-md:pl-12">
        <Inbox size={18} className="text-ink-secondary" aria-hidden="true" />
        <h1 className="text-[17px] font-semibold">{t("inbox.title")}</h1>
        {count > 0 && (
          <span data-testid="inbox-count" className="rounded-full bg-danger px-2 py-0.5 text-[11.5px] font-semibold tabular-nums leading-4 text-white">
            {count}
            <span className="sr-only"> {t("inbox.count.label")}</span>
          </span>
        )}
        <div style={noDragStyle} className="ml-auto">{admin === true && <InboxExpiryPicker />}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-6">
          <section aria-labelledby="inbox-waiting" data-testid="inbox-waiting" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 id="inbox-waiting" className="text-[15px] font-medium">{t("inbox.waiting.title")}</h2>
              {viewer && <span className="text-[12px] text-ink-tertiary">{t("approvals.youAre", { name: viewer })}</span>}
            </div>
            {feed.failed && <Failed message={t("inbox.loadFailed")} onRetry={() => void loadApprovals(false)} />}
            {!feed.loaded ? <Loading /> : waiting.length || closed.length ? (
              <ul className="flex flex-col divide-y divide-hairline/40 rounded-xl border border-warning/30 bg-card">
                {closed.map(({ item, outcome }) => <SettledRow key={item.id} item={item} outcome={outcome} />)}
                {waiting.map((item) => {
                  const done = settled.get(item.id);
                  return done
                    ? <SettledRow key={item.id} item={item} outcome={done.outcome} />
                    : <WaitingRow key={item.id} item={item} bot={botOf(item.botId)} onOpen={openItem} onDecided={settle} onFailed={refreshApprovals} />;
                })}
              </ul>
            ) : feed.failed ? null : <Empty id="inbox-empty" text={t("inbox.waiting.empty")} />}
          </section>

          {notes.failed && <Failed message={t("inbox.notes.failed")} onRetry={notes.reload} />}

          <section aria-labelledby="inbox-for-you" data-testid="inbox-for-you" className="flex flex-col gap-2">
            <h2 id="inbox-for-you" className="text-[15px] font-medium">{t("inbox.forYou.title")}</h2>
            {!notes.loaded ? <Loading /> : notes.forYou.length ? (
              <ul className="flex flex-col divide-y divide-hairline/40 rounded-xl bg-card">
                {notes.forYou.map((note) => <NoteRow key={note.id} note={note} bot={botOf(note.botId)} onOpen={openNote} />)}
              </ul>
            ) : <Empty text={t("inbox.forYou.empty")} />}
          </section>

          <section aria-labelledby="inbox-before" data-testid="inbox-before" className="flex flex-col gap-2">
            <h2 id="inbox-before" className="text-[15px] font-medium">{t("inbox.before.title")}</h2>
            {!notes.loaded ? null : notes.before.length ? (
              <ul className="flex flex-col divide-y divide-hairline/40 rounded-xl bg-card">
                {notes.before.map((note) => <NoteRow key={note.id} note={note} bot={botOf(note.botId)} onOpen={openNote} />)}
              </ul>
            ) : <Empty text={t("inbox.before.empty")} />}
          </section>
        </div>
      </div>
    </main>
  );
}
