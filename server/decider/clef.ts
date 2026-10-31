// CLEF (Cloudflare Workers AI, `@cf/cloudflare/clef`): the same typed questions as Jev (noul, choice, score), served
// through Cloudflare's REST API. The account id and token come only from the environment or from an env file whose
// path is configured; they are read when a call is made, never written to config, logs or error text.
import { readFileSync, statSync } from "node:fs";

import { jevRequestBody, parseJevResponse, questionsFit, refusal } from "./jev.ts";
import type { BackendRequest, BackendResult, DeciderBackend, DeciderQuestion } from "./types.ts";
import { isLoopback } from "../provider-key-check.ts";

export const CLEF_DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";
export const CLEF_MODELS = ["clef", "clef-flash"] as const;
export type ClefModel = (typeof CLEF_MODELS)[number];
export const CLEF_DEFAULT_MODEL: ClefModel = "clef";
/** CLEF answers over the network from Cloudflare's edge: a little more room than a local classifier. */
export const CLEF_DEFAULT_TIMEOUT_MS = 2_500;
export const CLEF_MAX_QUESTIONS = 64;
export const CLEF_ACCOUNT_ENV = "CLOUDFLARE_ACCOUNT_ID";
export const CLEF_TOKEN_ENV = "CLOUDFLARE_AI_TOKEN";
/** Where the env file is when config.json does not say. */
export const CLEF_ENV_FILE_ENV = "NORDUS_CLEF_ENV_FILE";

/** Cloudflare account ids are 32 hex characters. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;
const MAX_ENV_FILE_BYTES = 16 * 1024;

export interface ClefCredentials {
  accountId: string;
  token: string;
}

let cached: { path: string; mtimeMs: number; size: number; values: Record<string, string> } | null = null;

/** KEY=VALUE lines, `export` and quotes allowed; anything else is skipped. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[match[1]!] = value;
  }
  return values;
}

function envFileValues(path: string): Record<string, string> {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_ENV_FILE_BYTES) return {};
    if (cached && cached.path === path && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.values;
    const values = parseEnvFile(readFileSync(path, "utf8"));
    cached = { path, mtimeMs: stat.mtimeMs, size: stat.size, values };
    return values;
  } catch {
    return {};
  }
}

/** The environment first, then the env file (config's `clefEnvFile`, else $NORDUS_CLEF_ENV_FILE). Null when either is missing. */
export function clefCredentials(envFile?: string, env: NodeJS.ProcessEnv = process.env): ClefCredentials | null {
  let accountId = env[CLEF_ACCOUNT_ENV]?.trim();
  let token = env[CLEF_TOKEN_ENV]?.trim();
  const path = envFile?.trim() || env[CLEF_ENV_FILE_ENV]?.trim();
  if ((!accountId || !token) && path) {
    const values = envFileValues(path);
    accountId ||= values[CLEF_ACCOUNT_ENV]?.trim();
    token ||= values[CLEF_TOKEN_ENV]?.trim();
  }
  if (!accountId || !token || !ACCOUNT_ID.test(accountId)) return null;
  return { accountId, token };
}

export function clefModel(model?: string): ClefModel {
  return (CLEF_MODELS as readonly string[]).includes(model?.trim() ?? "") ? model!.trim() as ClefModel : CLEF_DEFAULT_MODEL;
}

/** Null when the token must not be sent there: https anywhere, plain http only to this machine. */
export function clefEndpoint(accountId: string, model: ClefModel = CLEF_DEFAULT_MODEL, baseUrl?: string | null): URL | null {
  if (!ACCOUNT_ID.test(accountId)) return null;
  const root = (baseUrl?.trim() || CLEF_DEFAULT_BASE_URL).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${root}/accounts/${accountId}/ai/run/@cf/cloudflare/${model}`);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  return url.protocol === "http:" && isLoopback(url.hostname) ? url : null;
}

export function clefRequestBody(state: unknown, questions: Record<string, DeciderQuestion>, model: ClefModel = CLEF_DEFAULT_MODEL) {
  return { ...jevRequestBody(state, questions), model };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Cloudflare's REST API wraps the model's answer as `{ result, success, errors }`; the binding returns it bare. */
export function unwrapClefBody(body: unknown): unknown {
  if (!isRecord(body)) return body;
  if (body.success === false) return null;
  return isRecord(body.result) && body.answers === undefined ? body.result : body;
}

async function decide(request: BackendRequest): Promise<BackendResult> {
  // `key` carries the token and `baseUrl` the whole endpoint, account id included (deciderAccount builds it).
  let endpoint: URL;
  try {
    endpoint = new URL(request.baseUrl ?? "");
  } catch {
    return { ok: false, reason: "misconfigured" };
  }
  const local = endpoint.protocol === "http:" && isLoopback(endpoint.hostname);
  if ((endpoint.protocol !== "https:" && !local) || endpoint.username || endpoint.password) return { ok: false, reason: "misconfigured" };
  if (!questionsFit(request.questions) || Object.keys(request.questions).length > CLEF_MAX_QUESTIONS) return { ok: false, reason: "misconfigured" };
  let response: Response;
  try {
    response = await request.fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${request.key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(clefRequestBody(request.state, request.questions, clefModel(request.model))),
      signal: request.signal,
      // Never replay the token to wherever a redirect points.
      redirect: "error",
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return refusal(response.status);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const parsed = parseJevResponse(unwrapClefBody(body), request.questions);
  return parsed.ok ? parsed : { ok: false, reason: "malformed" };
}

export const clefBackend: DeciderBackend = { id: "clef", decide };
