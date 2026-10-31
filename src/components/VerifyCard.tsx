import { BookmarkPlus, Check, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { type RunSkill, type RunStep } from "@/lib/verify-steps";
import { commandPhrase } from "@/lib/tool-step-label";

function StatusIcon({ status }: { status: RunStep["status"] }) {
  const className = "size-3.5 shrink-0";
  switch (status) {
    case "running":
      return <Loader2 aria-hidden="true" className={cn(className, "animate-spin text-ink-tertiary")} />;
    case "passed":
      return <Check aria-hidden="true" className={cn(className, "text-ink-tertiary")} />;
    case "failed":
      return <X aria-hidden="true" className={cn(className, "text-danger/70")} />;
  }
}

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary outline-none hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60";

export function VerifyCard({
  steps,
  canSave,
  skill,
  onDismiss,
  onSave,
}: {
  steps: RunStep[];
  canSave: boolean;
  skill: RunSkill;
  onDismiss: () => void;
  onSave: () => void;
}) {
  const defaultCollapsed = steps.length > 6;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (steps.length === 0) return null;
  const failed = steps.filter((step) => step.status === "failed").length;
  const running = steps.some((step) => step.status === "running");
  const status = running ? t("chat.verify.human.working") : failed ? t("chat.verify.human.failed", { count: failed }) : t("chat.verify.human.done");
  const toggleLabel = collapsed ? t("chat.verify.expand") : t("chat.verify.collapse");
  return (
    <section
      aria-label={t("chat.verify.aria")}
      className="pointer-events-auto w-[22rem] max-w-full rounded-2xl border border-hairline/40 bg-raised/95 text-ink shadow-lg"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-medium">{t("chat.verify.title")}</span>
          <span role="status" aria-live="polite" aria-atomic="true" className="text-[12px] text-ink-secondary">
            {status}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={ICON_BUTTON}
        >
          {collapsed ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        <button type="button" onClick={onDismiss} aria-label={t("chat.verify.dismiss")} title={t("chat.verify.dismiss")} className={ICON_BUTTON}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {!collapsed && (
        <>
          <ol
            tabIndex={0}
            aria-label={t("chat.verify.steps")}
            className="max-h-56 overflow-y-auto border-t border-hairline/25 px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {steps.map((step) => (
              <li key={step.id} className="flex min-w-0 items-center gap-2 py-1">
                <StatusIcon status={step.status} />
                <span className="min-w-0 truncate text-[13px]">{commandPhrase(`${step.label} ${step.command}`)}</span>
              </li>
            ))}
          </ol>
          {skill ? (
            <div className="border-t border-hairline/25 px-3 py-2 text-[12px] text-ink-secondary">
              {t(skill === "saved" ? "chat.verify.saved" : "chat.verify.staged")}
            </div>
          ) : canSave && (
            <div className="flex flex-col items-end gap-1 border-t border-hairline/25 px-3 py-2">
              <button
                type="button"
                onClick={onSave}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-secondary outline-none hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <BookmarkPlus size={13} aria-hidden="true" />
                {t("chat.verify.save")}
              </button>
              <span className="text-[12px] text-ink-secondary">{t("chat.verify.saveHint")}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
