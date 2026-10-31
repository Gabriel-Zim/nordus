import { api, ApiError } from "@/state/store";

export interface ProviderAuthStatus {
  phase: "waiting" | "succeeded" | "failed" | "expired" | "cancelled";
  flowId: string | null;
  authorizationUrl: string | null;
  userCode?: string;
  expiresAt: string | null;
  message?: string;
}

const base = (instanceId: string) => `/api/instances/${encodeURIComponent(instanceId)}/auth`;

export function deviceFlowUnavailable(cause: unknown): boolean {
  return cause instanceof ApiError && [401, 403, 404, 410].includes(cause.status);
}

export function startProviderAuth(instanceId: string): Promise<ProviderAuthStatus> {
  return api<{ auth: ProviderAuthStatus }>(`${base(instanceId)}/start`, { method: "POST" }).then((body) => body.auth);
}

export function providerAuthStatus(instanceId: string, flowId: string, init?: RequestInit): Promise<ProviderAuthStatus> {
  return api<{ auth: ProviderAuthStatus }>(`${base(instanceId)}/status?flowId=${encodeURIComponent(flowId)}`, init)
    .then((body) => body.auth);
}

export function completeProviderAuth(
  instanceId: string,
  flowId: string,
  input: { code?: string; callbackUrl?: string },
): Promise<unknown> {
  return api(`${base(instanceId)}/complete`, { method: "POST", body: JSON.stringify({ flowId, ...input }) });
}

export function cancelProviderAuth(instanceId: string, flowId: string): Promise<unknown> {
  return api(`${base(instanceId)}/cancel`, { method: "POST", body: JSON.stringify({ flowId }) });
}
