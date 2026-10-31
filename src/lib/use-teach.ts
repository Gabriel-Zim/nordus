import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/state/store";
import { listenLiveFrames } from "@/lib/live-events";
import type { TeachStatus } from "../../shared/teach";
import { visibleInterval } from "./visible-interval";

export const TEACH_POLL_MS = 1_500;

export const IDLE_TEACH: TeachStatus = { recording: false, steps: [] };

/** True while the bar has something to show: recording, or summarizing after the stop. */
export function teachActive(status: TeachStatus): boolean {
  return status.recording || status.state === "summarizing";
}

/** The `teach.status` broadcast, read defensively because its shape is not in the typed frame union. */
export function teachStatusFromFrame(frame: unknown, botId: string): TeachStatus | null {
  if (!frame || typeof frame !== "object") return null;
  const raw = frame as { kind?: unknown; botId?: unknown; status?: unknown; event?: unknown };
  const body = raw.kind === "teach.status" ? raw : (raw.kind === "teach" ? (raw.event as typeof raw | undefined) : undefined);
  if (!body || typeof body !== "object" || body.botId !== botId) return null;
  const status = body.status as Partial<TeachStatus> | undefined;
  if (!status || typeof status !== "object" || typeof status.recording !== "boolean") return null;
  return { ...status, recording: status.recording, steps: Array.isArray(status.steps) ? status.steps : [] };
}

export interface TeachController {
  status: TeachStatus;
  /** Starts recording; resolves with a pt-BR refusal text when the server says no. */
  start(): Promise<{ ok: true } | { ok: false; error: string }>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
}

export function useTeach(botId: string | undefined, threadId: string, enabled: boolean): TeachController {
  const [status, setStatus] = useState<TeachStatus>(IDLE_TEACH);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!botId) return;
    try {
      const next = await api<TeachStatus>(`/api/bots/${botId}/teach`);
      if (alive.current) setStatus(next);
    } catch {
      // The bar stays as it was; the next tick tries again.
    }
  }, [botId]);

  useEffect(() => {
    setStatus(IDLE_TEACH);
    if (!botId || !enabled) return;
    void refresh();
    return listenLiveFrames({
      onFrame: (frame) => {
        const next = teachStatusFromFrame(frame, botId);
        if (next) setStatus(next);
      },
      onMissedFrames: () => void refresh(),
    });
  }, [botId, enabled, refresh]);

  const active = teachActive(status);
  useEffect(() => {
    if (!botId || !enabled || !active) return;
    return visibleInterval(() => void refresh(), TEACH_POLL_MS);
  }, [botId, enabled, active, refresh]);

  const start = useCallback(async () => {
    if (!botId) return { ok: false as const, error: "" };
    try {
      const next = await api<TeachStatus>(`/api/bots/${botId}/teach/start`, {
        method: "POST",
        body: JSON.stringify({ threadId }),
      });
      if (alive.current) setStatus(next);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "" };
    }
  }, [botId, threadId]);

  const stop = useCallback(async () => {
    if (!botId) return;
    setStatus((current) => ({ ...current, recording: false, state: "summarizing" }));
    try {
      await api(`/api/bots/${botId}/teach/stop`, { method: "POST", body: "{}" });
    } catch {
      // A refused stop shows up as the real status on the next refresh.
    }
    await refresh();
  }, [botId, refresh]);

  const cancel = useCallback(async () => {
    if (!botId) return;
    setStatus(IDLE_TEACH);
    try {
      await api(`/api/bots/${botId}/teach/cancel`, { method: "POST", body: "{}" });
    } catch {
      // Same as stop.
    }
  }, [botId]);

  return { status, start, stop, cancel };
}
