import { useEffect, useMemo, useRef, useState } from "react";
import { pendingApprovals, type Pending } from "@/components/PendingApproval";
import { activeLocale } from "@/lib/i18n";
import { buildNotchFeed, notchLabels, waitingElsewhere, type NotchAnswer } from "@/lib/notch-feed";
import { api, STARTUP_MESSAGES, type Action, type AppState, type Message } from "@/state/store";

type Loaded = ReadonlyMap<string, { version: string; pending?: Pending }>;

function useRequestsElsewhere(bots: AppState["bots"], on: boolean): ReadonlyMap<string, Pending | undefined> {
  const waiting = useMemo(() => (on ? waitingElsewhere(bots) : []), [bots, on]);
  const [loaded, setLoaded] = useState<Loaded>(new Map());
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    for (const { threadId, version } of waiting) {
      const token = `${threadId}:${version}`;
      if (asked.current.has(token)) continue;
      asked.current.add(token);
      api<{ messages?: Message[] }>(`/api/threads/${threadId}/messages?limit=${STARTUP_MESSAGES}`)
        .then((page) => {
          if (mounted.current) setLoaded((map) => new Map(map).set(threadId, { version, pending: pendingApprovals(page.messages ?? [])[0] }));
        })
        .catch(() => {});
    }
  }, [waiting]);
  return useMemo(
    () => new Map(waiting.flatMap(({ threadId, version }) => {
      const hit = loaded.get(threadId);
      return hit && hit.version === version ? [[threadId, hit.pending] as const] : [];
    })),
    [waiting, loaded],
  );
}

/**
 * Tells the desktop's notch what the agents are doing and which requests wait for the person, and carries out the
 * Approve or Decline tapped there exactly as the card in the conversation does. Nothing happens off a Mac desktop.
 */
export function useNotchFeed(state: Pick<AppState, "bots">, dispatch: (action: Action) => void): void {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.notch;
  const elsewhere = useRequestsElsewhere(state.bots, Boolean(bridge));
  const locale = activeLocale();
  const built = useMemo(() => (bridge ? buildNotchFeed(state.bots, elsewhere) : null), [bridge, state.bots, elsewhere, locale]);
  const answers = useRef<ReadonlyMap<string, NotchAnswer>>(new Map());
  answers.current = built?.answers ?? new Map();
  const sent = useRef("");

  useEffect(() => {
    if (!bridge || !built) return;
    const body = JSON.stringify(built.wire);
    if (body === sent.current) return;
    sent.current = body;
    bridge.publish(built.wire).catch(() => { sent.current = ""; });
  }, [bridge, built]);

  useEffect(() => {
    if (!bridge) return;
    const stop = bridge.onDecision(({ id, decision }) => {
      const answer = answers.current.get(id);
      if (!answer || (decision !== "approve" && decision !== "decline")) return;
      dispatch({
        type: "decideRequest",
        threadId: answer.threadId,
        requestId: answer.requestId,
        behavior: decision === "approve" ? "allow" : "deny",
        message: decision === "decline" ? "Denied by the user." : undefined,
      });
    });
    return () => {
      stop();
      sent.current = "";
      bridge.publish({ agents: [], approvals: [], labels: notchLabels() }).catch(() => {});
    };
  }, [bridge, dispatch]);
}
