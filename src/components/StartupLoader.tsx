import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";

export const STARTUP_SLOW_MS = 6_000;

export function StartupLoader({ connected, dev = import.meta.env.DEV, retry }: {
  connected: boolean;
  dev?: boolean;
  retry?: () => void;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (connected || dev) return;
    const timer = setTimeout(() => setSlow(true), STARTUP_SLOW_MS);
    return () => clearTimeout(timer);
  }, [connected, dev]);

  if (connected) return <><Loader2 size={20} className="animate-spin" /><div className="text-[14px]">{t("shell.loadingBots")}</div></>;
  if (dev) return <>
    <Loader2 size={20} className="animate-spin" />
    <div className="text-[14px]">{t("shell.connecting")}</div>
    <div className="text-[12px]">{t("shell.startServer")} <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code></div>
  </>;
  if (slow) return <>
    <div role="alert" className="text-[14px]">{t("shell.startFailed")}</div>
    <button
      type="button"
      onClick={() => (retry ?? (() => window.location.reload()))()}
      className="ui-button ui-button-md rounded-full"
    >
      {t("shell.tryAgain")}
    </button>
  </>;
  return <><Loader2 size={20} className="animate-spin" /><div className="text-[14px]">{t("shell.turningOn")}</div></>;
}
