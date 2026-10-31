import { Server } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** The filter that swaps the Apps list for the technical connections; advanced view only. */
export function McpFilterPill({ active, pill, onToggle }: { active: boolean; pill: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-apps-filter="mcp"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(pill, "h-9 border border-hairline/40 px-3.5", active ? "bg-ink text-app" : "text-ink hover:bg-raised")}
    >
      <Server size={14} aria-hidden="true" />
      <span className="hidden sm:inline">{t("apps.filter.mcp")}</span>
      <span className="sr-only sm:hidden">{t("apps.filter.mcp")}</span>
    </button>
  );
}
