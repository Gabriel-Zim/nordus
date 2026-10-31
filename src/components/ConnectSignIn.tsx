import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, LogIn } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { connectMethod, useConnectEngine } from "@/lib/use-connect-engine";
import type { InstanceInfo } from "@/state/store";
import {
  DEVICE_SIGN_IN_COPY,
  DeviceSignInProgress,
  deviceSignInProvider,
  type DeviceSignInStatus,
} from "./DeviceSignIn";

function startLabel(instance: InstanceInfo, method: ReturnType<typeof connectMethod>): string {
  if (method === "paste-code") return t("engineSetup.claude.start");
  if (method === "browser-pkce") return t("engineSetup.chatgpt.start");
  if (method === "device-code") return t(DEVICE_SIGN_IN_COPY[deviceSignInProvider(instance.driverKind)].start);
  return t("connectAI.connect");
}

function busyLabel(method: ReturnType<typeof connectMethod>): string {
  if (method === "paste-code") return t("engineSetup.claude.starting");
  if (method === "browser-pkce") return t("engineSetup.chatgpt.starting");
  if (method === "device-code") return t("engineSetup.device.starting");
  return t("connectAI.preparing");
}

export function ConnectSignIn({ instance, compact = false, onConnected }: {
  instance: InstanceInfo;
  compact?: boolean;
  onConnected?: () => void;
}) {
  const { status, message, flow, busy, connect, submitCode, cancel } = useConnectEngine(instance);
  const [code, setCode] = useState("");
  const method = connectMethod(instance);
  const provider = deviceSignInProvider(instance.driverKind);
  const wasConnected = useRef(status === "connected");

  useEffect(() => {
    if (status === "connected" && !wasConnected.current) onConnected?.();
    wasConnected.current = status === "connected";
  }, [onConnected, status]);

  const auth: DeviceSignInStatus | null = flow
    ? {
        phase: status === "failed" ? "failed" : "waiting",
        flowId: flow.flowId,
        authorizationUrl: flow.link,
        userCode: flow.code,
        expiresAt: flow.expiresAt,
      }
    : null;

  return (
    <div
      className={cn("space-y-2", compact ? "mt-2" : "mt-3")}
      data-device-sign-in={method === "device-code" ? provider : undefined}
      data-chatgpt-plan-sign-in={method === "browser-pkce" || undefined}
      data-claude-sign-in={method === "paste-code" || undefined}
      data-managed-sign-in={method === "browser" || undefined}
    >
      {status === "connected" ? (
        <p role="status" className="text-[12px] text-success">{message || t("connectAI.connected")}</p>
      ) : status === "failed" ? (
        <>
          <p role="alert" className="text-[12px] text-danger">{message || t("connectAI.failed", { name: instance.displayName })}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void connect()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
            {t("connectAI.retry")}
          </button>
        </>
      ) : status === "preparing" ? (
        <button type="button" disabled className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white opacity-70">
          <Loader2 size={14} className="animate-spin" />
          {busyLabel(method)}
        </button>
      ) : status === "needs-code" && flow?.method === "paste-code" ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink-secondary">{message || t("connectAI.enterCode")}</p>
          {flow.link && (
            <button
              type="button"
              onClick={() => void openExternalLink(flow.link!).catch(() => {})}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
            >
              <ExternalLink size={12} /> {t("connectAI.openPage")}
            </button>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCode(code);
            }}
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t("connectAI.codePlaceholder")}
              aria-label={t("connectAI.codePlaceholder")}
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-hairline/60 bg-app px-2.5 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : t("connectAI.submitCode")}
            </button>
          </form>
          <CancelButton busy={busy} onClick={() => void cancel()} />
        </>
      ) : (status === "waiting-browser" || status === "needs-code") && auth && flow ? (
        <>
          {flow.method === "browser-pkce" || flow.method === "device-code" ? (
            <DeviceSignInProgress auth={auth} browserPkce={flow.method === "browser-pkce"} provider={provider} />
          ) : (
            <div className="space-y-2 rounded-lg border border-hairline/50 bg-app p-3">
              <p className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
                <Loader2 size={13} className="animate-spin" />
                {message || t("connectAI.waitingBrowser")}
              </p>
              {flow.link && (
                <button
                  type="button"
                  onClick={() => void openExternalLink(flow.link!).catch(() => {})}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
                >
                  <ExternalLink size={12} /> {t("connectAI.openPage")}
                </button>
              )}
            </div>
          )}
          <CancelButton busy={busy} onClick={() => void cancel()} />
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void connect()}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50",
            method === "browser-pkce"
              ? "border border-black/20 bg-white text-black hover:opacity-85"
              : "bg-accent text-white hover:brightness-110",
          )}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : method === "browser-pkce" ? null : <LogIn size={14} />}
          {startLabel(instance, method)}
        </button>
      )}
    </div>
  );
}

function CancelButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="w-full rounded-lg bg-control px-3 py-2 text-[12px] font-medium text-ink disabled:opacity-50"
    >
      {busy ? t("engineSetup.device.cancelling") : t("engineSetup.device.cancel")}
    </button>
  );
}
