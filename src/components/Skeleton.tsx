import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

const BAR = "rounded-md bg-ink/10 motion-safe:animate-pulse";

export function SkeletonRows({ count = 5, label = t("skeleton.loadingList"), className }: { count?: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} data-skeleton="rows" className={cn("flex flex-col gap-1 px-1 py-1", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl px-2 py-2" aria-hidden="true">
          <span className={cn(BAR, "size-9 shrink-0 rounded-full")} />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={cn(BAR, "h-3 w-2/5")} />
            <span className={cn(BAR, "h-2.5", index % 2 ? "w-3/5" : "w-4/5")} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function SkeletonMessages({ label = t("chat.loadingEarlier") }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} data-skeleton="messages" className="flex flex-col gap-3 py-3">
      {[["w-3/5", "justify-start"], ["w-2/5", "justify-end"], ["w-4/5", "justify-start"]].map(([width, side], index) => (
        <div key={index} className={cn("flex", side)} aria-hidden="true">
          <span className={cn(BAR, "h-10 rounded-2xl", width)} />
        </div>
      ))}
    </div>
  );
}
