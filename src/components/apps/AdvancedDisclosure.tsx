import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** The technical corner of the Apps window: closed by default, children stay mounted so their searches and
 *  refreshes keep working. `openSignal` opens it from outside (a changed number), `defaultOpen` on first paint. */
export function AdvancedDisclosure({ openSignal = 0, defaultOpen = false, children }: {
  openSignal?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  useEffect(() => { if (openSignal > 0) setOpen(true); }, [openSignal]);
  return (
    <section data-apps-advanced="" className="mt-8 border-t border-hairline/30 pt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-start text-ink-secondary transition-colors hover:bg-raised/50 hover:text-ink"
      >
        <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 transition-transform rtl:-scale-x-100", open && "rotate-90 rtl:-scale-x-100")} />
        <span className="text-[13px] font-medium">{t("apps.advanced.title")}</span>
        <span className="min-w-0 truncate text-[12px] text-ink-tertiary">{t("apps.advanced.hint")}</span>
      </button>
      <div id={bodyId} hidden={!open} className="pt-3">{children}</div>
    </section>
  );
}
