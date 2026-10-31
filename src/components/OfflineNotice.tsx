import { WifiOff } from "lucide-react";
import { t } from "@/lib/i18n";
import { useOnline } from "@/lib/use-online";

export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-3 bottom-3 z-40 mx-auto flex w-fit max-w-[min(28rem,calc(100%-1.5rem))] items-center gap-2 rounded-full border border-hairline/50 bg-card px-3.5 py-2 text-[12.5px] text-ink-secondary shadow-lg">
      <WifiOff size={14} className="shrink-0" aria-hidden="true" />
      <span>{t("offline.notice")}</span>
    </div>
  );
}
