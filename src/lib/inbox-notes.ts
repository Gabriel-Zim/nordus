import { useCallback, useEffect, useRef, useState } from "react";
import { listenLiveFrames } from "@/lib/live-events";
import { visibleInterval } from "@/lib/visible-interval";
import { api } from "@/state/api";
import { INBOX_PATH, type InboxNote, type InboxSections } from "../../shared/approvals";
import type { ServerFrame } from "../../shared/wire";

const REFRESH_MS = 60_000;
const COALESCE_MS = 400;

export interface InboxNotes {
  forYou: readonly InboxNote[];
  before: readonly InboxNote[];
  loaded: boolean;
  failed: boolean;
  reload: () => void;
}

const NOTE_FRAMES: ReadonlySet<ServerFrame["kind"]> = new Set(["notify", "notify.resolved", "bot.deleted", "group.deleted"]);

export function useInboxNotes(waitingKey: string): InboxNotes {
  const [notes, setNotes] = useState<Omit<InboxNotes, "reload">>({ forYou: [], before: [], loaded: false, failed: false });
  const request = useRef(0);
  const first = useRef(true);

  const load = useCallback(async (background: boolean) => {
    const id = ++request.current;
    try {
      const answer = await api<Partial<InboxSections>>(INBOX_PATH, { timeoutMs: 20_000, background });
      if (id !== request.current) return;
      setNotes({
        forYou: Array.isArray(answer.forYou) ? answer.forYou : [],
        before: Array.isArray(answer.before) ? answer.before : [],
        loaded: true,
        failed: false,
      });
    } catch {
      if (id === request.current) setNotes((current) => ({ ...current, loaded: true, failed: true }));
    }
  }, []);

  useEffect(() => {
    void load(false);
    let soon: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (soon) return;
      soon = setTimeout(() => {
        soon = null;
        void load(true);
      }, COALESCE_MS);
    };
    const unlisten = listenLiveFrames({
      onFrame: (frame) => { if (NOTE_FRAMES.has(frame.kind)) refresh(); },
      onMissedFrames: refresh,
    });
    const unpoll = visibleInterval(() => void load(true), REFRESH_MS);
    return () => {
      unlisten();
      unpoll();
      if (soon) clearTimeout(soon);
      request.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(true);
  }, [waitingKey, load]);

  const reload = useCallback(() => void load(false), [load]);
  return { ...notes, reload };
}
