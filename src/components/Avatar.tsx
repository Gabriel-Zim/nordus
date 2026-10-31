import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useState,
  type Ref,
} from "react";
import type { CritterColor, CritterMotion, CritterState } from "@/lib/mascot";
import { roboAparencia, roboEstadoDoBot, type RoboEstado } from "@/lib/robo-estado";
import type { BotActivity, WireRobotLook } from "../../shared/wire";
import type { CursorAvatarHandle } from "./CursorAvatar";
import { RoboAvatar, type RoboSvg } from "./RoboAvatar";
import { botAvatarProfile, clampAvatarFocus, clampAvatarZoom, type BotAvatarCrop } from "../../shared/bot-avatar";
import type { BotBodyId } from "../../shared/bot-body";

export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

export function roomAvatarGradient(color: CritterColor): [string, string, string] {
  const fill = `var(--identity-${color})`;
  return [
    `color-mix(in srgb, ${fill} 82%, #ffffff)`,
    fill,
    `color-mix(in srgb, ${fill} 82%, #000000)`,
  ];
}

export type CritterAvatarHandle = CursorAvatarHandle;

export type CritterAvatarProps = {
  color: CritterColor;
  state?: CritterState;
  expression?: number;
  size?: number;
  label?: string;
  motion?: CritterMotion;
  motionKey?: number;
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  forward?: boolean;
  lookAround?: number;
  trackPointer?: boolean;
  animated?: boolean;
  bodyId?: BotBodyId;
  gradient?: [string, string, string];
};

function NordusAvatarComponent({ color, size = 44, label }: CritterAvatarProps, ref: React.Ref<CritterAvatarHandle>) {
  useImperativeHandle(ref, () => ({ blink: () => {}, spin: () => {}, setExpression: () => {} }));
  // No initials anywhere: a bot without a photo is the glass robot, in a circle.
  return (
    <span data-bot-avatar="robot" className="nb-robot-disc relative block shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
      <RoboAvatar {...roboAparencia({ name: label, color })} estado="online" size={size} label={label} />
    </span>
  );
}

export const CritterAvatar = memo(forwardRef(NordusAvatarComponent));

export type BotAvatarProps = Omit<CritterAvatarProps, "color" | "gradient"> & {
  readable?: boolean;
  estado?: RoboEstado;
  ativo?: boolean;
  roboRef?: Ref<RoboSvg | null>;
  bot: {
    id?: string;
    activity?: BotActivity;
    busy?: boolean;
    name?: string;
    color: CritterColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: BotBodyId | null;
    robot?: WireRobotLook | null;
  };
};

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/** Mirrored name for name by resolveBotAvatarOutcome in ios/Sources/CompanionCore/BotAvatarRendering.swift. */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

export function BotAvatar({ bot, size = 44, label, readable = false, estado, ativo, roboRef }: BotAvatarProps) {
  const profile = botAvatarProfile(bot);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  if (outcome !== "flatImage") {
    // Nordus: no initials; the glass robot always sits in a circle, like a photo.
    return (
      <span data-bot-avatar="robot" className="nb-robot-disc relative block shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
      <RoboAvatar
        ref={roboRef}
        {...roboAparencia(bot)}
        {...(readable && !bot.robot?.light ? { luz: `var(--identity-${bot.color})` } : {})}
        estado={estado ?? roboEstadoDoBot(bot)}
        ativo={ativo}
        size={size}
        label={label ?? bot.name}
      />
      </span>
    );
  }

  // Nordus: every avatar is a circle, whatever crop was saved.
  const radius = "50%";
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised ring-1 ring-white/10"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  avatarUrl,
  size = 32,
}: {
  initials: string;
  avatarUrl?: string;
  size?: number;
}) {
  // A picture that is gone (a restored backup carries the address, not the file) falls back to the initials.
  const [failed, setFailed] = useState<string | null>(null);
  if (avatarUrl && failed !== avatarUrl) {
    return <img loading="lazy" decoding="async" referrerPolicy="no-referrer" src={avatarUrl} alt="" onError={() => setFailed(avatarUrl)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.04] font-mono text-ink-secondary font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
