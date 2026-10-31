import { useEffect, useRef } from "react";
import { api, useStore, type Action, type AppState } from "@/state/store";
import { sendOutbox, voiceBlobs, voiceNoteTransport } from "@/lib/app-outbox";
import type { OutboxEntry } from "@/lib/send-outbox";

const DELIVER_TIMEOUT_MS = 90_000;

export function outboxSendAction(
  entry: OutboxEntry & { requestText: string },
  settle: { onSent: () => void; onError: (error: unknown) => void },
): Action {
  const common = { text: entry.requestText, sendId: entry.sendId, replyToId: entry.replyToId, threadId: entry.threadId, quiet: true, ...settle };
  return entry.target.kind === "group"
    ? { type: "sendGroup", groupId: entry.target.groupId, mode: entry.target.mode, ...common }
    : { type: "send", botId: entry.target.botId, ...(entry.dataContext ? { dataContext: entry.dataContext } : {}), ...common };
}

/** A request on a dead connection can hang for minutes on a phone; the retry reuses the sendId, so the server takes it once. */
export function outboxDelivery(dispatch: (action: Action) => void, timeoutMs = DELIVER_TIMEOUT_MS) {
  return (entry: OutboxEntry & { requestText: string }) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("send timed out")), timeoutMs);
    dispatch(outboxSendAction(entry, {
      onSent: () => { clearTimeout(timer); resolve(); },
      onError: (error) => { clearTimeout(timer); reject(error); },
    }));
  });
}

export function outboxTargetLoaded(state: Pick<AppState, "bots" | "groups">, entry: OutboxEntry): boolean {
  const { target } = entry;
  return target.kind === "group"
    ? state.groups.some((group) => group.id === target.groupId)
    : state.bots.some((bot) => bot.id === target.botId);
}

export function SendOutboxDriver() {
  const { state, dispatch } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const voiceNote = voiceNoteTransport(api, voiceBlobs);
    sendOutbox.attach({
      ready: (entry) => outboxTargetLoaded(stateRef.current, entry),
      voiceNote,
      deliver: outboxDelivery(dispatch),
    });
    return () => sendOutbox.attach(undefined);
  }, [dispatch]);
  const loaded = state.bots.length + state.groups.length;
  useEffect(() => {
    if (loaded) sendOutbox.drain();
  }, [loaded]);
  return null;
}
