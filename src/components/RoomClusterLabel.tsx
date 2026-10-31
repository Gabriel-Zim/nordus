import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { CRITTER_COLOR_NAMES, normalizeState, type CritterColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";

export function isPaletteColor(color: string): color is CritterColor {
  return (CRITTER_COLOR_NAMES as readonly string[]).includes(color);
}

export function ClusterLabel({ bot, name, color, gutter = false }: { bot?: Bot; name: string; color: string; gutter?: boolean }) {
  const known = isPaletteColor(color);
  if (gutter) {
    return (
      <div data-room-speaker="" className="mt-2 pl-[38px]">
        <span
          className={cn("nb-name text-[11.5px]", known ? "bot-identity" : "text-ink-secondary")}
          data-bot-color={known ? color : undefined}
        >{name}</span>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-1.5 pl-0.5">
      <BotAvatar
        bot={bot ?? { name, color: color as Bot["color"] }}
        state={normalizeState(bot?.mascotExpression) ?? "happy"}
        size={16}
        motion="none"
        motionKey={0}
        animated={false}
        readable={known}
      />
      <span
        className={cn("nb-name text-[11px]", known ? "bot-identity" : "text-ink-secondary")}
        data-bot-color={known ? color : undefined}
      >{name}</span>
    </div>
  );
}
