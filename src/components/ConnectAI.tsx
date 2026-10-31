import { useState } from "react";
import { Check, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { canConnectAutomatically } from "@/lib/use-connect-engine";
import { useStore, type InstanceInfo } from "@/state/store";
import { EngineSetup } from "./EngineSetup";
import { engineReady } from "./EngineLibrary";
import { InstanceProviderMark } from "./ProviderIcons";
import { ConnectSignIn } from "./ConnectSignIn";

const FRIENDLY_NAMES: Record<string, string> = {
  claudeAgent: "Claude",
  codex: "ChatGPT",
  grokAgent: "Grok",
  antigravityAgent: "Gemini",
  geminiAgent: "Gemini",
};

const FEATURED_ORDER: Record<string, number> = {
  claudeAgent: 0,
  codex: 1,
  antigravityAgent: 2,
  geminiAgent: 2,
  grokAgent: 3,
};

export function friendlyAIName(instance: InstanceInfo): string {
  return FRIENDLY_NAMES[instance.driverKind] ?? instance.displayName;
}

export function aiFamily(instance: InstanceInfo): string {
  if (instance.driverKind === "codex") return "chatgpt";
  if (instance.driverKind === "claudeAgent") return "claude";
  if (instance.driverKind === "grokAgent") return "grok";
  if (instance.driverKind === "antigravityAgent" || instance.driverKind === "geminiAgent") return "gemini";
  return instance.instanceId;
}

function preference(instance: InstanceInfo): number {
  return (engineReady(instance) ? 2 : 0)
    + (instance.snapshot.chatgptPlan === true || instance.authentication?.method === "browser-pkce" ? 1 : 0);
}

function rank(instance: InstanceInfo): number {
  return FEATURED_ORDER[instance.driverKind] ?? 10;
}

function connectable(instance: InstanceInfo): boolean {
  return !instance.readOnly
    && instance.access !== "api"
    && instance.install?.settings !== "connections"
    && (engineReady(instance) || canConnectAutomatically(instance));
}

function fallback(instance: InstanceInfo, primary: ReadonlySet<string>): boolean {
  return !primary.has(aiFamily(instance))
    && !instance.readOnly
    && instance.access !== "api"
    && instance.install?.settings !== "connections"
    && Boolean(instance.install);
}

export function ConnectAI({ variant = "page", onConnected, className }: {
  variant?: "page" | "embedded";
  onConnected?: () => void;
  className?: string;
}) {
  const { state, dispatch, refreshInstances } = useStore();
  const [checking, setChecking] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const embedded = variant === "embedded";
  const instances = state.instances ?? [];
  const primary = instances.filter(connectable).sort((left, right) =>
    preference(right) - preference(left)
    || rank(left) - rank(right)
    || friendlyAIName(left).localeCompare(friendlyAIName(right)))
    .filter((instance, index, all) => all.findIndex((other) => aiFamily(other) === aiFamily(instance)) === index);
  const primaryFamilies = new Set(primary.map(aiFamily));
  const fallbacks = instances.filter((instance) => fallback(instance, primaryFamilies));
  const remote = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;

  const refresh = async () => {
    if (checking) return;
    setChecking(true);
    setRefreshFailed(false);
    try {
      await refreshInstances({ reportErrors: true });
    } catch {
      setRefreshFailed(true);
    } finally {
      setChecking(false);
    }
  };

  const Heading = embedded ? "h2" : "h1";
  return (
    <section data-connect-ai={variant} className={cn("w-full", className)}>
      <Heading className={cn("font-semibold text-ink", embedded ? "text-[15px]" : "text-[22px]")}>
        {t("connectAI.title")}
      </Heading>
      {!embedded && (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">{t("connectAI.intro")}</p>
      )}

      {primary.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {primary.map((instance) => (
            <ConnectAICard key={instance.instanceId} instance={instance} embedded={embedded} onConnected={onConnected} />
          ))}
        </div>
      )}
      {primary.length === 0 && fallbacks.length === 0 && (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-secondary">{t("connectAI.empty")}</p>
      )}
      {refreshFailed && <p role="alert" className="mt-3 text-[12px] text-danger">{t("onboarding.engines.error")}</p>}

      <button
        type="button"
        onClick={() => void refresh()}
        disabled={checking}
        className="mt-4 flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-[12.5px] text-ink hover:bg-raised-hover disabled:opacity-60"
      >
        {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {checking ? t("connectAI.checking") : t("connectAI.checkAgain")}
      </button>

      <details data-connect-ai-fallback className="mt-5 rounded-xl border border-hairline/40 bg-card px-3.5 py-3">
        <summary className="cursor-pointer select-none text-[12.5px] font-medium text-ink-secondary">
          {t("connectAI.help")}
        </summary>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("connectAI.helpHint")}</p>
        {fallbacks.length > 0 && (
          <div className="mt-3 space-y-2">
            {fallbacks.map((instance) => (
              <div key={instance.instanceId} className="rounded-lg border border-hairline/40 bg-app px-3 py-2.5">
                <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <InstanceProviderMark instance={instance} size={16} />
                  {instance.displayName}
                </div>
                <EngineSetup
                  instance={instance}
                  intent={instance.access === "custom" ? "inject" : "cloud"}
                  className="mt-0.5"
                />
              </div>
            ))}
          </div>
        )}
        {!remote && (
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "connections" })}
            className="mt-3 flex w-full items-center gap-3 rounded-lg border border-hairline/40 bg-app px-3 py-2.5 text-left hover:bg-control/40"
          >
            <KeyRound size={16} className="shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink">{t("connectAI.apiKey")}</span>
              <span className="block text-[11.5px] text-ink-secondary">{t("connectAI.apiKeyHint")}</span>
            </span>
          </button>
        )}
      </details>
    </section>
  );
}

function ConnectAICard({ instance, embedded, onConnected }: {
  instance: InstanceInfo;
  embedded: boolean;
  onConnected?: () => void;
}) {
  const ready = engineReady(instance);
  return (
    <div
      data-connect-ai-card={instance.instanceId}
      className={cn(
        "rounded-xl border border-hairline/40 bg-card",
        embedded ? "px-3 py-2.5" : "px-4 py-3.5",
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-inset", embedded ? "size-8" : "size-10")}>
          <InstanceProviderMark instance={instance} size={embedded ? 20 : 24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate font-semibold text-ink", embedded ? "text-[14px]" : "text-[15.5px]")}>
            {friendlyAIName(instance)}
          </div>
          {ready && (
            <div className="flex items-center gap-1 text-[12px] text-success">
              <Check size={12} />
              {t("connectAI.connected")}
            </div>
          )}
          {ready && instance.snapshot.account?.email && (
            <div className="truncate text-[11.5px] text-ink-secondary">{instance.snapshot.account.email}</div>
          )}
        </div>
      </div>
      {!ready && <ConnectSignIn instance={instance} compact={embedded} onConnected={onConnected} />}
    </div>
  );
}
