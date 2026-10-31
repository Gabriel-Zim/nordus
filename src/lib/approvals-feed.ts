import { useSyncExternalStore } from "react";
import { api } from "@/state/api";
import { listenLiveFrames } from "@/lib/live-events";
import { visibleInterval } from "@/lib/visible-interval";
import { APPROVALS_PATH, approvalId, type ApprovalItem } from "../../shared/approvals";
import type { ServerFrame } from "../../shared/wire";

export interface ApprovalsSnapshot {
  items: readonly ApprovalItem[];
  loaded: boolean;
  /** The last ask did not get an answer; `items` is then what the last good one said. */
  failed: boolean;
}

const REFRESH_MS = 60_000;
const COALESCE_MS = 250;
const EMPTY: ApprovalsSnapshot = { items: [], loaded: false, failed: false };

let snapshot: ApprovalsSnapshot = EMPTY;
const subscribers = new Set<() => void>();
let stop: (() => void) | null = null;
let pendingLoad: ReturnType<typeof setTimeout> | null = null;
let request = 0;

function publish(next: ApprovalsSnapshot): void {
  if (next.loaded === snapshot.loaded && next.failed === snapshot.failed && JSON.stringify(next.items) === JSON.stringify(snapshot.items)) return;
  snapshot = next;
  for (const listener of Array.from(subscribers)) listener();
}

export async function loadApprovals(background = true): Promise<void> {
  const id = ++request;
  try {
    const answer = await api<{ items?: ApprovalItem[] }>(APPROVALS_PATH, { timeoutMs: 20_000, background });
    if (id === request) publish({ items: Array.isArray(answer.items) ? answer.items : [], loaded: true, failed: false });
  } catch {
    if (id === request) publish({ items: snapshot.items, loaded: true, failed: true });
  }
}

export function refreshApprovals(): void {
  if (pendingLoad) return;
  pendingLoad = setTimeout(() => {
    pendingLoad = null;
    void loadApprovals();
  }, COALESCE_MS);
}

const WAITING_LINES: ReadonlySet<string> = new Set(["options", "signin", "secret", "connector"]);

export function frameTouchesApprovals(frame: ServerFrame): boolean {
  switch (frame.kind) {
    case "message":
    case "message.patch":
      return WAITING_LINES.has(frame.message.kind);
    case "notify":
    case "notify.resolved":
    case "bot.deleted":
    case "group.deleted":
      return true;
    default:
      return false;
  }
}

function begin(): void {
  void loadApprovals();
  const unlisten = listenLiveFrames({
    onFrame: (frame) => { if (frameTouchesApprovals(frame)) refreshApprovals(); },
    onMissedFrames: refreshApprovals,
  });
  const unpoll = visibleInterval(() => void loadApprovals(), REFRESH_MS);
  const onFocus = () => refreshApprovals();
  window.addEventListener("focus", onFocus);
  stop = () => {
    unlisten();
    unpoll();
    window.removeEventListener("focus", onFocus);
    if (pendingLoad) clearTimeout(pendingLoad);
    pendingLoad = null;
  };
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  if (subscribers.size === 1) begin();
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) {
      stop?.();
      stop = null;
      request += 1;
      snapshot = EMPTY;
    }
  };
}

export function useApprovalsFeed(): ApprovalsSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

export function itemFor(items: readonly ApprovalItem[], threadId: string | undefined, messageId: string): ApprovalItem | undefined {
  return threadId ? items.find((item) => item.id === approvalId(threadId, messageId)) : undefined;
}

export function decidableCount(items: readonly ApprovalItem[]): number {
  return items.filter((item) => item.canDecide).length;
}
