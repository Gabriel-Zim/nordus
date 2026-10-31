import { useEffect, useRef, useState } from "react";
import { ExternalLink, Mic, MicOff, PhoneOff, RotateCcw, Settings, X } from "lucide-react";

import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import {
  dismissLiveNotice, hangUpLiveCall, isLiveCallRunning, liveCallChord, setLiveMuted, takeLiveCallAction, useLiveMedia,
  type LiveCallAction, type LiveMediaState,
} from "@/lib/live-call-media";
import { api, liveCallFromFrame, nextLiveCallLookup, useStore, type Action, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import type { LiveCallState, LiveClient } from "../../shared/wire";
import { LiveCallSettings } from "./LiveCallSettings";
import { BotAvatar } from "./Avatar";
import { VoiceWave } from "./VoiceWave";

export type LiveCallBarView =
  | { kind: "local"; title: string; clock: string; caption: string; heard: string; muted: boolean; ending: boolean; hint: string | null }
  | { kind: "remote"; title: string; callId: string }
  | { kind: "notice"; text: string; action: LiveCallAction | null };

const DEVICE_KEY = {
  ios: "call.live.device.ios",
  android: "call.live.device.android",
  desktop: "call.live.device.desktop",
  web: "call.live.device.web",
} as const satisfies Record<LiveClient, string>;

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function liveCallBarView({ bot, media, server, now }: {
  bot: { id: string; threadId: string; name: string };
  media: LiveMediaState;
  server: LiveCallState | null;
  now: number;
}): LiveCallBarView | null {
  const here = media.botId === bot.id && media.threadId === bot.threadId;
  if (here && (media.phase === "failed" || media.phase === "ended") && media.notice) {
    return { kind: "notice", text: media.notice, action: media.phase === "failed" ? media.action : null };
  }
  if (here && isLiveCallRunning(media.phase)) {
    const when = media.startedAt !== null ? clock(now - media.startedAt) : t("call.live.connecting");
    return {
      kind: "local",
      title: media.hangingUp ? t("call.live.hangingUp") : `${t("call.live.with", { name: bot.name })} · ${when}`,
      clock: when,
      caption: media.caption,
      heard: media.heard,
      muted: media.muted,
      ending: media.phase === "ending",
      hint: media.notice,
    };
  }
  if (
    server && server.status !== "ending" && server.status !== "ended"
    && server.botId === bot.id && server.threadId === bot.threadId && server.callId !== media.callId
  ) {
    return { kind: "remote", title: t("call.live.onPhone", { name: bot.name, device: t(DEVICE_KEY[server.client]) }), callId: server.callId };
  }
  return null;
}

export function liveLineHeldElsewhere(media: LiveMediaState, server: LiveCallState | null): boolean {
  return Boolean(server && server.status !== "ended") && !isLiveCallRunning(media.phase);
}

export async function hangUpRemoteCall(
  callId: string,
  since: number,
  dispatch: (action: Action) => void,
  request: typeof api = api,
): Promise<void> {
  try {
    await request("/api/live/call/end", { method: "POST", body: JSON.stringify({ callId }) });
  } catch {
    try {
      const seq = nextLiveCallLookup();
      const answer = liveCallFromFrame(await request<unknown>("/api/live/call"));
      if (answer) dispatch({ type: "liveCallLookup", call: answer.call, since, seq });
    } catch {
    }
  }
}

export function LiveCallBar({ bot, placement = "bottom" }: { bot: Bot; placement?: "top" | "bottom" }) {
  const { state, dispatch } = useStore();
  const media = useLiveMedia();
  const [now, setNow] = useState(() => Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const view = liveCallBarView({ bot, media, server: state.liveCall, now });
  const kind = view?.kind;

  useEffect(() => {
    if (kind !== "local") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [kind]);

  useEffect(() => {
    if (kind !== "local") setSettingsOpen(false);
  }, [kind]);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || rootRef.current?.contains(event.target)) return;
      // The Select's menu is drawn in a portal outside this bar; picking from it is not an outside click.
      if (event.target.closest("[data-nordus-select-menu]")) return;
      setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [settingsOpen]);

  if (!view) return null;
  if ((placement === "top") !== (view.kind === "local")) return null;
  const button = "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium transition-colors";
  const frame = "pointer-events-auto mx-5 mb-2 flex items-center rounded-xl border bg-panel px-3 py-2 text-[12.5px] text-ink";

  if (view.kind === "notice") {
    const action = view.action === "open-in-browser"
      ? { label: t("call.live.openInBrowser"), Icon: ExternalLink }
      : view.action === "retry" ? { label: t("call.live.tryAgain"), Icon: RotateCcw } : null;
    return (
      <div role="status" className={cn(frame, "gap-2 border-hairline/60")}>
        <span className="min-w-0 flex-1 truncate" title={view.text}>{view.text}</span>
        {action && (
          <button type="button" aria-label={action.label} className={cn(button, "bg-raised hover:bg-raised-hover")} onClick={takeLiveCallAction}>
            <action.Icon className="size-3.5" /> <span className="hidden sm:inline">{action.label}</span>
          </button>
        )}
        <button type="button" aria-label={t("call.live.close")} className={cn(button, "text-ink-secondary hover:text-ink")} onClick={dismissLiveNotice}>
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  if (view.kind === "remote") {
    const callId = view.callId;
    return (
      <div role="status" className={cn(frame, "gap-2 border-success/40")}>
        <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{view.title}</span>
        <button
          type="button"
          aria-label={t("call.live.hangUp")}
          className={cn(button, "bg-danger text-white hover:brightness-110")}
          onClick={() => void hangUpRemoteCall(callId, state.liveCallVersion, dispatch)}
        >
          <PhoneOff className="size-3.5" /> <span className="hidden sm:inline">{t("call.live.hangUp")}</span>
        </button>
      </div>
    );
  }

  const isMac = isMacPlatform();
  const muteLabel = view.muted ? t("call.live.unmute") : t("call.live.mute");
  const muteChord = liveCallChord("mute", isMac);
  const hangUpChord = liveCallChord("hangUp", isMac);
  const round = "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <div className="pointer-events-none flex flex-col items-center gap-1 px-5 pb-2">
      <div
        ref={rootRef}
        role="region"
        aria-label={t("call.live.with", { name: bot.name })}
        data-live-pill=""
        className="pointer-events-auto relative flex items-center gap-2 rounded-[22px] border border-white/10 py-1.5 pl-1.5 pr-1.5 text-ink shadow-[0_18px_44px_-18px_rgba(0,0,0,0.7)]"
        style={{ background: "var(--color-menu)" }}
      >
        <span className="sr-only">{view.title}</span>
        <BotAvatar bot={bot} size={28} animated={false} />
        <VoiceWave muted={view.muted} />
        <span className="min-w-10 shrink-0 whitespace-nowrap text-center font-mono text-[11px] tabular-nums text-ink-tertiary" title={view.title}>{view.clock}</span>
        <button
          ref={gearRef}
          type="button"
          aria-label={t("call.live.settings")}
          title={t("call.live.settings")}
          aria-expanded={settingsOpen}
          aria-haspopup="dialog"
          className={cn(round, settingsOpen ? "bg-white/10 text-ink" : "text-ink-secondary hover:bg-white/[0.06] hover:text-ink")}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Settings className="size-4" />
        </button>
        <button
          type="button"
          aria-pressed={view.muted}
          aria-label={muteLabel}
          aria-keyshortcuts={muteChord.aria}
          title={`${muteLabel} (${muteChord.text})`}
          className={cn(round, view.muted ? "bg-white/15 text-ink" : "text-ink-secondary hover:bg-white/[0.06] hover:text-ink")}
          onClick={() => setLiveMuted(!view.muted)}
        >
          {view.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>
        <button
          type="button"
          disabled={view.ending}
          aria-label={t("call.live.hangUp")}
          aria-keyshortcuts={hangUpChord.aria}
          title={`${t("call.live.hangUp")} (${hangUpChord.text})`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60 disabled:opacity-60"
          onClick={() => void hangUpLiveCall()}
        >
          <X className="size-4" strokeWidth={2.5} />
        </button>
        {settingsOpen && (
          <div className="absolute right-0 top-full z-40 mt-2">
            <LiveCallSettings
              bot={bot}
              onClose={() => {
                setSettingsOpen(false);
                gearRef.current?.focus();
              }}
            />
          </div>
        )}
      </div>
      {view.hint && <span role="status" className="pointer-events-auto max-w-full truncate text-[11.5px] text-warning" title={view.hint}>{view.hint}</span>}
    </div>
  );
}
