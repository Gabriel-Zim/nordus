import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { usePageVisible } from "@/lib/page-visible";
import { useViewer } from "@/lib/use-viewer";
import { sameEmail } from "@/lib/viewer";
import { loadConversations, loadEarlier, markRead, openThread, sendLine, useDirect, type DirectThread } from "@/state/direct-messages";
import { formatTime } from "@/state/store";
import type { DirectMessage } from "../../../shared/people";
import { useCaptionChrome } from "../DesktopCapabilities";
import { PersonAvatar } from "./PersonAvatar";

export function DirectLines({ lines, selfEmail }: { lines: readonly DirectMessage[]; selfEmail: string | undefined }) {
  return (
    <>
      {lines.map((line) => {
        const mine = sameEmail(line.from, selfEmail);
        return (
          <div key={line.id} data-dm-line={line.id} data-mine={mine || undefined} className={cn("flex flex-col gap-0.5", mine ? "items-end" : "items-start")}>
            <div className={cn(
              "max-w-[min(34rem,85%)] whitespace-pre-wrap break-words rounded-2xl border px-3.5 py-2 text-[14px] leading-relaxed",
              mine ? "border-accent/30 bg-accent/15 text-ink" : "border-white/10 bg-white/[0.05] text-ink",
            )}>
              {line.text}
            </div>
            <span className="px-1 text-[11px] text-ink-tertiary">{formatTime(line.at)}</span>
          </div>
        );
      })}
    </>
  );
}

function DirectComposer({ name, busy, failed, onSend }: { name: string; busy: boolean; failed: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);
  const send = async () => {
    const clean = text.trim();
    if (!clean || busy) return;
    if (await onSend(clean)) {
      setText("");
      box.current?.focus();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };
  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
        {failed && <p role="alert" className="px-1 text-[12px] text-danger">{t("dm.sendError")}</p>}
        <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 focus-within:border-accent-border">
          <textarea
            ref={box}
            data-dm-composer=""
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={8000}
            placeholder={t("dm.placeholder", { name })}
            aria-label={t("dm.placeholder", { name })}
            className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <button
            type="button"
            data-dm-send=""
            disabled={busy || !text.trim()}
            onClick={() => void send()}
            aria-label={t("dm.send")}
            title={t("dm.send")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:brightness-110 disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={17} strokeWidth={2.25} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_THREAD: DirectThread = { messages: [], hasMore: false, loading: false, failed: false };

export function DirectMessageView({ id }: { id: string }) {
  const viewer = useViewer();
  const direct = useDirect();
  const visible = usePageVisible();
  const { dragProps } = useCaptionChrome();
  const dm = direct.dms.find((item) => item.id === id);
  const thread = direct.threads[id] ?? EMPTY_THREAD;
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const keepOffset = useRef<{ height: number; top: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

  useEffect(() => {
    void openThread(id);
    if (!direct.dms.some((item) => item.id === id)) void loadConversations();
  }, [id]);

  useEffect(() => {
    if (dm?.unread && visible) void markRead(id);
  }, [id, dm?.unread, visible]);

  const newest = thread.messages.at(-1)?.id;
  const oldest = thread.messages[0]?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current) {
      el.scrollTop = el.scrollHeight - keepOffset.current.height + keepOffset.current.top;
      keepOffset.current = null;
    } else if (following.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [newest, oldest]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const earlier = () => {
    const el = scroller.current;
    if (el) keepOffset.current = { height: el.scrollHeight, top: el.scrollTop };
    void loadEarlier(id);
  };
  const send = async (text: string) => {
    setSending(true);
    setSendFailed(false);
    try {
      following.current = true;
      await sendLine(id, text);
      return true;
    } catch {
      setSendFailed(true);
      return false;
    } finally {
      setSending(false);
    }
  };

  if (!dm) {
    return (
      <main data-dm-view="" className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-app px-6 text-center text-[13px] text-ink-secondary">
        {direct.loaded ? t("dm.missing") : <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
      </main>
    );
  }

  return (
    <main data-dm-view={id} className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <header {...dragProps} className="flex shrink-0 items-center gap-3 border-b border-hairline/40 px-6 py-3.5 max-md:pl-14">
        <PersonAvatar name={dm.peerName} size={36} />
        <div className="min-w-0">
          <h1 className="nb-name truncate text-[16px] font-semibold">{dm.peerName}</h1>
          <p className="truncate text-[12px] text-ink-secondary">{t("dm.private")}</p>
        </div>
      </header>
      <div ref={scroller} onScroll={onScroll} role="log" aria-live="polite" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-5">
          {thread.hasMore && (
            <button type="button" data-dm-earlier="" disabled={thread.loading} onClick={earlier} className="self-center rounded-full px-3 py-1 text-[12px] font-medium text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50">
              {t("dm.older")}
            </button>
          )}
          {thread.failed && (
            <div role="alert" className="flex items-center justify-center gap-3 text-[13px] text-danger">
              {t("dm.loadFailed")}
              <button type="button" onClick={() => void openThread(id)} className="font-medium text-accent hover:underline">{t("dm.retry")}</button>
            </div>
          )}
          {thread.messages.length === 0 && !thread.loading && !thread.failed && <p className="py-8 text-center text-[13px] text-ink-secondary">{t("dm.empty")}</p>}
          {thread.messages.length === 0 && thread.loading && <Loader2 size={16} className="mx-auto animate-spin text-ink-secondary" aria-label={t("dm.loading")} />}
          <DirectLines lines={thread.messages} selfEmail={viewer.email} />
        </div>
      </div>
      <DirectComposer name={dm.peerName} busy={sending} failed={sendFailed} onSend={send} />
    </main>
  );
}
