import { useCallback, useEffect, useRef, useState } from "react";
import { api, useStore, type InstanceInfo } from "@/state/store";
import { engineReady } from "@/components/EngineLibrary";
import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import { deviceSignInProvider } from "@/components/DeviceSignIn";
import { deviceSignInLink } from "../../shared/device-sign-in";
import { chatgptPlanLink, claudeSignInLink, secureSignInLink } from "./sign-in-links";
import {
  cancelProviderAuth,
  completeProviderAuth,
  deviceFlowUnavailable,
  providerAuthStatus,
  startProviderAuth,
} from "./provider-auth";

export const CONNECT_POLL_MS = 2_000;

export type ConnectStatus = "idle" | "preparing" | "waiting-browser" | "needs-code" | "connected" | "failed";
export type ConnectMethod = "browser-pkce" | "device-code" | "paste-code" | "browser";

export function connectMethod(instance: InstanceInfo | undefined): ConnectMethod | null {
  const method = instance?.authentication?.method;
  return method === "browser-pkce" || method === "device-code" || method === "paste-code" || method === "browser"
    ? method
    : null;
}

export function canConnectAutomatically(instance: InstanceInfo): boolean {
  if (engineReady(instance)) return true;
  if (instance.readOnly || instance.access === "api" || instance.install?.settings === "connections") return false;
  if (instance.snapshot.authenticationUnavailableReason || !connectMethod(instance)) return false;
  if (instance.snapshot.state === "unavailable") return Boolean(instance.install?.server || instance.install?.managed);
  return instance.snapshot.authenticated === false;
}

type Dispatch = ReturnType<typeof useStore>["dispatch"];

export async function installEngine(instance: InstanceInfo, dispatch: Dispatch): Promise<InstanceInfo | undefined> {
  const body = await api<{ instances?: InstanceInfo[] }>(
    `/api/instances/${encodeURIComponent(instance.instanceId)}/install`,
    { method: "POST" },
  );
  if (Array.isArray(body.instances)) dispatch({ type: "instances", instances: body.instances });
  return body.instances?.find((entry) => entry.instanceId === instance.instanceId);
}

export function useInstallEngine(instance: InstanceInfo) {
  const { dispatch, refreshModels } = useStore();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  const run = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setDone(false);
    setError(null);
    try {
      const installed = await installEngine(instance, dispatch);
      if (installed?.snapshot.state !== "available") {
        throw new Error(t("engineSetup.installNotVerified", {
          reason: installed?.snapshot.reason ?? t("engineSetup.noReason"),
        }));
      }
      setDone(true);
      await refreshModels(instance.instanceId).catch(() => {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [dispatch, instance, refreshModels]);

  return { busy, done, error, run };
}

interface ActiveFlow {
  flowId: string;
  method: ConnectMethod;
  link: string | null;
  code?: string;
  expiresAt: string | null;
}

function trustedLink(method: ConnectMethod, driverKind: string, authorizationUrl: string | null, userCode?: string): string | null {
  if (method === "browser-pkce") return chatgptPlanLink(authorizationUrl);
  if (method === "device-code") return deviceSignInLink(deviceSignInProvider(driverKind), authorizationUrl, userCode);
  if (method === "paste-code") return claudeSignInLink(authorizationUrl);
  return secureSignInLink(authorizationUrl);
}

export function useConnectEngine(instance: InstanceInfo | undefined) {
  const { dispatch, refreshInstances, refreshModels } = useStore();
  const name = instance?.displayName ?? "";
  const [status, setStatus] = useState<ConnectStatus>(instance && engineReady(instance) ? "connected" : "idle");
  const [message, setMessage] = useState("");
  const [flow, setFlow] = useState<ActiveFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const fail = useCallback((kind: "failed" | "installFailed" | "expired") => {
    setFlow(null);
    setStatus("failed");
    setMessage(t(kind === "installFailed" ? "connectAI.installFailed" : kind === "expired" ? "connectAI.expired" : "connectAI.failed", { name }));
  }, [name]);

  const settle = useCallback(async () => {
    setFlow(null);
    setStatus("connected");
    setMessage(t("connectAI.connectedNow", { name }));
    if (!instance) return;
    try { await refreshInstances(); } catch {}
    try { await refreshModels(instance.instanceId); } catch {}
  }, [instance, name, refreshInstances, refreshModels]);

  const connect = useCallback(async () => {
    if (!instance || pending.current) return;
    pending.current = true;
    setBusy(true);
    setStatus("preparing");
    setMessage(t("connectAI.preparing"));
    setFlow(null);
    let installing = false;
    try {
      if (engineReady(instance)) {
        await settle();
        return;
      }
      if (instance.readOnly || instance.access === "api" || instance.snapshot.authenticationUnavailableReason) {
        fail("failed");
        return;
      }
      let current = instance;
      if (current.snapshot.state !== "available") {
        if (!current.install?.server && !current.install?.managed) {
          fail("installFailed");
          return;
        }
        installing = true;
        const installed = await installEngine(current, dispatch);
        if (installed) current = { ...current, ...installed };
        if (current.snapshot.state !== "available") {
          fail("installFailed");
          return;
        }
        installing = false;
        await refreshModels(current.instanceId).catch(() => {});
      }
      if (engineReady(current)) {
        await settle();
        return;
      }
      const method = connectMethod(current);
      if (!method) {
        fail("failed");
        return;
      }
      const auth = await startProviderAuth(current.instanceId);
      if (auth.phase === "succeeded") {
        await settle();
        return;
      }
      if (auth.phase !== "waiting" || !auth.flowId) {
        fail(auth.phase === "expired" ? "expired" : "failed");
        return;
      }
      const link = trustedLink(method, current.driverKind, auth.authorizationUrl, auth.userCode);
      setFlow({ flowId: auth.flowId, method, link, code: auth.userCode, expiresAt: auth.expiresAt });
      if (method === "paste-code") {
        setStatus("needs-code");
        setMessage(t("connectAI.enterCode"));
        if (link) await openExternalLink(link).catch(() => {});
        return;
      }
      if (method === "device-code") {
        setStatus("needs-code");
        setMessage(t("connectAI.waitingCode"));
        return;
      }
      setStatus("waiting-browser");
      setMessage(t("connectAI.waitingBrowser"));
      if (link) await openExternalLink(link).catch(() => {});
    } catch {
      fail(installing ? "installFailed" : "failed");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [dispatch, fail, instance, refreshModels, settle]);

  useEffect(() => {
    if (!instance || !flow) return;
    if (flow.method === "paste-code") return;
    if (status !== "waiting-browser" && status !== "needs-code") return;
    const controller = new AbortController();
    const remaining = flow.expiresAt ? Date.parse(flow.expiresAt) - Date.now() : Number.NaN;
    const expiryTimer = Number.isFinite(remaining)
      ? window.setTimeout(() => {
          controller.abort();
          fail("expired");
        }, Math.max(0, remaining))
      : null;

    const poll = async () => {
      try {
        if (flow.method === "browser") {
          const body = await api<{ instances?: InstanceInfo[] }>("/api/instances", { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (Array.isArray(body.instances)) dispatch({ type: "instances", instances: body.instances });
          const refreshed = body.instances?.find((entry) => entry.instanceId === instance.instanceId);
          if (refreshed && engineReady(refreshed)) await settle();
          return;
        }
        const auth = await providerAuthStatus(instance.instanceId, flow.flowId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (auth.phase === "succeeded") {
          await settle();
          return;
        }
        if (auth.phase === "failed" || auth.phase === "cancelled") {
          fail("failed");
          return;
        }
        if (auth.phase === "expired") {
          fail("expired");
          return;
        }
        setFlow((current) => current && current.flowId === flow.flowId
          ? {
              ...current,
              code: auth.userCode ?? current.code,
              link: auth.authorizationUrl
                ? trustedLink(current.method, instance.driverKind, auth.authorizationUrl, auth.userCode) ?? current.link
                : current.link,
              expiresAt: auth.expiresAt ?? current.expiresAt,
            }
          : current);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (deviceFlowUnavailable(cause)) fail("failed");
      }
    };

    const timer = window.setInterval(() => void poll(), CONNECT_POLL_MS);
    return () => {
      window.clearInterval(timer);
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
      controller.abort();
    };
  }, [dispatch, fail, flow, instance, settle, status]);

  useEffect(() => {
    if (instance && engineReady(instance) && status !== "connected") {
      setFlow(null);
      setStatus("connected");
      setMessage(t("connectAI.connectedNow", { name }));
    }
  }, [instance, instance?.snapshot.authenticated, instance?.snapshot.state, name, status]);

  const submitCode = useCallback(async (value: string) => {
    if (!instance || !flow || flow.method !== "paste-code" || pending.current) return;
    const code = value.trim();
    if (!code) return;
    pending.current = true;
    setBusy(true);
    setMessage(t("connectAI.checkingCode"));
    try {
      await completeProviderAuth(instance.instanceId, flow.flowId, { code });
      await settle();
    } catch (cause) {
      if (deviceFlowUnavailable(cause)) fail("expired");
      else setMessage(t("connectAI.codeFailed"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [fail, flow, instance, settle]);

  const cancel = useCallback(async () => {
    if (flow && instance) {
      try { await cancelProviderAuth(instance.instanceId, flow.flowId); } catch {}
    }
    setFlow(null);
    setStatus("idle");
    setMessage("");
  }, [flow, instance]);

  return { status, message, flow, busy, connect, submitCode, cancel };
}
