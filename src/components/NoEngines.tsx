import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/state/store";
import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { ConnectAI } from "@/components/ConnectAI";
import { t } from "@/lib/i18n";

export function NoEngines() {
  const { refreshInstances } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const [rechecking, setRechecking] = useState(false);
  const recheck = async () => {
    setRechecking(true);
    try {
      await refreshInstances();
    } finally {
      setRechecking(false);
    }
  };

  if (remoteClient) {
    return (
      <main className="relative flex h-full min-w-0 flex-1 items-center justify-center bg-app px-6">
        <WindowDragStrip />
        <div className="max-w-[520px] rounded-2xl border border-hairline/40 bg-card p-6 text-center">
          <h1 className="text-[20px] font-semibold text-ink">{t("noEngines.remoteTitle")}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-secondary">
            {t("noEngines.remoteBody")}
          </p>
          <button onClick={() => void recheck()} disabled={rechecking} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-60">
            {rechecking && <Loader2 size={14} className="animate-spin" />}
            {rechecking ? t("noEngines.remoteChecking") : t("noEngines.remoteCheck")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-app">
      <WindowDragStrip />
      <div className="mx-auto w-full max-w-[720px] px-6 py-12">
        <ConnectAI />
      </div>
    </main>
  );
}
