import type { Env } from "./env";

/** The server's tunnel gateway (server/tunnel.ts): a loopback listener the server treats as "through a proxy". */
export const TUNNEL_ORIGIN = "http://127.0.0.1:8812";

export class CloudflareError extends Error {
  constructor(public readonly status: number, public readonly codes: number[]) {
    super(`cloudflare api ${status}${codes.length ? ` (${codes.join(",")})` : ""}`);
  }
}

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number }>;
}

async function call<T>(env: Env, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body?.success) throw new CloudflareError(response.status, (body?.errors ?? []).map((error) => error.code));
  return body.result;
}

const account = (env: Env) => `accounts/${env.CF_ACCOUNT_ID}`;
const zone = (env: Env) => `zones/${env.CF_ZONE_ID}`;

export function hostname(env: Env, name: string): string {
  return `${name}.${env.DOMAIN}`;
}

/** Any record already at that name (the zone's own sites, mail, verification records) keeps it out of reach. */
export async function dnsNameTaken(env: Env, name: string): Promise<boolean> {
  const records = await call<Array<{ id: string }>>(env, `${zone(env)}/dns_records?name=${encodeURIComponent(hostname(env, name))}&per_page=5`);
  return records.length > 0;
}

export interface Provisioned {
  tunnelId: string;
  dnsRecordId: string;
}

export async function provision(env: Env, installationId: string, name: string): Promise<Provisioned> {
  const host = hostname(env, name);
  const tunnel = await call<{ id: string }>(env, `${account(env)}/cfd_tunnel`, {
    method: "POST",
    body: { name: `nordus-${installationId}`, config_src: "cloudflare" },
  });
  try {
    await call(env, `${account(env)}/cfd_tunnel/${tunnel.id}/configurations`, {
      method: "PUT",
      body: { config: { ingress: [{ hostname: host, service: TUNNEL_ORIGIN }, { service: "http_status:404" }] } },
    });
    const record = await call<{ id: string }>(env, `${zone(env)}/dns_records`, {
      method: "POST",
      body: { type: "CNAME", name: host, content: `${tunnel.id}.cfargotunnel.com`, proxied: true, ttl: 1, comment: `nordus conta ${installationId}` },
    });
    return { tunnelId: tunnel.id, dnsRecordId: record.id };
  } catch (error) {
    await deleteTunnel(env, tunnel.id).catch(() => undefined);
    throw error;
  }
}

/** A remotely managed tunnel's connector token. */
export async function connectorToken(env: Env, tunnelId: string): Promise<string> {
  return call<string>(env, `${account(env)}/cfd_tunnel/${tunnelId}/token`);
}

export async function tunnelOnline(env: Env, tunnelId: string): Promise<boolean> {
  const tunnel = await call<{ status?: string }>(env, `${account(env)}/cfd_tunnel/${tunnelId}`);
  return tunnel.status === "healthy" || tunnel.status === "degraded";
}

async function ignoreMissing(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof CloudflareError && error.status === 404)) throw error;
  }
}

export async function deleteTunnel(env: Env, tunnelId: string): Promise<void> {
  await ignoreMissing(call(env, `${account(env)}/cfd_tunnel/${tunnelId}/connections`, { method: "DELETE" }));
  await ignoreMissing(call(env, `${account(env)}/cfd_tunnel/${tunnelId}`, { method: "DELETE" }));
}

export async function release(env: Env, provisioned: { tunnelId: string | null; dnsRecordId: string | null }): Promise<void> {
  if (provisioned.dnsRecordId) await ignoreMissing(call(env, `${zone(env)}/dns_records/${provisioned.dnsRecordId}`, { method: "DELETE" }));
  if (provisioned.tunnelId) await deleteTunnel(env, provisioned.tunnelId);
}
