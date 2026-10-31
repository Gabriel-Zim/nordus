import { createHmac, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { WebhookSignatureScheme } from "../shared/webhooks.ts";
import { writeFileAtomic } from "./atomic.ts";

export interface SignedDelivery {
  rawBody: Buffer;
  header: (name: string) => string | undefined;
  nowSeconds: number;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };
/** `replayKey` names the exact signature that matched, so the caller can refuse it a second time. */
export type VerifiedSignature = { ok: true; replayKey: string } | { ok: false; reason: string };

type SignatureVerifier = (secret: string, delivery: SignedDelivery) => VerifiedSignature;

export const SIGNATURE_REPLAY_WINDOW_MS = 2 * 300 * 1000;

const ZIM_TOLERANCE_SECONDS = 300;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** zim.studio support webhook: `X-Zim-Signature: t=<unix s>,v1=<hex>`, v1 = HMAC-SHA256(secret, `${t}.${raw body}`).
 * Several v1 values may arrive while the sender rotates its secret. */
function verifyZimV1(secret: string, { rawBody, header, nowSeconds }: SignedDelivery): VerifiedSignature {
  const value = header("x-zim-signature");
  if (!value) return { ok: false, reason: "Missing X-Zim-Signature header" };
  let timestamp: string | undefined;
  const candidates: Buffer[] = [];
  for (const part of value.split(",")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    const key = part.slice(0, at).trim();
    const field = part.slice(at + 1).trim().toLowerCase();
    if (key === "t" && /^\d{1,12}$/.test(field)) timestamp = field;
    else if (key === "v1" && HEX_SHA256.test(field)) candidates.push(Buffer.from(field, "hex"));
  }
  if (!timestamp || candidates.length === 0) return { ok: false, reason: "Malformed X-Zim-Signature header" };
  if (Math.abs(nowSeconds - Number(timestamp)) > ZIM_TOLERANCE_SECONDS) {
    return { ok: false, reason: `Signature timestamp is more than ${ZIM_TOLERANCE_SECONDS} s from this server's clock` };
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  let matched = false;
  for (const candidate of candidates) matched = timingSafeEqual(candidate, expected) || matched;
  return matched ? { ok: true, replayKey: `${timestamp}.${expected.toString("hex")}` } : { ok: false, reason: "Signature does not match" };
}

const VERIFIERS = { "zim-v1": verifyZimV1 } satisfies Record<WebhookSignatureScheme, SignatureVerifier>;

export function verifyWebhookSignature(scheme: WebhookSignatureScheme, secret: string | undefined, delivery: SignedDelivery): VerifiedSignature {
  if (!secret) return { ok: false, reason: "Signing secret is not configured on this server" };
  return VERIFIERS[scheme](secret, delivery);
}

/** Signing secrets must stay recoverable to recompute the HMAC, so they live outside webhooks.json, one 0600 file per webhook. */
export class WebhookSigningKeys {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Throws when the file exists but cannot be read (for example owned by another user). */
  read(webhookId: string): string | undefined {
    try {
      return readFileSync(this.path(webhookId), "utf8") || undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  readable(webhookId: string): boolean {
    try {
      return this.read(webhookId) !== undefined;
    } catch {
      return false;
    }
  }

  write(webhookId: string, secret: string): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    writeFileAtomic(this.path(webhookId), secret, { mode: 0o600 });
  }

  remove(webhookId: string): void {
    rmSync(this.path(webhookId), { force: true });
  }

  private path(webhookId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(webhookId)) throw new Error("Invalid webhook id");
    return join(this.dir, `${webhookId}.key`);
  }
}
