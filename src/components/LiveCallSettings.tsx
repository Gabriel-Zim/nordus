import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";

import { LIVE_VOICE_OPTIONS } from "../../shared/live-call";
import { t } from "@/lib/i18n";
import { liveDisclosure } from "@/lib/call-mode";
import { playVoiceSample } from "@/lib/live-voice-sample";
import { api, useStore, type Bot, type ConfigStatus } from "@/state/store";
import type { LiveSettings } from "../../shared/wire";
import { LiveKeySetup } from "./LiveKeySetup";
import { Select } from "./Select";

const AUTO_VOICE = "auto";
const IDLE_CHOICES = [1, 2, 3, 5, 10, 15, 30, 60];

export function LiveCallSettings({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const live: LiveSettings = state.config?.live ?? { configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 };
  const [saving, setSaving] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typedHintId = useId();
  // Stable, so this callback ref runs once when the popover mounts, not on every save.
  const focusOnOpen = useCallback((dialog: HTMLDivElement | null) => {
    dialog?.querySelector<HTMLElement>("select, input, button")?.focus();
  }, []);
  const auto = bot.liveVoiceSource === "auto";
  const botVoice = bot.liveVoice || live.voice || "marin";
  const voice = auto ? AUTO_VOICE : botVoice;
  const known = LIVE_VOICE_OPTIONS.some((option) => option.id === botVoice);
  const pickedLabel = LIVE_VOICE_OPTIONS.find((option) => option.id === bot.liveVoice)?.label.split(" — ")[0] ?? "";

  const [sample, setSample] = useState<"idle" | "loading" | "playing">("idle");
  const player = useRef<AbortController | null>(null);
  const stopSample = useCallback(() => {
    player.current?.abort();
    player.current = null;
    setSample("idle");
  }, []);
  useEffect(() => stopSample, [stopSample]);
  // A different voice ends the sample of the old one.
  useEffect(() => { stopSample(); }, [voice, stopSample]);

  const playSample = async () => {
    if (sample !== "idle") return stopSample();
    const abort = new AbortController();
    player.current = abort;
    setSample("loading");
    setError(null);
    try {
      await playVoiceSample(botVoice, { signal: abort.signal, onPlaying: () => { if (!abort.signal.aborted) setSample("playing"); } });
      if (player.current === abort) stopSample();
    } catch (sampleError) {
      if (abort.signal.aborted) return;
      stopSample();
      setError(sampleError instanceof Error ? sampleError.message : t("call.live.voiceSampleFailed"));
    }
  };

  const saveVoice = async (choice: string) => {
    setSaving(true);
    setError(null);
    try {
      await api("/api/live/bot-voice", { method: "PUT", body: JSON.stringify({ botId: bot.id, voice: choice }) });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const save = async (patch: Partial<Pick<LiveSettings, "voice" | "readTypedReplies" | "idleMinutes">>) => {
    setSaving(true);
    setError(null);
    try {
      const body = await api<{ live: LiveSettings }>("/api/live/settings", { method: "PATCH", body: JSON.stringify(patch) });
      if (state.config) dispatch({ type: "configStatus", config: { ...state.config, live: body.live } });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const status: ConfigStatus = window.ogb?.setCredential
        ? await window.ogb.setCredential("openaiLiveKey", "")
        : await api("/api/config", { method: "PUT", body: JSON.stringify({ live: { key: "" } }) });
      dispatch({ type: "configStatus", config: status });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={focusOnOpen}
      role="dialog"
      tabIndex={-1}
      aria-label={t("call.live.settings")}
      className="flex w-[300px] max-w-[90vw] flex-col gap-3 rounded-xl border border-hairline bg-panel p-3 text-[12.5px] text-ink shadow-lg"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <label className="flex items-center justify-between gap-2">
        <span className="text-ink-secondary">{t("call.live.voice")}</span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="live-voice-sample"
            className="inline-flex size-7 items-center justify-center rounded-md border border-hairline text-ink-secondary hover:text-ink disabled:opacity-40"
            disabled={auto || !known}
            aria-label={t(sample === "idle" ? "call.live.voicePlay" : sample === "loading" ? "call.live.voiceLoading" : "call.live.voiceStop")}
            title={t(sample === "idle" ? "call.live.voicePlay" : sample === "loading" ? "call.live.voiceLoading" : "call.live.voiceStop")}
            onClick={() => void playSample()}
          >
            {sample === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : sample === "playing" ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <Select
            size="sm"
            value={voice}
            disabled={saving}
            onChange={(event) => void saveVoice(event.target.value)}
          >
            <option value={AUTO_VOICE}>{t("call.live.voiceAuto")}</option>
            {!known && !auto && <option value={botVoice}>{botVoice}</option>}
            {LIVE_VOICE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
        </span>
      </label>
      <div className="-mt-2 text-[11.5px] text-ink-tertiary">{auto && pickedLabel ? t("call.live.voiceAutoPicked", { voice: pickedLabel }) : t("call.live.voiceNext")}</div>
      <label className="flex items-center justify-between gap-2">
        <span className="text-ink-secondary">{t("call.live.readTyped")}</span>
        <input
          type="checkbox"
          checked={live.readTypedReplies}
          disabled={saving}
          aria-describedby={typedHintId}
          onChange={(event) => void save({ readTypedReplies: event.target.checked })}
        />
      </label>
      <div id={typedHintId} className="-mt-2 text-[11.5px] text-ink-tertiary">{t("call.live.readTypedHint")}</div>
      <label className="flex items-center justify-between gap-2">
        <span className="text-ink-secondary">{t("call.live.idle")}</span>
        <Select
          size="sm"
          value={live.idleMinutes}
          disabled={saving}
          onChange={(event) => void save({ idleMinutes: Number(event.target.value) })}
        >
          {[...new Set([...IDLE_CHOICES, live.idleMinutes])].sort((a, b) => a - b).map((minutes) => (
            <option key={minutes} value={minutes}>{minutes}</option>
          ))}
        </Select>
      </label>
      <div className="flex items-center justify-between gap-2 border-t border-hairline/60 pt-2">
        <span className="text-ink-secondary">{t("call.live.key")}</span>
        <span className="flex gap-2">
          <button type="button" className="text-accent hover:underline" onClick={() => setChangingKey((open) => !open)}>
            {t("call.live.keyChange")}
          </button>
          {live.keySource === "live" && (
            <button type="button" className="text-danger hover:underline" disabled={saving} onClick={() => void removeKey()}>
              {t("call.live.keyRemove")}
            </button>
          )}
        </span>
      </div>
      {live.keySource !== "live" && (
        <div className="-mt-2 text-[11.5px] text-ink-tertiary">{t(live.keySource === "openai" ? "call.live.keyFromApiKeys" : "call.live.needsKey")}</div>
      )}
      {changingKey && <LiveKeySetup compact onSaved={() => setChangingKey(false)} />}
      <div className="text-[11.5px] text-ink-tertiary">{liveDisclosure({ cloudHome: state.config?.cloudHome === true })} {t("call.live.cost")}</div>
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
