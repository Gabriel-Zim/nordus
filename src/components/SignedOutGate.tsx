import { useSyncExternalStore } from "react";
import { sendOutbox } from "@/lib/app-outbox";
import type { OutboxEntry } from "@/lib/send-outbox";
import { useSignedOut } from "@/lib/signed-out";
import { NordusLoginPage } from "@/pair/NordusLoginPage";
import { useStore, type AppState } from "@/state/store";

export const SIGNED_OUT_NOTICE = "Este navegador saiu da sua conta. Entre de novo: as mensagens que ficaram na fila vão sozinhas depois.";

/**
 * After Google, back to the conversation that was waiting: the oldest queued send's, else the one on screen. It rides the
 * same URL a notification uses to open a conversation (src/lib/web-push.ts takeNotificationTarget).
 */
export function signInReturnPath(
  queued: ReadonlyArray<Pick<OutboxEntry, "status" | "target" | "threadId">>,
  state: Pick<AppState, "activeView" | "selectedId" | "bots" | "groups">,
): string {
  const waiting = queued.find((entry) => entry.status === "queued");
  const open = state.activeView === "chat"
    ? state.bots.find((bot) => bot.id === state.selectedId) ?? state.groups.find((group) => group.id === state.selectedId)
    : undefined;
  const target = waiting
    ? { id: waiting.target.kind === "bot" ? waiting.target.botId : waiting.target.groupId, threadId: waiting.threadId }
    : open ? { id: open.id, threadId: open.threadId } : null;
  if (!target || !/^[\w-]{1,128}$/.test(target.id) || !/^[\w-]{1,128}$/.test(target.threadId)) return "/";
  return `/?${new URLSearchParams({ "notification-bot": target.id, "notification-thread": target.threadId })}`;
}

/** A browser that lost its session (a dropped cookie, a revoked device) gets the Google sign-in over the app, not sends that fail one by one. */
export function SignedOutGate() {
  const signedOut = useSignedOut();
  const { state } = useStore();
  const queued = useSyncExternalStore(sendOutbox.subscribe, sendOutbox.entries, sendOutbox.entries);
  if (!signedOut) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Entrar" className="fixed inset-0 z-[1000] overflow-y-auto bg-app">
      <NordusLoginPage notice={SIGNED_OUT_NOTICE} returnTo={signInReturnPath(queued, state)} googleOnly />
    </div>
  );
}
