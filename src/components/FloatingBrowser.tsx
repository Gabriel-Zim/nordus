import { useEffect, useState } from "react";
import { Loader2, Maximize, Maximize2, Minimize2, Minus, X } from "lucide-react";

import { t } from "@/lib/i18n";
import { browserInUse } from "@/lib/browser-auto-open";
import { pendingBrowserSignIn } from "@/lib/browser-signin";
import { claimBrowserFloat, openBrowserStage, useBrowserStageOwner } from "@/lib/browser-stage";
import { builtInBrowserEnabled } from "@/lib/feature-flags";
import { answerSignIn } from "@/lib/sign-in";
import { useStore, visibleMessages, type Bot, type Message } from "@/state/store";
import { Frame, useScreencast } from "./BrowserGoalCard";

const WIDE = "(min-width: 640px)";
/** The preview asks the server for few pictures a second: it is a glance, the stage is the real view. */
export const PREVIEW_FPS = 8;

export type FloatSize = "min" | "normal" | "wide";
const SIZES: readonly FloatSize[] = ["min", "normal", "wide"];
const sizeKey = (botId: string) => `nordus:float-size:${botId}`;

export function readFloatSize(botId: string): FloatSize {
  try {
    const stored = window.localStorage.getItem(sizeKey(botId));
    return SIZES.includes(stored as FloatSize) ? stored as FloatSize : "normal";
  } catch { return "normal"; }
}

export function writeFloatSize(botId: string, size: FloatSize): void {
  try { window.localStorage.setItem(sizeKey(botId), size); } catch {}
}

function useWide(): boolean {
  const query = () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(WIDE) : null;
  const [wide, setWide] = useState(() => query()?.matches ?? true);
  useEffect(() => {
    const media = query();
    if (!media) return;
    const update = () => setWide(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return wide;
}

/** What the bot is doing in its browser, in a few words, from its newest browser step. */
export function actionCaption(message: Pick<Message, "tool"> | undefined): string | null {
  const name = message?.tool?.name.toLowerCase().replace(/^.*?(?:agent_)?browser_/u, "");
  if (!name) return null;
  if (name === "click" || name === "dblclick") return t("browser.float.act.click");
  if (name === "fill" || name === "check" || name === "select") return t("browser.float.act.fill");
  if (name === "type" || name === "press") return t("browser.float.act.type");
  if (name === "open" || name === "navigate") return t("browser.float.act.open");
  if (name === "scroll") return t("browser.float.act.scroll");
  if (name === "goal") return t("browser.float.act.goal");
  return t("browser.float.act.read");
}

/** Where the bot's step says it clicked, in the page's own pixels, when the step carries a position. */
export function actionPoint(message: Pick<Message, "tool"> | undefined): { x: number; y: number } | null {
  try {
    const input = JSON.parse(message?.tool?.input ?? "") as { x?: unknown; y?: unknown };
    return typeof input.x === "number" && typeof input.y === "number" ? { x: input.x, y: input.y } : null;
  } catch { return null; }
}

function SignInButtons({ help }: { help: NonNullable<ReturnType<typeof pendingBrowserSignIn>> }) {
  const [pending, setPending] = useState<"done" | "cancel" | null>(null);
  const answer = async (choice: "done" | "cancel") => {
    if (pending) return;
    setPending(choice);
    try { await answerSignIn(help, choice); } catch {} finally { setPending(null); }
  };
  return (
    <>
      <button type="button" onClick={() => void answer("done")} disabled={pending !== null} data-testid="browser-float-done" className="flex h-7 shrink-0 items-center rounded-full bg-[#ff6633] px-3 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent">
        {pending === "done" ? <Loader2 size={13} className="animate-spin" /> : t("signIn.done")}
      </button>
      <button type="button" onClick={() => void answer("cancel")} disabled={pending !== null} className="shrink-0 px-1 text-[12px] text-ink-secondary hover:text-ink disabled:opacity-60">{t("signIn.cancel")}</button>
    </>
  );
}

/**
 * A small live picture of the bot's browser over the chat, bottom right above the composer, for as long as the bot is
 * using its browser in this conversation: normal, wider, or only a pill; the full window is the stage. It is the one view
 * of the browser outside the stage, so it also holds the connection (none while it is a pill) and lets go of it while the
 * stage is open. The small X hides it until the bot's next browser step.
 */
export function FloatingBrowser({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const wide = useWide();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [size, setSizeState] = useState<FloatSize>(() => readFloatSize(bot.id));
  useEffect(() => { setSizeState(readFloatSize(bot.id)); }, [bot.id]);
  const setSize = (next: FloatSize) => { setSizeState(next); writeFloatSize(bot.id, next); };
  const stageOwner = useBrowserStageOwner(bot.id);
  const help = pendingBrowserSignIn(bot, state.computerControl?.[bot.id]?.help);
  const messages = bot.messages ? visibleMessages(bot) : [];
  const step = bot.messages ? browserInUse(messages) : null;
  const enabled = bot.browser !== false && builtInBrowserEnabled(state.config);
  const inUse = step !== null && (bot.busy === true || help !== null);
  const shown = enabled && wide && !state.computerOpen && (inUse || help !== null) && dismissed !== (step ?? help?.messageId ?? "");
  const watching = shown && size !== "min" && stageOwner === undefined;
  const { cast, blocked } = useScreencast(bot.id, watching, { maxFps: PREVIEW_FPS });

  useEffect(() => {
    if (!shown) return;
    return claimBrowserFloat(bot.id, Symbol("float"));
  }, [shown, bot.id]);
  const data = cast?.frame.data;
  useEffect(() => { if (data) setLast(data); }, [data]);
  useEffect(() => { setLast(null); }, [bot.id]);

  if (!shown) return null;
  const key = step ?? help?.messageId ?? "";
  const stepMessage = step ? messages.find((message) => message.id === step) : undefined;
  const caption = actionCaption(stepMessage);
  const point = actionPoint(stepMessage);

  if (size === "min") {
    return (
      <div className="pointer-events-none relative h-0" data-testid="browser-float">
        <button
          type="button"
          onClick={() => setSize("normal")}
          data-testid="browser-float-pill"
          data-needs-you={help ? "" : undefined}
          title={t("browser.float.restore")}
          className={`pointer-events-auto absolute bottom-2 end-4 z-[3] flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full py-1.5 pe-3 ps-2.5 text-[12.5px] shadow-lg focus-visible:outline-2 focus-visible:outline-accent ${help ? "bg-[#ff6633] text-white" : "bg-app text-ink ring-1 ring-hairline/60"}`}
        >
          <span aria-hidden="true" className="relative flex size-2 shrink-0">
            <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${help ? "bg-white" : "bg-red-500"}`} />
            <span className={`relative inline-flex size-2 rounded-full ${help ? "bg-white" : "bg-red-500"}`} />
          </span>
          <span className="min-w-0 truncate">{help ? t("browser.float.needsYou") : t("browser.float.using", { name: bot.name })}</span>
        </button>
      </div>
    );
  }

  const control = "grid size-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-accent";
  const shownSize = cast ?? { width: 1280, height: 720 };
  return (
    <div className="pointer-events-none relative h-0" data-testid="browser-float">
      <div
        className={`group pointer-events-auto absolute bottom-2 end-4 z-[3] rounded-[12px] bg-app p-0 shadow-xl ${size === "wide" ? "w-[520px] max-w-[45%]" : "w-[280px] max-w-[calc(100%-2rem)]"}`}
        data-size={size}
      >
        <div className="relative">
          <Frame frame={last} running cast={cast} blocked={blocked} onOpen={() => openBrowserStage(bot.id)} needsYou={help !== null} />
          {point && (
            <span
              aria-hidden="true"
              data-testid="browser-float-ripple"
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-[#ff6633]/70"
              style={{ left: `${Math.min(100, (point.x / shownSize.width) * 100)}%`, top: `${Math.min(100, (point.y / shownSize.height) * 100)}%` }}
            />
          )}
          <div className="absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" data-testid="browser-float-controls">
            <button type="button" onClick={() => setSize("min")} aria-label={t("browser.float.minimize")} title={t("browser.float.minimize")} data-testid="browser-float-min" className={control}><Minus size={12} aria-hidden="true" /></button>
            <button type="button" onClick={() => setSize(size === "wide" ? "normal" : "wide")} aria-label={size === "wide" ? t("browser.float.shrink") : t("browser.float.grow")} title={size === "wide" ? t("browser.float.shrink") : t("browser.float.grow")} data-testid="browser-float-size" className={control}>
              {size === "wide" ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => openBrowserStage(bot.id)} aria-label={t("browser.stage.open")} title={t("browser.stage.open")} data-testid="browser-float-full" className={control}><Maximize size={12} aria-hidden="true" /></button>
            <button type="button" onClick={() => setDismissed(key)} aria-label={t("browser.stage.close")} title={t("browser.stage.close")} data-testid="browser-float-close" className={control}><X size={12} aria-hidden="true" /></button>
          </div>
          {caption && !help && (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 truncate rounded-full bg-black/60 px-2.5 py-1 text-center text-[11.5px] text-white" data-testid="browser-float-caption">{caption}</div>
          )}
        </div>
        {help && (
          <div className="flex items-center gap-2 px-2.5 py-2 text-[12.5px]" data-testid="browser-float-needs-you">
            <span className="min-w-0 flex-1 truncate text-ink">{t("browser.float.needsYou")}</span>
            <button type="button" onClick={() => openBrowserStage(bot.id)} className="shrink-0 rounded-full border border-hairline/60 px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
              {t("browser.stage.openScreen")}
            </button>
            <SignInButtons help={help} />
          </div>
        )}
      </div>
    </div>
  );
}
