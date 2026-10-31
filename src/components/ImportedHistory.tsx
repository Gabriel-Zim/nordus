import { ArrowLeft, History } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

type ImportedThread = { threadId: string; title: string; createdAt: number; importedFrom?: "grok" };

export function importedThreads<T extends ImportedThread>(tasks: readonly T[] | undefined): T[] {
  return (tasks ?? []).filter((task) => task.importedFrom === "grok");
}

/** Imported conversations are no longer opened: when one is current, the live thread to go to instead, else null. */
export function liveThreadAway(
  tasks: readonly (ImportedThread & { routineRunId?: string | null })[] | undefined,
  current: string,
  main?: string,
): string | null {
  if (!tasks?.find((task) => task.threadId === current)?.importedFrom) return null;
  if (main && tasks.some((task) => task.threadId === main && !task.importedFrom)) return main;
  return tasks.find((task) => !task.importedFrom && !task.routineRunId)?.threadId ?? null;
}

/** Under an imported conversation the composer gives way to this: it is history, read here and answered elsewhere. */
export function ImportedHistoryBar({ onBack }: { onBack: () => void }) {
  return (
    <div data-imported-history-bar="" className="pointer-events-auto mx-5 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3">
      <p className="flex min-w-0 items-center gap-2 text-[13px] text-ink-secondary">
        <History size={15} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{t("imported.readOnly")}</span>
      </p>
      <button type="button" onClick={onBack} className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[12.5px] font-medium text-ink hover:bg-white/[0.1]">
        <ArrowLeft size={13} aria-hidden="true" />
        {t("imported.back")}
      </button>
    </div>
  );
}

/** "Histórico do Grok" on a bot's or room's panel: the conversations copied in from Grok, opened to read. */
export function ImportedHistoryList({ tasks, currentThreadId, onOpen, className }: {
  tasks: readonly ImportedThread[];
  currentThreadId?: string;
  onOpen: (threadId: string) => void;
  className?: string;
}) {
  if (!tasks.length) return null;
  return (
    <section data-imported-history="" className={cn("flex shrink-0 flex-col gap-2", className)}>
      <h3 className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">{t("imported.title")}</h3>
      <ul className="divide-y divide-hairline/40 overflow-hidden rounded-[14px] border border-white/[0.07] bg-white/[0.03]">
        {tasks.map((task) => (
          <li key={task.threadId}>
            <button
              type="button"
              data-imported-thread={task.threadId}
              aria-current={task.threadId === currentThreadId ? "true" : undefined}
              onClick={() => onOpen(task.threadId)}
              className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-white/[0.04]", task.threadId === currentThreadId && "bg-white/[0.05]")}
            >
              <History size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{task.title}</span>
              <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t("imported.readOnlyShort")}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
