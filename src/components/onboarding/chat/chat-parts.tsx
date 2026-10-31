import type { ReactNode } from "react";
import { CritterAvatar } from "@/components/Avatar";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CritterState } from "@/lib/mascot";
import type { ChatProgress, StepRecord } from "@/lib/onboarding-chat";
import { QuietButton } from "../beats/shared";

export interface StepProps {
  progress: ChatProgress;
  onComplete: (record: StepRecord) => void;
  onSkip: () => void;
  onBusy: (busy: boolean) => void;
}

/** The product's mascot speaking: its name is the product's, and the bubble holds one question. */
export function Say({ state, children }: { state: CritterState; children: ReactNode }) {
  return (
    <div className="animate-rise flex items-start gap-3">
      <div className="mt-0.5 flex shrink-0">
        <CritterAvatar color="green" state={state} motion="blink" motionKey={1} size={40} label={brand().name} />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-ink-secondary">{brand().name}</p>
        <div className="glass-card mt-1 rounded-2xl rounded-tl-md px-4 py-3 text-[14.5px] leading-relaxed text-ink">{children}</div>
      </div>
    </div>
  );
}

export function Chips({ items, selected, onPick, label, stacked = false }: {
  items: readonly string[];
  selected: string;
  onPick: (value: string) => void;
  label: string;
  stacked?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex gap-2", stacked ? "flex-col items-stretch" : "flex-wrap")}>
      {items.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={item === selected}
          onClick={() => onPick(item)}
          className={cn(
            "border px-3 py-1.5 text-left text-[13px] leading-snug transition-colors",
            stacked ? "rounded-xl" : "rounded-full",
            item === selected
              ? "border-accent/70 bg-accent/15 text-ink"
              : "border-hairline/40 text-ink-secondary hover:border-hairline hover:text-ink",
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function StepFooter({ label, disabled = false, onSkip, busy = false, hideSkip = false }: {
  label: string;
  disabled?: boolean;
  onSkip: () => void;
  busy?: boolean;
  hideSkip?: boolean;
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      {hideSkip ? <span /> : <QuietButton type="button" onClick={onSkip} disabled={busy}>{t("onboarding.chat.skip")}</QuietButton>}
      <button
        type="submit"
        data-primary=""
        disabled={disabled || busy}
        className="shrink-0 rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-white transition-[transform,opacity] duration-150 active:scale-[0.98] disabled:opacity-40"
      >
        {label}
        <span aria-hidden="true" className="ml-2 opacity-70">↵</span>
      </button>
    </div>
  );
}

export function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="animate-rise mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
      {children}
    </p>
  );
}

export const textFieldClass =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-accent/60 focus:outline-none";
