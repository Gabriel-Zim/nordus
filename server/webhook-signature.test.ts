import { createHmac } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listenWebhookIngress, type WebhookIngress } from "./webhook-ingress.ts";
import { WebhookManager } from "./webhooks.ts";

const SIGNING_SECRET = "test-signing-secret-0123456789abcdef";
const OTHER_SECRET = "another-signing-secret-0123456789abc";
const NOW_SECONDS = 1_760_100_000;

let dir: string;
let clock: number;
let manager: WebhookManager;
let ingress: WebhookIngress;
let queued: Array<{ prompt: string; deliveryId: string }>;

function sign(secret: string, body: string, t: number): string {
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
}

function zimEvent(tipo = "mensagem.nova", id = crypto.randomUUID()) {
  return { id, body: JSON.stringify({ id, tipo, conversa: { id: "c-1", numero: 42 }, mensagem: { texto: "Olá" } }) };
}

async function deliver(
  webhook: { endpointId: string; secret: string },
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${ingress.baseUrl}/hooks/${webhook.endpointId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${webhook.secret}`, "content-type": "application/json", ...headers },
    body,
  });
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

async function signedDelivery(
  webhook: { endpointId: string; secret: string },
  event = zimEvent(),
  options: { secret?: string; t?: number } = {},
) {
  const t = options.t ?? Math.floor(clock / 1000);
  return deliver(webhook, event.body, {
    "x-zim-event": JSON.parse(event.body).tipo,
    "x-zim-delivery": event.id,
    "x-zim-signature": `t=${t},v1=${sign(options.secret ?? SIGNING_SECRET, event.body, t)}`,
  });
}

function createSigned(extra: Record<string, unknown> = {}) {
  const created = manager.create({
    name: "Suporte",
    prompt: "Atenda a conversa",
    botId: "nordus-1",
    signature: { scheme: "zim-v1", secret: SIGNING_SECRET },
    ...extra,
  });
  return { id: created.webhook.id, endpointId: created.webhook.endpointId, secret: created.secret };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "nordus-webhook-signature-"));
  clock = NOW_SECONDS * 1000;
  queued = [];
  manager = new WebhookManager({
    file: join(dir, "webhooks.json"),
    now: () => clock,
    botState: () => "ready",
    enqueue: (input) => {
      queued.push(input);
      return { id: `run-${queued.length}` };
    },
  });
  ingress = await listenWebhookIngress(manager, { port: 0 });
});

afterEach(async () => {
  await new Promise<void>((resolve) => ingress.server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("zim-v1 webhook signatures", () => {
  it("accepts a correctly signed delivery and reads the event and delivery id from the X-Zim headers", async () => {
    const webhook = createSigned();
    const event = zimEvent("conversa.aberta");
    const result = await signedDelivery(webhook, event);
    expect(result).toMatchObject({ status: 202, json: { accepted: true, deliveryId: event.id, duplicate: false } });
    expect(queued).toHaveLength(1);
    expect(queued[0]!.prompt).toContain("Event: conversa.aberta");
    expect(queued[0]!.deliveryId).toBe(event.id);
  });

  const t = NOW_SECONDS;
  const event = zimEvent();
  it.each([
    ["a wrong secret", { "x-zim-signature": `t=${t},v1=${sign(OTHER_SECRET, event.body, t)}` }, event.body, "Signature does not match"],
    ["an altered body", { "x-zim-signature": `t=${t},v1=${sign(SIGNING_SECRET, event.body, t)}` }, event.body.replace("Olá", "Oi"), "Signature does not match"],
    ["a timestamp older than 300 s", { "x-zim-signature": `t=${t - 301},v1=${sign(SIGNING_SECRET, event.body, t - 301)}` }, event.body, "300 s"],
    ["a timestamp more than 300 s ahead", { "x-zim-signature": `t=${t + 301},v1=${sign(SIGNING_SECRET, event.body, t + 301)}` }, event.body, "300 s"],
    ["no signature header", {}, event.body, "Missing X-Zim-Signature header"],
    ["a header without t", { "x-zim-signature": `v1=${sign(SIGNING_SECRET, event.body, t)}` }, event.body, "Malformed"],
    ["a header without v1", { "x-zim-signature": `t=${t}` }, event.body, "Malformed"],
    ["a non-hex v1", { "x-zim-signature": `t=${t},v1=not-a-signature` }, event.body, "Malformed"],
    ["garbage", { "x-zim-signature": "sha256=abc" }, event.body, "Malformed"],
  ])("rejects %s with 401 and records why", async (_label, headers, body, reason) => {
    const webhook = createSigned();
    const result = await deliver(webhook, body, { "x-zim-delivery": event.id, ...headers });
    expect(result.status).toBe(401);
    expect(result.json).toEqual({ error: "Invalid webhook signature" });
    expect(queued).toHaveLength(0);
    const attempt = manager.listAttempts().at(-1)!;
    expect(attempt).toMatchObject({ webhookId: webhook.id, outcome: "rejected", statusCode: 401, deliveryId: event.id });
    expect(attempt.reason).toContain(reason);
    expect(JSON.stringify(manager.listAttempts())).not.toContain(SIGNING_SECRET);
  });

  it("accepts the delivery when any of several v1 values matches, in any case and spacing", async () => {
    const webhook = createSigned();
    const event = zimEvent();
    const result = await deliver(webhook, event.body, {
      "x-zim-signature": `t=${NOW_SECONDS}, v1=${sign(OTHER_SECRET, event.body, NOW_SECONDS)}, v1=${sign(SIGNING_SECRET, event.body, NOW_SECONDS).toUpperCase()}`,
    });
    expect(result.status).toBe(202);
    expect(queued).toHaveLength(1);
  });

  it("rejects every delivery while the scheme is set but its secret file is gone", async () => {
    const webhook = createSigned();
    unlinkSync(join(dir, "webhook-signing", `${webhook.id}.key`));
    expect(manager.list()[0]!.signature).toMatchObject({ scheme: "zim-v1", configured: false });
    const result = await signedDelivery(webhook);
    expect(result.status).toBe(401);
    expect(manager.listAttempts().at(-1)!.reason).toContain("not configured");
    expect(queued).toHaveLength(0);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("rejects with 401, not 500, when the secret file cannot be read", async () => {
    const webhook = createSigned();
    const keyFile = join(dir, "webhook-signing", `${webhook.id}.key`);
    chmodSync(keyFile, 0o000);
    try {
      expect(manager.list()[0]!.signature).toMatchObject({ configured: false });
      const result = await signedDelivery(webhook);
      expect(result).toEqual({ status: 401, json: { error: "Invalid webhook signature" } });
      expect(manager.listAttempts().at(-1)!.reason).toContain("could not be read");
      expect(JSON.stringify(manager.listAttempts())).not.toContain(dir);
    } finally {
      chmodSync(keyFile, 0o600);
    }
  });

  it("treats an empty secret file as missing", () => {
    const webhook = createSigned();
    writeFileSync(join(dir, "webhook-signing", `${webhook.id}.key`), "");
    expect(manager.list()[0]!.signature).toMatchObject({ configured: false });
  });

  it("refuses the exact same signed request a second time, whatever its unsigned headers say", async () => {
    const webhook = createSigned();
    const event = zimEvent();
    const headers = {
      "x-zim-event": "mensagem.nova",
      "x-zim-delivery": event.id,
      "x-zim-signature": `t=${NOW_SECONDS},v1=${sign(SIGNING_SECRET, event.body, NOW_SECONDS)}`,
    };
    expect((await deliver(webhook, event.body, headers)).status).toBe(202);
    const replay = await deliver(webhook, event.body, { ...headers, "idempotency-key": "another-id", "x-zim-event": "conversa.escalada" });
    expect(replay.status).toBe(401);
    expect(manager.listAttempts().at(-1)!.reason).toContain("already used");
    expect(queued).toHaveLength(1);
  });

  it("keeps repeated signature failures in one rolling attempt", async () => {
    const webhook = createSigned();
    for (let index = 0; index < 5; index += 1) await deliver(webhook, "{}", {});
    const rejected = manager.listAttempts().filter((attempt) => attempt.outcome === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe("Missing X-Zim-Signature header (5 requests)");
  });

  it("leaves webhooks without a signature setting as they were", async () => {
    const created = manager.create({ name: "Plain", prompt: "", botId: "nordus-1" });
    expect(created.webhook.signature).toBeUndefined();
    const result = await deliver({ endpointId: created.webhook.endpointId, secret: created.secret }, "{}", {});
    expect(result.status).toBe(202);
    expect(queued).toHaveLength(1);
  });

  it("checks the signature in capture mode too", async () => {
    const webhook = createSigned({ enabled: false, verificationPending: true });
    const bad = await signedDelivery(webhook, zimEvent(), { secret: OTHER_SECRET });
    expect(bad.status).toBe(401);
    expect(manager.list()[0]).toMatchObject({ verificationPending: true });
    expect(manager.list()[0]!.verificationSample).toBeUndefined();

    const good = await signedDelivery(webhook, zimEvent("conversa.escalada"));
    expect(good).toMatchObject({ status: 202, json: { captured: true } });
    expect(manager.list()[0]).toMatchObject({ verificationPending: false, verificationSample: { eventName: "conversa.escalada" } });
    expect(queued).toHaveLength(0);
  });

  it("runs a delivery repeated with the same X-Zim-Delivery only once", async () => {
    const webhook = createSigned();
    const event = zimEvent();
    const first = await signedDelivery(webhook, event);
    clock += 1_000;
    const again = await signedDelivery(webhook, event);
    expect(first.json).toMatchObject({ duplicate: false, runId: "run-1" });
    expect(again).toMatchObject({ status: 202, json: { duplicate: true, runId: "run-1" } });
    expect(queued).toHaveLength(1);
  });

  it("filters on X-Zim-Event with eventTypes", async () => {
    const webhook = createSigned({ eventTypes: ["mensagem.nova"] });
    const skipped = await signedDelivery(webhook, zimEvent("conversa.aberta"));
    const kept = await signedDelivery(webhook, zimEvent("mensagem.nova"));
    expect(skipped.json).toMatchObject({ ignored: true });
    expect(kept.json).toMatchObject({ runId: "run-1" });
    expect(queued).toHaveLength(1);
  });
});

describe("webhook rate per minute", () => {
  async function burst(webhook: { endpointId: string; secret: string }, count: number) {
    const statuses: number[] = [];
    for (let index = 0; index < count; index += 1) statuses.push((await deliver(webhook, "{}", {})).status);
    return statuses;
  }

  it("keeps the default of 10 per minute when maxPerMinute is absent", async () => {
    const created = manager.create({ name: "Plain", prompt: "", botId: "nordus-1" });
    const statuses = await burst({ endpointId: created.webhook.endpointId, secret: created.secret }, 11);
    expect(statuses.filter((status) => status === 202)).toHaveLength(10);
    expect(statuses.at(-1)).toBe(429);
  });

  it("uses each webhook's maxPerMinute and frees the slot after a minute", async () => {
    const created = manager.create({ name: "Fast", prompt: "", botId: "nordus-1", maxPerMinute: 2 });
    const webhook = { endpointId: created.webhook.endpointId, secret: created.secret };
    expect(await burst(webhook, 3)).toEqual([202, 202, 429]);
    clock += 60_000;
    expect(await burst(webhook, 1)).toEqual([202]);
    const raised = manager.update(created.webhook.id, { maxPerMinute: 120 })!;
    expect(raised.maxPerMinute).toBe(120);
    expect(manager.update(created.webhook.id, { maxPerMinute: null })!.maxPerMinute).toBeUndefined();
    expect(() => manager.update(created.webhook.id, { maxPerMinute: 121 })).toThrow();
    expect(() => manager.update(created.webhook.id, { maxPerMinute: 0 })).toThrow();
  });
});

describe("signing secret storage", () => {
  it("never returns the secret and keeps it in a 0600 file outside webhooks.json", () => {
    const created = manager.create({ name: "Suporte", prompt: "", botId: "nordus-1", signature: { scheme: "zim-v1", secret: SIGNING_SECRET } });
    const keyFile = join(dir, "webhook-signing", `${created.webhook.id}.key`);
    expect(created.webhook.signature).toEqual({ scheme: "zim-v1", configured: true, updatedAt: clock });
    expect(JSON.stringify(created)).not.toContain(SIGNING_SECRET);
    expect(JSON.stringify(manager.list())).not.toContain(SIGNING_SECRET);
    expect(readFileSync(join(dir, "webhooks.json"), "utf8")).not.toContain(SIGNING_SECRET);
    expect(readFileSync(keyFile, "utf8")).toBe(SIGNING_SECRET);
    if (process.platform !== "win32") {
      expect(statSync(keyFile).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "webhook-signing")).mode & 0o777).toBe(0o700);
    }

    clock += 5_000;
    const rotated = manager.update(created.webhook.id, { signature: { scheme: "zim-v1", secret: OTHER_SECRET } })!;
    expect(JSON.stringify(rotated)).not.toContain(OTHER_SECRET);
    expect(rotated.signature!.updatedAt).toBe(clock);
    expect(readFileSync(keyFile, "utf8")).toBe(OTHER_SECRET);

    expect(manager.update(created.webhook.id, { signature: null })!.signature).toBeUndefined();
    expect(() => statSync(keyFile)).toThrow();
  });

  it("refuses secrets outside 32 to 256 characters and unknown schemes", () => {
    const base = { name: "Suporte", prompt: "", botId: "nordus-1" };
    expect(() => manager.create({ ...base, signature: { scheme: "zim-v1", secret: "short" } })).toThrow(/32/);
    expect(() => manager.create({ ...base, signature: { scheme: "zim-v1", secret: "x".repeat(257) } })).toThrow(/256/);
    expect(() => manager.create({ ...base, signature: { scheme: "zim-v1", secret: `${SIGNING_SECRET}\n` } })).toThrow(/line breaks/);
    expect(() => manager.create({ ...base, signature: { scheme: "svix", secret: SIGNING_SECRET } })).toThrow();
    expect(manager.list()).toHaveLength(0);
  });

  it("deletes the secret file with the webhook and keeps the scheme across a restart", () => {
    const created = manager.create({ name: "Suporte", prompt: "", botId: "nordus-1", signature: { scheme: "zim-v1", secret: SIGNING_SECRET } });
    const reloaded = new WebhookManager({ file: join(dir, "webhooks.json"), botState: () => "ready", enqueue: () => ({ id: "run" }) });
    expect(reloaded.list()[0]!.signature).toMatchObject({ scheme: "zim-v1", configured: true });
    expect(manager.remove(created.webhook.id)).toBe(true);
    expect(() => statSync(join(dir, "webhook-signing", `${created.webhook.id}.key`))).toThrow();
  });

  it("brings the signing secret back with the webhook when the deletion is undone, and never writes it in clear", () => {
    const created = manager.create({ name: "Suporte", prompt: "", botId: "nordus-1", signature: { scheme: "zim-v1", secret: SIGNING_SECRET } });
    expect(manager.remove(created.webhook.id)).toBe(true);
    expect(readFileSync(join(dir, "webhooks.json"), "utf8")).not.toContain(SIGNING_SECRET);
    const restored = manager.restore(created.webhook.id)!;
    expect(restored.signature).toMatchObject({ scheme: "zim-v1", configured: true });
    expect(readFileSync(join(dir, "webhook-signing", `${created.webhook.id}.key`), "utf8")).toBe(SIGNING_SECRET);
  });
});
