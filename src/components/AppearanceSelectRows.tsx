import { useState } from "react";
import { Check } from "lucide-react";
import { t } from "@/lib/i18n";
import { CHAT_WIDTH_IDS, applyChatWidth, readChatWidth, type ChatWidthId } from "@/lib/chat-width";
import { FONT_IDS, applyFont, readFont, type FontId } from "@/lib/fonts";
import { ACCENT_PRESETS, DEFAULT_ACCENT, MONO_ACCENT, applyAccent, useAccent } from "@/lib/accent-color";
import { BACKGROUND_TONES, applyBackgroundTone, useBackgroundTone, type BackgroundToneId } from "@/lib/background-tone";
import { cn } from "@/lib/cn";
import { parseSidebarToolsLayout, setSidebarToolsLayout, SIDEBAR_TOOLS_LAYOUTS, useSidebarToolsLayout } from "@/lib/sidebar-preferences";
import { SettingRow } from "./SettingsPrimitives";
import { Select } from "./Select";

export function FontRow() {
  const [current, setCurrent] = useState<FontId>(readFont);
  return (
    <SettingRow title={t("settings.font.title")} subtitle={t("settings.font.subtitle")}>
      <Select size="sm" className="w-full max-w-[240px]"
        value={current}
        aria-label={t("settings.font.aria")}
        onChange={(event) => {
          // SAFETY: the options are rendered from FONT_IDS, so the value is always a member.
          const id = event.target.value as FontId;
          applyFont(id);
          setCurrent(id);
        }}
      >
        {FONT_IDS.map((id) => (
          <option key={id} value={id}>{t(`settings.font.${id}`)}</option>
        ))}
      </Select>
    </SettingRow>
  );
}

export function ChatWidthRow() {
  const [current, setCurrent] = useState<ChatWidthId>(readChatWidth);
  return (
    <SettingRow title={t("settings.chatWidth.title")} subtitle={t("settings.chatWidth.subtitle")}>
      <Select size="sm" className="w-full max-w-[240px]"
        value={current}
        aria-label={t("settings.chatWidth.aria")}
        onChange={(event) => {
          const id = CHAT_WIDTH_IDS.find((width) => width === event.target.value);
          if (!id) return;
          applyChatWidth(id);
          setCurrent(id);
        }}
      >
        {CHAT_WIDTH_IDS.map((id) => (
          <option key={id} value={id}>{t(`settings.chatWidth.${id}`)}</option>
        ))}
      </Select>
    </SettingRow>
  );
}

export function SidebarToolsLayoutRow() {
  const layout = useSidebarToolsLayout();
  return (
    <SettingRow title={t("sidebar.toolsLayout.title")} subtitle={t("sidebar.toolsLayout.subtitle")}>
      <Select size="sm" className="w-full max-w-[240px]"
        value={layout}
        aria-label={t("sidebar.toolsLayout.chooseAria")}
        onChange={(event) => setSidebarToolsLayout(parseSidebarToolsLayout(event.target.value))}
      >
        {SIDEBAR_TOOLS_LAYOUTS.map((option) => (
          <option key={option} value={option}>{t(`sidebar.toolsLayout.${option}`)}</option>
        ))}
      </Select>
    </SettingRow>
  );
}

/** The person's accent: a few ready colours plus any colour they pick. The
 * Nordus orange is the default, so choosing it clears the override. */
export function AccentColorRow() {
  const accent = useAccent();
  const shown = accent ?? DEFAULT_ACCENT;
  const mono = shown === MONO_ACCENT;
  const custom = !mono && !ACCENT_PRESETS.some((preset) => preset.hex === shown);
  return (
    <SettingRow title={t("settings.accent.title")} subtitle={t("settings.accent.subtitle")}>
      <div role="radiogroup" aria-label={t("settings.accent.title")} className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={mono}
          aria-label={t("settings.accent.mono")}
          title={t("settings.accent.mono")}
          onClick={() => { applyAccent(MONO_ACCENT); applyBackgroundTone(); }}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-full pr-2 text-[12px] text-ink-secondary ring-offset-2 ring-offset-[var(--color-panel)] transition-shadow",
            mono ? "ring-2 ring-ink/80" : "ring-1 ring-ink/15 hover:ring-ink/35",
          )}
        >
          <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full" style={{ background: "linear-gradient(90deg, #0a0a0a 50%, #ededed 50%)" }}>
            {mono && <Check size={13} strokeWidth={3} style={{ color: "#888888" }} />}
          </span>
          {t("settings.accent.monoShort")}
        </button>
        {ACCENT_PRESETS.map((preset) => {
          const selected = shown === preset.hex;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t(`settings.accent.${preset.id}`)}
              title={t(`settings.accent.${preset.id}`)}
              onClick={() => { applyAccent(preset.hex === DEFAULT_ACCENT ? null : preset.hex); applyBackgroundTone(); }}
              className={cn(
                "flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--color-panel)] transition-shadow",
                selected ? "ring-2 ring-ink/80" : "ring-1 ring-ink/15 hover:ring-ink/35",
              )}
              style={{ background: preset.hex }}
            >
              {selected && <Check size={13} strokeWidth={3} aria-hidden="true" style={{ color: contrastInk(preset.hex) }} />}
            </button>
          );
        })}
        <label
          title={t("settings.accent.custom")}
          className={cn(
            "relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-offset-2 ring-offset-[var(--color-panel)]",
            custom ? "ring-2 ring-ink/80" : "ring-1 ring-ink/15 hover:ring-ink/35",
          )}
          style={{ background: custom ? shown : "conic-gradient(#ff6633, #facc15, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ff6633)" }}
        >
          {custom && <Check size={13} strokeWidth={3} aria-hidden="true" style={{ color: contrastInk(shown) }} />}
          <input
            type="color"
            value={mono ? "#ededed" : shown}
            aria-label={t("settings.accent.custom")}
            onChange={(event) => { applyAccent(event.target.value); applyBackgroundTone(); }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
    </SettingRow>
  );
}

const TONE_SWATCH: Record<BackgroundToneId, string> = {
  accent: "color-mix(in oklch, var(--color-accent) 60%, #262626)",
  amber: "#78482c",
  copper: "#96523a",
  graphite: "#707070",
  midnight: "#30508c",
  moss: "#466438",
  plain: "#0a0a0a",
};

/** The glow behind the chat: a few tones and how strong it is. Local to this device. */
export function BackgroundToneRow() {
  const { tone, strength } = useBackgroundTone();
  return (
    <SettingRow title={t("settings.background.title")} subtitle={t("settings.background.subtitle")}>
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={t("settings.background.title")} className="flex flex-wrap items-center gap-2">
          {BACKGROUND_TONES.map((entry) => {
            const selected = tone === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(`settings.background.${entry.id}`)}
                title={t(`settings.background.${entry.id}`)}
                onClick={() => applyBackgroundTone({ tone: entry.id })}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--color-panel)] transition-shadow",
                  selected ? "ring-2 ring-ink/80" : "ring-1 ring-ink/15 hover:ring-ink/35",
                )}
                style={{ background: TONE_SWATCH[entry.id] }}
              >
                {selected && <Check size={13} strokeWidth={3} aria-hidden="true" style={{ color: "#ededed" }} />}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-3 text-[12px] text-ink-secondary">
          <span className="w-20 shrink-0">{t("settings.background.strength")}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={strength}
            aria-label={t("settings.background.strength")}
            onChange={(event) => applyBackgroundTone({ strength: Number(event.target.value) })}
            className="min-w-0 w-28 accent-[var(--color-accent)]"
          />
          <span className="w-10 shrink-0 text-right tabular-nums">{strength}%</span>
        </label>
      </div>
    </SettingRow>
  );
}

function contrastInk(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const luma = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luma > 0.6 ? "#0a0a0a" : "#ffffff";
}
