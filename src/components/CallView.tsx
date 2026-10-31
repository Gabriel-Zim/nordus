import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AudioLines, Check, ChevronDown, Phone, PhoneOff } from "lucide-react";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { endCall, startCall, useOnCall } from "@/lib/call";
import { CALL_MODES, callModeHint, effectiveCallMode, setCallMode, useCallMode, type CallMode } from "@/lib/call-mode";
import { dismissStartPrompt, hangUpLiveCall, isLiveCallRunning, startLiveCall, useLiveMedia } from "@/lib/live-call-media";
import { t } from "@/lib/i18n";
import { localSystemVoiceActive } from "@/lib/local-voice";
import { navigateThreadMenu } from "./BotProjects";
import { LiveKeyNeeded } from "./LiveKeyNeeded";
import { liveLineHeldElsewhere } from "./LiveCallBar";
import { callStarted } from "@/lib/product-events";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { callCapabilityHelp, type CallCapabilityHelp } from "@/lib/call-capability";
import { onCallStartRequest } from "@/lib/call-start-request";
import { openBotSettings } from "./bot-panel/panel-link";
import { Call } from "./CallScreen";
import { VoiceSetupDialog } from "./lazy-screens";

export type CallButtonPlacement = "header" | "composer";

/** `fill` (Simple composer): a round button in that colour, with no chevron; the + menu picks the call mode. */
export function CallButton({ bot, placement = "header", fill }: { bot: Bot; placement?: CallButtonPlacement; fill?: string }) {
  const { state } = useStore();
  return (
    <CallTargetButton
      placement={placement}
      fill={fill}
      targetId={bot.id}
      targetName={bot.name}
      threadId={bot.threadId}
      voices={[bot.voice]}
      setupBotId={bot.id}
      requireExplicitVoices={false}
      liveCapable
      onStart={(mode) => callStarted(state.instances, bot.modelSelection?.instanceId, mode)}
    />
  );
}

export function CallTargetButton({
  targetId,
  targetName,
  threadId,
  voices,
  setupBotId,
  requireExplicitVoices,
  liveCapable = false,
  onStart,
  placement = "header",
  fill,
}: {
  placement?: CallButtonPlacement;
  fill?: string;
  targetId: string;
  targetName: string;
  threadId?: string;
  voices: Array<string | undefined>;
  setupBotId?: string;
  requireExplicitVoices: boolean;
  liveCapable?: boolean;
  onStart: (mode: CallMode) => void;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { capabilities, ready: capabilitiesReady } = useDesktopCapabilities();
  const media = useLiveMedia();
  const liveThreadId = liveCapable ? threadId : undefined;
  const canLive = liveThreadId !== undefined;
  // Check Live first: startCall also marks the target as on a call.
  const liveRunning = isLiveCallRunning(media.phase);
  const onLiveCall = canLive && liveRunning && media.botId === targetId;
  const liveElsewhere = liveRunning && media.botId !== targetId;
  const onCall = useOnCall() === targetId;
  const active = onCall || onLiveCall;
  const remoteClient = globalThis.window?.ogb?.remoteClient?.active === true;
  const capabilityHelp = capabilitiesReady
    ? callCapabilityHelp(capabilities, Boolean(window.ogb?.speechStart))
    : null;
  const supported = capabilitiesReady && !capabilityHelp;
  const localVoice = localSystemVoiceActive();
  const configured = localVoice || Boolean(state.config?.tts?.configured);
  const everyTargetHasVoice = voices.length > 0 && voices.every((voice) => Boolean(voice));
  const voiceReady =
    localVoice ||
    (configured && (requireExplicitVoices ? everyTargetHasVoice : Boolean(state.config?.tts?.ready || everyTargetHasVoice)));
  const turnsHere = !capabilitiesReady || capabilities.dictation.available;
  const mode = effectiveCallMode(useCallMode(), { turnsHere, canLive });
  const liveMode = canLive && mode === "live";
  const turnsReady = capabilitiesReady && supported && voiceReady;
  const unavailable = !active && !liveElsewhere && !liveMode && !turnsReady;
  const lineHeldElsewhere = liveMode && !onCall && liveLineHeldElsewhere(media, state.liveCall);
  const voiceSetupRequired = capabilitiesReady && supported && !voiceReady;
  const cloudHome = state.config?.cloudHome === true;
  const [helpOpen, setHelpOpen] = useState(false);
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false);
  const [voiceSetupBotId, setVoiceSetupBotId] = useState(setupBotId);
  if (voiceSetupRequired && setupBotId !== voiceSetupBotId) setVoiceSetupBotId(setupBotId);
  const shownSetupBotId = voiceSetupRequired ? setupBotId : voiceSetupBotId;
  const setupBot = shownSetupBotId ? state.bots.find((candidate) => candidate.id === shownSetupBotId) : undefined;
  const helpMotion = useMenuMotion(Boolean(unavailable && helpOpen));
  const [menuOpen, setMenuOpen] = useState(false);
  const startPrompt = canLive && !active && media.needsKey && media.botId === targetId;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const keyRef = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const menuId = useId();
  const keyId = useId();
  const elsewhereName = liveElsewhere ? state.bots.find((candidate) => candidate.id === media.botId)?.name : undefined;
  const composer = placement === "composer";
  const label = active
    ? t("call.hangUpOn", { name: targetName })
    : liveElsewhere
      ? elsewhereName ? t("call.live.pill", { name: elsewhereName }) : t("call.live.badge")
      : liveMode
      ? t("call.live.callWith", { name: targetName })
      : !capabilitiesReady
      ? "Checking call availability"
      : !supported
        ? capabilityHelp?.label ?? "Call unavailable"
        : !configured
          ? "Set up a voice in an agent profile to make calls"
          : !voiceReady
            ? "Pick a voice in an agent profile to make calls"
            : `Call ${targetName}`;

  const reason = !capabilitiesReady
    ? "Checking whether this device can make calls."
    : capabilityHelp
      ? capabilityHelp.reason
        : !configured
          ? "Set up ElevenLabs, Fish Audio, Chatterbox, or a built-in Mac voice so the bot can speak during calls."
          : !voiceReady
            ? voices.length > 1
              ? "Give every group member a voice before starting a group call."
              : "Choose a voice before starting a call."
            : "";

  const closePopovers = useCallback(() => {
    setHelpOpen(false);
    setMenuOpen(false);
    dismissStartPrompt(targetId);
  }, [targetId]);

  useEffect(() => () => dismissStartPrompt(targetId), [targetId]);

  const start = (next: CallMode) => {
    setHelpOpen(false);
    setMenuOpen(false);
    if (next === "live" && liveThreadId !== undefined) {
      onStart("live");
      void startLiveCall({ botId: targetId, threadId: liveThreadId });
      return;
    }
    if (!turnsReady) {
      setHelpOpen(true);
      return;
    }
    onStart("turns");
    startCall(targetId);
  };

  // The Simple composer's + menu: the same choice as this button's own call-mode menu, which it replaces there.
  const requestedStart = useRef<(next: CallMode) => void>(() => {});
  requestedStart.current = (next) => {
    // Hidden below while Live's line is held on another device: the + menu must not start a second call either.
    if (active || liveElsewhere || (next === "live" && !canLive) || lineHeldElsewhere) return;
    closePopovers();
    setCallMode(next);
    start(next);
  };
  useEffect(() => onCallStartRequest(targetId, (next) => requestedStart.current(next)), [targetId]);

  const popoverOpen = helpOpen || menuOpen || startPrompt;
  useEffect(() => {
    if (!popoverOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) closePopovers();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closePopovers();
      (menuOpen ? chevronRef : buttonRef).current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [popoverOpen, menuOpen, closePopovers]);

  const keyShown = useRef(startPrompt);
  useEffect(() => {
    const opened = startPrompt && !keyShown.current;
    keyShown.current = startPrompt;
    if (opened) keyRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [startPrompt]);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressedLong = useRef(false);
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  if (lineHeldElsewhere) return null;
  return (
    <div ref={rootRef} className="relative flex items-center gap-0.5">
      <button
        ref={buttonRef}
        disabled={liveElsewhere || (onLiveCall && media.phase === "ending")}
        // A long press picks the call mode, where the phone composer has no room for the ▾ beside it.
        onPointerDown={(event) => {
          if (!canLive || active || event.pointerType !== "touch") return;
          clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => {
            pressedLong.current = true;
            closePopovers();
            setMenuOpen(true);
          }, 450);
        }}
        onPointerUp={() => clearTimeout(pressTimer.current)}
        onPointerLeave={() => clearTimeout(pressTimer.current)}
        onPointerCancel={() => clearTimeout(pressTimer.current)}
        onContextMenu={(event) => { if (canLive && event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType === "touch") event.preventDefault(); }}
        onClick={() => {
          if (pressedLong.current) {
            pressedLong.current = false;
            return;
          }
          if (onLiveCall) {
            void hangUpLiveCall();
            return;
          }
          if (onCall) return endCall(targetId);
          if (startPrompt) {
            closePopovers();
            return;
          }
          if (unavailable) {
            setMenuOpen(false);
            setHelpOpen((open) => !open);
            return;
          }
          start(liveMode ? "live" : "turns");
        }}
        aria-expanded={unavailable ? helpOpen : startPrompt ? true : undefined}
        aria-controls={unavailable ? helpId : startPrompt ? keyId : undefined}
        aria-label={label}
        title={label}
        data-call-button={placement}
        style={fill && !active ? { backgroundColor: fill } : undefined}
        className={cn(
          "relative flex shrink-0 items-center justify-center disabled:opacity-60",
          fill ? "rounded-full transition-[color,background,filter]" : "rounded-l-3xl rounded-r-lg active:rounded-3xl transition-[color,background,border-radius]",
          composer ? "size-8" : "size-9",
          active
            ? "bg-danger text-white hover:brightness-110"
            : fill
              ? "text-white hover:brightness-110"
            : composer
              ? unavailable
                ? "bg-control text-ink-tertiary hover:text-ink-secondary"
                : "bg-control text-ink hover:bg-raised-hover"
              : unavailable
                ? "text-ink-tertiary hover:bg-raised-hover hover:text-ink-secondary"
                : "text-ink-secondary hover:bg-raised-hover hover:text-ink",
        )}
      >
        {active
          ? <PhoneOff size={composer ? 15 : 17} />
          : composer ? <AudioLines size={16} aria-hidden="true" /> : <Phone size={17} />}
        {unavailable && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warning ring-2 ring-app" aria-hidden="true" />
        )}
      </button>
      {canLive && !fill && (
        <button
          ref={chevronRef}
          type="button"
          disabled={active || liveElsewhere}
          onClick={() => {
            const opening = !menuOpen;
            closePopovers();
            setMenuOpen(opening);
          }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-label={t("call.mode.menu")}
          title={t("call.mode.menu")}
          className={cn(
              "grid place-content-center",
              "bg-control w-8 hover:bg-raised-hover text-ink-secondary hover:text-ink disabled:opacity-40 transition-colors",
              "rounded-l-lg rounded-r-3xl active:rounded-3xl transition-[color,background,border-radius]",
              composer ? "h-8" : "h-9"
            )}
        >
          <ChevronDown size={13} className={cn("transition-transform", menuOpen && "rotate-180")} />
        </button>
      )}

      {menuOpen && (
        <CallModeMenu
          id={menuId}
          mode={mode}
          turnsUnavailable={turnsHere ? null : capabilityHelp}
          placement={placement}
          cloudHome={cloudHome}
          onClose={closePopovers}
          onChoose={(next) => {
            setCallMode(next);
            start(next);
          }}
        />
      )}

      {startPrompt && (
        <div
          ref={keyRef}
          id={keyId}
          className={cn("animate-pop-in absolute right-0 z-30 w-[340px] max-w-[90vw] rounded-xl shadow-2xl", composer ? "bottom-full mb-1.5" : "top-full mt-1.5")}
        >
          <LiveKeyNeeded />
        </div>
      )}

      {helpMotion.shown && (
        <div
          id={helpId}
          role="group"
          aria-label="Call unavailable"
          className={cn("absolute right-0 z-30 w-[280px]", composer ? "bottom-full mb-1.5" : "mt-1.5", "rounded-xl border border-hairline bg-panel p-3 text-left shadow-2xl", helpMotion.className)} {...helpMotion.exitProps}
        >
          <div className="text-[13px] font-medium text-ink">Call unavailable</div>
          <div className="mt-1 text-[12px] leading-[1.45] text-ink-secondary">{reason}</div>
          {canLive && (
            <button
              type="button"
              onClick={() => {
                setCallMode("live");
                start("live");
              }}
              className="mt-2.5 mr-2 rounded-lg border border-hairline px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised"
              title={callModeHint("live", { cloudHome })}
            >
              {t("call.live.startInstead")}
            </button>
          )}
          {voiceSetupRequired && setupBot && (
            <button
              type="button"
              aria-haspopup={remoteClient ? undefined : "dialog"}
              data-voice-setup-open
              onClick={() => {
                setHelpOpen(false);
                if (remoteClient) {
                  if (setupBot.id !== targetId) openBot(dispatch, setupBot, showThreads);
                  openBotSettings(dispatch, "voice");
                  return;
                }
                setVoiceSetupOpen(true);
              }}
              className="mt-2.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110"
            >
              {t("call.voiceSetup.open")}
            </button>
          )}
        </div>
      )}

      {voiceSetupOpen && setupBot && (
        <VoiceSetupDialog
          bot={setupBot}
          callName={targetName}
          ready={supported && voiceReady}
          returnFocusRef={buttonRef}
          onClose={() => setVoiceSetupOpen(false)}
          onStartCall={() => {
            setVoiceSetupOpen(false);
            start("turns");
          }}
        />
      )}
    </div>
  );
}

export function CallModeMenu({ id, mode, onChoose, onClose, placement = "header", cloudHome = false, turnsUnavailable = null }: {
  id: string;
  mode: CallMode;
  turnsUnavailable?: CallCapabilityHelp | null;
  placement?: CallButtonPlacement;
  cloudHome?: boolean;
  onChoose: (mode: CallMode) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, []);
  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={t("call.mode.menu")}
      onKeyDown={(event) => {
        if (event.key === "Tab") onClose();
        else navigateThreadMenu(event);
      }}
      className={cn("animate-pop-in absolute right-0 z-30 w-[280px] rounded-xl border border-hairline bg-panel p-1.5 text-left shadow-2xl space-y-1", placement === "composer" ? "bottom-full mb-1.5" : "top-full mt-1.5")}
    >
      {CALL_MODES.map((entry) => {
        const unavailable = entry.id === "turns" ? turnsUnavailable : null;
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitemradio"
            aria-checked={mode === entry.id}
            // aria-disabled, not disabled: arrow keys skip a disabled item, so its reason would never be read out.
            aria-disabled={unavailable ? true : undefined}
            onClick={() => {
              if (!unavailable) onChoose(entry.id);
            }}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-raised focus-visible:bg-raised aria-disabled:cursor-default aria-disabled:hover:bg-transparent",
              mode === entry.id && "bg-raised/60",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[13px] font-medium", unavailable ? "text-ink-tertiary" : "text-ink")}>{t(entry.label)}</span>
              <span className="mt-0.5 block text-[11.5px] leading-[1.4] text-ink-secondary">
                {unavailable ? `${unavailable.label}. ${unavailable.reason}` : callModeHint(entry.id, { cloudHome })}
              </span>
            </span>
            {mode === entry.id && <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

export function CallOverlay({ bot }: { bot: Bot }) {
  const active = useOnCall() === bot.id;
  const media = useLiveMedia();
  const onLiveCall = media.botId === bot.id && isLiveCallRunning(media.phase);
  if (!active || onLiveCall) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-app/95">
      <Call key="turns" bot={bot} />
    </div>
  );
}
