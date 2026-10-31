import { CRITTER_COLORS, type CritterColor } from "@/lib/mascot";
import { brand } from "@/lib/brand";

/* Nordus: no lugar do mascote, um monograma quadrado de vidro com a marca de
   cor do robô no canto. Sério, sem rosto nem animação. */

const N_PATH =
  "M73.97,33.37s-.03-.09-.08-.09c-.03,0-.07.02-.08.05-2.3,4.07-4.23,7.61-5.79,10.61-.34.64-.74,1.2-1.47,1.15-1.08-.07-1.25-.71-1.27-1.75-.1-4.44-.16-7.83-.2-10.15,0-.25-.19-.46-.44-.5-3.29-.47-7.23-.95-11.83-1.44-.86-.09-1.95-1.27-1-2.04.42-.34.75-.57.99-.71,8.24-4.51,16.91-9.53,26-15.06,1.24-.76,2.33-.62,3.27.4.16.18.25.4.25.64v69.92c0,.14-.11.25-.25.25h-7.4c-.16,0-.31-.07-.42-.19l-22.58-25.35c-.16-.19-.45-.21-.64-.05-2.43,1.94-4.16,3.3-5.2,4.08-8.89,6.7-17.4,13.15-25.53,19.38-.63.49-1.9,1.38-3.8,2.68-.14.09-.32.06-.41-.08-.04-.05-.05-.11-.05-.17V13.76c0-.28.22-.5.5-.5h6.7c.16,0,.32.07.42.19l23.14,26.62c.24.27.6.4.96.34,3.34-.55,6.11.33,8.31,2.63,2.6,2.71,3.39,6.65,1.82,10.14-.06.14-.04.31.07.42l15.9,17.85s.07.03.1,0c.02-.01.03-.04.03-.06v-38.04ZM24.49,71.86c2.09-3.05,4.13-6.19,6.12-9.44,4.28-7.02,7.63-12.58,10.05-16.66.08-.13.06-.3-.04-.41l-16.17-18.15s-.08-.03-.11,0c-.01.01-.02.03-.02.05v44.57c0,.05.04.09.09.09.03,0,.06-.02.07-.04ZM53.83,49.88c0-2.52-2.04-4.56-4.56-4.56h0c-2.52,0-4.56,2.04-4.56,4.56h0c0,2.52,2.04,4.56,4.56,4.56s4.56-2.04,4.56-4.56Z";

export function NordusLogo({ size = 24, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path fill="currentColor" d={N_PATH} />
    </svg>
  );
}

export function monogramFor(label: string | undefined): string {
  const words = (label ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "N";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function monogramRadius(size: number): number {
  return Math.max(5, Math.round(size * 0.27));
}

export function NordusMonogram({
  color,
  size = 44,
  label,
  tint,
}: {
  color: CritterColor;
  size?: number;
  label?: string;
  tint?: string;
}) {
  const radius = monogramRadius(size);
  const mark = Math.max(4, Math.round(size * 0.16));
  const isBrand = !label || label === brand().name;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      data-nordus-monogram=""
      className="relative inline-grid shrink-0 place-items-center overflow-hidden border border-white/10 bg-white/[0.04] text-ink"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0"
        style={{
          width: mark,
          height: mark,
          borderBottomRightRadius: 4,
          background: tint ?? `var(--identity-${color}, ${CRITTER_COLORS[color] ?? CRITTER_COLORS.orange})`,
        }}
      />
      {isBrand ? (
        <NordusLogo size={Math.round(size * 0.62)} />
      ) : size < 14 ? null : (
        <span
          aria-hidden="true"
          className="font-mono font-bold leading-none tracking-[0.04em]"
          style={{ fontSize: Math.max(8, Math.round(size * 0.3)) }}
        >
          {monogramFor(label)}
        </span>
      )}
    </span>
  );
}
