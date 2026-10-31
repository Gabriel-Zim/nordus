import { Users } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

export function StackedCritters({ members, density, px, large: _large }: { members: Bot[]; density: SidebarDensity; /** Upstream's bigger row; the Nordus mosaic already sizes itself. */ large?: boolean; /** Draw the mosaic in a square of this many pixels instead of the density's own size. */ px?: number }) {
  const iconOnly = density === "icons";
  // The room's mosaic takes exactly a bot avatar's space in the list.
  const slotSize = iconOnly ? "size-12" : density === "compact" ? "size-11" : "size-16";
  const singleSize = px ?? (iconOnly ? 44 : density === "compact" ? 44 : 64);
  const box = px ? { width: px, height: px } : undefined;
  if (members.length <= 1) {
    const b = members[0];
    return (
      <div className={cn("flex shrink-0 items-center justify-center", !px && slotSize)} style={box}>
        {b ? <BotAvatar bot={b} state="happy" size={singleSize} animated={false} /> : <Users size={24} className="text-ink-secondary" />}
      </div>
    );
  }
  // A room is a 2x2 mosaic of its members' round avatars, slightly overlapping, filling exactly one avatar's space.
  // Two members sit on the diagonal so the pair fills the circle too.
  const shown = members.slice(0, 4);
  const cell = px ? Math.round(px * 0.58) : iconOnly ? 26 : density === "compact" ? 26 : 37;
  const slots = shown.length === 2 ? [0, 3] : [0, 1, 2, 3];
  return (
    <div data-room-mosaic="" className={cn("relative shrink-0", !px && slotSize)} style={box}>
      {shown.map((b, index) => {
        const slot = slots[index]!;
        return (
          <span key={b.id} className={cn("absolute flex", slot % 2 === 0 ? "left-0" : "right-0", slot < 2 ? "top-0" : "bottom-0")} style={{ zIndex: 4 - index }}>
            <BotAvatar bot={b} state="happy" size={cell} animated={false} />
          </span>
        );
      })}
    </div>
  );
}
