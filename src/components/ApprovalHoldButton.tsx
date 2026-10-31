import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { HOLD_TO_APPROVE_MS } from "../../shared/approvals";

/** A screen reader's "click" arrives with no press to hold: it asks twice, close together, instead. */
const CONFIRM_WINDOW_MS = 6_000;

export function ApprovalHoldButton({
  onApprove,
  className,
  holdMs = HOLD_TO_APPROVE_MS,
  disabled,
}: {
  onApprove: () => void;
  className?: string;
  holdMs?: number;
  disabled?: boolean;
}) {
  const [holding, setHolding] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(false);
  const hintId = useId();

  const finish = useCallback(() => {
    done.current = true;
    // A failed answer leaves the button on screen: it may be held again a moment later.
    setTimeout(() => { done.current = false; }, 2_000);
    onApprove();
  }, [onApprove]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, []);

  const begin = useCallback(() => {
    if (disabled || done.current || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      finish();
    }, holdMs);
  }, [disabled, finish, holdMs]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (armTimer.current) clearTimeout(armTimer.current);
  }, []);

  const label = armed ? t("approvals.hold.confirmAgain") : t("approvals.hold.label");
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        data-hold-to-approve=""
        data-holding={holding || undefined}
        aria-describedby={hintId}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          begin();
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          if (!event.repeat) begin();
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") cancel();
        }}
        onBlur={cancel}
        onClick={(event) => {
          // A press is the hold's business; only a click with no press behind it (assistive technology) lands here.
          if (event.detail !== 0 || disabled || done.current) return;
          if (!armed) {
            setArmed(true);
            armTimer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
            return;
          }
          if (armTimer.current) clearTimeout(armTimer.current);
          setArmed(false);
          finish();
        }}
        className={cn(
          "relative inline-flex h-7 shrink-0 select-none items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] bg-accent/80 px-3 text-[13px] font-medium leading-5 text-white transition-colors",
          "touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
      >
        <span
          aria-hidden="true"
          data-hold-fill=""
          className="absolute inset-y-0 left-0 bg-white/30 ease-linear"
          style={{ width: holding ? "100%" : "0%", transitionProperty: "width", transitionDuration: holding ? `${holdMs}ms` : "120ms" }}
        />
        <span className="relative inline-flex items-center gap-1.5">
          <Check size={14} aria-hidden="true" />
          {label}
        </span>
      </button>
      <span id={hintId} className="sr-only" aria-live="polite">
        {armed ? t("approvals.hold.armed") : t("approvals.hold.hint")}
      </span>
    </>
  );
}
