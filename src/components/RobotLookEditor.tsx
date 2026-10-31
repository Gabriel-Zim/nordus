import { Pipette } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Bot } from "@/state/store";
import { ROBO_CASCAS, ROBO_CORPOS, ROBO_LUZES, ROBO_ROUPAS, luzPadrao, roboAparencia, type RoboCorpo } from "@/lib/robo-estado";
import type { WireRobotLook } from "../../shared/wire";
import { RoboAvatar } from "./RoboAvatar";

type Look = WireRobotLook;

const BODY_LABEL: Record<RoboCorpo, LocaleKey> = {
  peito: "robotLook.body.peito",
  cintura: "robotLook.body.cintura",
  capsula: "robotLook.body.capsula",
  robusto: "robotLook.body.robusto",
  esfera: "robotLook.body.esfera",
};

const sectionLabel = "mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary";

export function withLook(look: Look | null | undefined, change: Partial<Look>): Look | null {
  const next: Look = { ...look, ...change };
  for (const key of Object.keys(next) as (keyof Look)[]) if (next[key] === undefined) delete next[key];
  return Object.keys(next).length ? next : null;
}

function sameColor(a: string | undefined, b: string | undefined) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function Swatches({
  label,
  value,
  palette,
  disabled,
  onPick,
  fallback,
}: {
  label: string;
  value: string | undefined;
  palette: readonly string[];
  disabled: boolean;
  onPick: (color: string | undefined) => void;
  fallback?: { title: string; color: string };
}) {
  const custom = value && !palette.some((color) => sameColor(color, value)) ? value : undefined;
  const ring = (on: boolean) => on && "ring-2 ring-accent-border ring-offset-2 ring-offset-card";
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {fallback && (
        <button
          type="button"
          disabled={disabled}
          aria-pressed={value === undefined}
          title={fallback.title}
          aria-label={fallback.title}
          onClick={() => onPick(undefined)}
          className={cn("relative size-8 overflow-hidden rounded-full border border-white/15 disabled:opacity-50", ring(value === undefined))}
          style={{ backgroundColor: fallback.color }}
        >
          <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(135deg,transparent_46%,rgb(255_255_255/0.7)_46%,rgb(255_255_255/0.7)_54%,transparent_54%)]" />
        </button>
      )}
      {palette.map((color) => (
        <button
          key={color}
          type="button"
          disabled={disabled}
          aria-pressed={sameColor(value, color)}
          title={color}
          aria-label={`${label} ${color}`}
          onClick={() => onPick(color)}
          className={cn("size-8 rounded-full border border-white/15 transition-transform hover:scale-110 disabled:opacity-50", ring(sameColor(value, color)))}
          style={{ backgroundColor: color }}
        />
      ))}
      <label
        title={t("robotLook.custom")}
        className={cn(
          "relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/15 text-white has-[:disabled]:cursor-default has-[:disabled]:opacity-50",
          ring(Boolean(custom)),
        )}
        style={custom ? { backgroundColor: custom } : { background: "conic-gradient(#ff4d6a, #ffd23a, #3dff9a, #2ec5ff, #c39bff, #ff4d6a)" }}
      >
        <Pipette size={13} aria-hidden="true" className="drop-shadow-[0_1px_1px_rgb(0_0_0/0.6)]" />
        <input
          type="color"
          disabled={disabled}
          aria-label={`${label}: ${t("robotLook.custom")}`}
          value={(custom ?? value ?? fallback?.color ?? "#3a3a3a").slice(0, 7)}
          onChange={(event) => onPick(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

export function RobotLookEditor({
  bot,
  disabled,
  onPatch,
}: {
  bot: Bot;
  disabled: boolean;
  onPatch: (patch: { robot: Look | null }) => void;
}) {
  const look = bot.robot ?? undefined;
  const drawn = roboAparencia(bot);
  const feminine = drawn.genero === "f";
  const change = (next: Partial<Look>) => onPatch({ robot: withLook(look, next) });

  return (
    <div data-robot-look="">
      <div className="mb-2 mt-4 flex items-baseline justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("robotLook.title")}</span>
        {look && (
          <button type="button" disabled={disabled} onClick={() => onPatch({ robot: null })}
            className="rounded-md px-2 py-0.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50">
            {t("robotLook.reset")}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-hairline/40" role="group" aria-label={t("robotLook.version")}>
        {(["m", "f"] as const).map((gender, index) => (
          <button
            key={gender}
            type="button"
            disabled={disabled}
            aria-pressed={drawn.genero === gender}
            onClick={() => change({ gender })}
            className={cn(
              "py-1.5 text-[12.5px] disabled:opacity-50",
              index > 0 && "border-l border-hairline/40",
              drawn.genero === gender ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/60 hover:text-ink",
            )}
          >
            {t(gender === "m" ? "robotLook.masculine" : "robotLook.feminine")}
          </button>
        ))}
      </div>

      {!feminine && (
        <>
          <div className={sectionLabel}>{t("robotLook.body")}</div>
          <div className="grid grid-cols-5 gap-1.5">
            {ROBO_CORPOS.map((corpo) => (
              <button
                key={corpo}
                type="button"
                disabled={disabled}
                aria-pressed={drawn.corpo === corpo}
                aria-label={t(BODY_LABEL[corpo])}
                title={t(BODY_LABEL[corpo])}
                onClick={() => change({ body: corpo })}
                className={cn(
                  "flex items-center justify-center rounded-lg py-1.5 disabled:opacity-50",
                  drawn.corpo === corpo ? "bg-control ring-1 ring-accent-border" : "hover:bg-control/60",
                )}
              >
                <RoboAvatar corpo={corpo} genero="m" estado="online" casca={drawn.casca} luz={drawn.luz} size={44} />
              </button>
            ))}
          </div>
        </>
      )}

      <div className={sectionLabel}>{t("robotLook.shell")}</div>
      <Swatches label={t("robotLook.shell")} value={drawn.casca} palette={ROBO_CASCAS} disabled={disabled}
        onPick={(shell) => change({ shell })} />

      <div className={sectionLabel}>{t("robotLook.light")}</div>
      <Swatches label={t("robotLook.light")} value={look?.light} palette={ROBO_LUZES} disabled={disabled}
        fallback={{ title: t("robotLook.lightDefault"), color: luzPadrao(bot.color) }}
        onPick={(light) => change({ light })} />

      {feminine && (
        <>
          <div className={sectionLabel}>{t("robotLook.dress")}</div>
          <Swatches label={t("robotLook.dress")} value={look?.dress} palette={ROBO_ROUPAS} disabled={disabled}
            fallback={{ title: t("robotLook.dressDefault"), color: drawn.luz }}
            onPick={(dress) => change({ dress })} />
        </>
      )}
    </div>
  );
}
