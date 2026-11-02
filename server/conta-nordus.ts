// `nordus login`: links this machine to a Nordus account at conta.nordus.ai. The account gives it a public
// address (name.nordus.ai, served through a Cloudflare tunnel) and runs the Google sign-in for it, so nobody has to
// create a Google client, a domain or open a port.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { ControlPlaneError, createControlPlaneClient } from "../electron/control-plane-client.mjs";
import { writeFileAtomic } from "./atomic.ts";

export const CONTA_ORIGIN_DEFAULT = "https://conta.nordus.ai";
export const CONTA_FILE = "conta-nordus.json";
/** The installation credential's prefix, as the control plane client checks it. */
export const CREDENTIAL_PREFIX = "nordus_install_";

const linkSchema = z.object({
  installationId: z.string().uuid(),
  credential: z.string().regex(/^[a-z_]+install_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/),
  address: z.string().url().startsWith("https://"),
  email: z.string().email().nullable(),
  controlPlane: z.string().url().startsWith("https://"),
});
export type ContaLink = z.infer<typeof linkSchema>;

/** NORDUS_CONTA_URL points tests and staging at another control plane; https only, or loopback http. */
export function contaOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NORDUS_CONTA_URL?.trim();
  if (!raw) return CONTA_ORIGIN_DEFAULT;
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("NORDUS_CONTA_URL must be an https address");
  return url.origin;
}

export function readContaLink(dataDir: string): ContaLink | null {
  const file = join(dataDir, CONTA_FILE);
  if (!existsSync(file)) return null;
  if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
  const parsed = linkSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`${file} is not a valid Nordus account link; remove it and run login again`);
  return parsed.data;
}

export function saveContaLink(dataDir: string, link: ContaLink): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileAtomic(join(dataDir, CONTA_FILE), `${JSON.stringify(linkSchema.parse(link), null, 2)}\n`, { mode: 0o600 });
}

export function removeContaLink(dataDir: string): void {
  rmSync(join(dataDir, CONTA_FILE), { force: true });
}

export class ActivationExpired extends Error {
  constructor() {
    super("the code expired before it was confirmed");
  }
}

export interface Activation {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

const activationSchema = z.object({
  deviceCode: z.string().min(20).max(100),
  userCode: z.string().regex(/^[A-Z]{4}-[A-Z]{4}$/),
  verificationUrl: z.string().url(),
  intervalSeconds: z.number().int().min(1).max(60),
  expiresInSeconds: z.number().int().min(30).max(3600),
});

async function post(origin: string, path: string, body: unknown, fetchImpl: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetchImpl(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const parsed: unknown = await response.json().catch(() => null);
  return { status: response.status, body: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {} };
}

export async function startActivation(input: { origin: string; machine: string; platform: string; appVersion: string; fetchImpl?: typeof fetch }): Promise<Activation> {
  const { status, body } = await post(input.origin, "/v1/ativacoes", {
    machine: input.machine.slice(0, 64),
    platform: input.platform,
    appVersion: input.appVersion,
    credentialPrefix: CREDENTIAL_PREFIX,
  }, input.fetchImpl ?? fetch);
  if (status === 429) throw new Error("too many sign-in attempts from this network; wait a few minutes and try again");
  const parsed = activationSchema.safeParse(body);
  if (status !== 200 || !parsed.success) throw new Error(`${input.origin} did not start the sign-in (${status})`);
  if (new URL(parsed.data.verificationUrl).origin !== input.origin) throw new Error(`${input.origin} answered with a link to another site`);
  return parsed.data;
}

/** Waits until the person confirms in the browser, then returns the link. Throws when the code expires. */
export async function waitForActivation(input: {
  origin: string;
  activation: Activation;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<ContaLink> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = input.now ?? Date.now;
  const deadline = now() + input.activation.expiresInSeconds * 1000;
  let failures = 0;
  while (now() < deadline) {
    await sleep(input.activation.intervalSeconds * 1000);
    let answer: { status: number; body: Record<string, unknown> };
    try {
      answer = await post(input.origin, "/v1/ativacoes/verificar", { deviceCode: input.activation.deviceCode }, input.fetchImpl ?? fetch);
      failures = 0;
    } catch (error) {
      if (++failures >= 10) throw error;
      continue;
    }
    if (answer.status === 428) continue;
    if (answer.status === 410) throw new ActivationExpired();
    const link = linkSchema.safeParse({ ...answer.body, controlPlane: input.origin });
    if (answer.status !== 200 || !link.success) throw new Error(`${input.origin} answered ${answer.status} while waiting for the confirmation`);
    return link.data;
  }
  throw new ActivationExpired();
}

/** Runs the whole confirmation: a code, then a new one each time one expires, up to `codes` of them. */
export async function connectAccount(input: {
  origin: string;
  machine: string;
  platform: string;
  appVersion: string;
  codes?: number;
  onCode: (activation: Activation, attempt: number) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ContaLink> {
  const codes = input.codes ?? 4;
  for (let attempt = 1; ; attempt++) {
    const activation = await startActivation({ origin: input.origin, machine: input.machine, platform: input.platform, appVersion: input.appVersion, fetchImpl: input.fetchImpl });
    input.onCode(activation, attempt);
    try {
      return await waitForActivation({ origin: input.origin, activation, fetchImpl: input.fetchImpl, sleep: input.sleep });
    } catch (error) {
      if (!(error instanceof ActivationExpired) || attempt >= codes) throw error;
    }
  }
}

/** The tunnel address and connector token for this machine's link. */
export async function contaTunnelAccess(link: ContaLink, options: { version?: string; fetchImpl?: typeof fetch } = {}): Promise<{ endpoint: string; token: string }> {
  const client = createControlPlaneClient({ baseURL: link.controlPlane, fetchImpl: options.fetchImpl });
  try {
    const { endpoint, connectorToken } = await client.ensureEndpoint(link.credential, { appVersion: options.version });
    return { endpoint: endpoint.url, token: connectorToken };
  } catch (error) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      throw new Error(`${link.controlPlane} no longer recognises this machine (it was removed or connected again elsewhere); run login again`);
    }
    const reference = error instanceof ControlPlaneError && error.requestId ? ` (reference ${error.requestId})` : "";
    throw new Error(`could not get this machine's public address from ${link.controlPlane}: ${error instanceof Error ? error.message : String(error)}${reference}`);
  }
}

export async function releaseContaAddress(link: ContaLink, fetchImpl?: typeof fetch): Promise<void> {
  await createControlPlaneClient({ baseURL: link.controlPlane, fetchImpl }).deleteEndpoint(link.credential);
}
