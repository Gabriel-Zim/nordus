import { useEffect, useRef, useState } from "react";
import { pendingApprovals, type Pending } from "@/components/PendingApproval";
import { api, type Message } from "@/state/store";

export type WaitingApproval = { threadId: string; pending?: Pending; loading: boolean };

/** The approval a bot waits on, wherever it waits. In the conversation on screen it is read from the loaded
 *  messages; in a side conversation it is read once, when the card opens, from that conversation's export. */
export function useWaitingApproval(
  bot: { threadId: string },
  waitingThreadId: string | undefined,
  visible: readonly Message[],
  active: boolean,
): WaitingApproval | undefined {
  const [side, setSide] = useState<{ threadId: string; pending?: Pending } | null>(null);
  const loadingFor = useRef<string | null>(null);
  const sideThread = waitingThreadId && waitingThreadId !== bot.threadId ? waitingThreadId : undefined;

  useEffect(() => {
    if (!active || !sideThread || side?.threadId === sideThread || loadingFor.current === sideThread) return;
    loadingFor.current = sideThread;
    let cancelled = false;
    void api<{ messages?: Message[] }>(`/api/threads/${encodeURIComponent(sideThread)}/export?format=json`)
      .then((body) => { if (!cancelled) setSide({ threadId: sideThread, pending: pendingApprovals(body.messages ?? []).at(-1) }); })
      .catch(() => { if (!cancelled) setSide({ threadId: sideThread }); })
      .finally(() => { if (loadingFor.current === sideThread) loadingFor.current = null; });
    return () => { cancelled = true; };
  }, [active, sideThread, side?.threadId]);

  // A new wait in the same side conversation (or the answer) must be read again next time.
  useEffect(() => { if (!waitingThreadId) setSide(null); }, [waitingThreadId]);

  if (!waitingThreadId) return undefined;
  if (!sideThread) return { threadId: bot.threadId, pending: pendingApprovals([...visible]).at(-1), loading: false };
  if (side?.threadId === sideThread) return { threadId: sideThread, pending: side.pending, loading: false };
  return { threadId: sideThread, loading: true };
}
