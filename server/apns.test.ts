import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http2";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Notification } from "../shared/notification.ts";
import { apnsPayload, apnsProviderToken, createApns, createApnsRoutes, http2Send, loadApnsConfig, type ApnsRequest } from "./apns.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { PushSubscriptions } from "./web-push.ts";

let dataDir: string;
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "nordus-apns-")); });
afterEach(async () => { await removeTempDir(dataDir); });

const TOKEN = "a".repeat(64);
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
function configure(extra: Record<string, unknown> = {}) {
  writeFileSync(join(dataDir, "AuthKey_ABC123DEFG.p8"), privateKey.export({ format: "pem", type: "pkcs8" }));
  writeFileSync(join(dataDir, "apns.json"), JSON.stringify({ keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: "ai.nordus.app", keyPath: "AuthKey_ABC123DEFG.p8", ...extra }));
}
const note = (extra: Partial<Notification> = {}): Notification => ({
  kind: "approval", botId: "bot-1", botName: "Ana", threadId: "thread-1", title: "Ana precisa de você", body: "Aprovar o envio?", ...extra,
});
const everyone = { sees: () => true };

describe("config", () => {
  it("is off without apns.json, with a broken one, or with a missing key", () => {
    expect(loadApnsConfig(dataDir)).toBeNull();
    writeFileSync(join(dataDir, "apns.json"), "{");
    expect(loadApnsConfig(dataDir)).toBeNull();
    writeFileSync(join(dataDir, "apns.json"), JSON.stringify({ keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: "ai.nordus.app", keyPath: "nope.p8" }));
    expect(loadApnsConfig(dataDir)).toBeNull();
    configure();
    expect(loadApnsConfig(dataDir)).toMatchObject({ keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: "ai.nordus.app" });
  });

  it("signs the provider token with the .p8 key, key id in the header and team as issuer", () => {
    configure();
    const jwt = apnsProviderToken(loadApnsConfig(dataDir)!, 1_700_000_000_000);
    const [head, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(head!, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: createPublicKey(publicKey.export({ format: "pem", type: "spki" })), dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url"))).toBe(true);
  });
});

describe("sending", () => {
  function setup(status = 200, reason?: string) {
    const sent: ApnsRequest[] = [];
    const apns = createApns({ dataDir, unread: () => 3, send: async (request) => { sent.push(request); return { status, ...(reason ? { reason } : {}) }; } });
    return { apns, sent, presence: new PushSubscriptions(dataDir) };
  }

  it("sends nothing and fails nothing while APNs is not set up", async () => {
    const { apns, sent, presence } = setup();
    apns.devices.save("phone", { token: TOKEN, ambiente: "producao", finished: true, sounds: true });
    expect(apns.enabled()).toBe(false);
    expect(await apns.dispatch(note(), everyone, presence)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("posts an alert to the device's environment with the badge and the conversation to open", async () => {
    configure();
    const { apns, sent, presence } = setup();
    apns.devices.save("phone", { token: TOKEN.toUpperCase(), ambiente: "sandbox", finished: true, sounds: true });
    expect(await apns.dispatch(note(), everyone, presence)).toEqual([200]);
    expect(sent[0]).toMatchObject({
      origin: "https://api.sandbox.push.apple.com",
      path: `/3/device/${TOKEN}`,
      headers: expect.objectContaining({ "apns-topic": "ai.nordus.app", "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": "nordus:bot-1" }),
    });
    expect(sent[0]!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(sent[0]!.body)).toEqual({
      aps: { alert: { title: "Ana precisa de você", body: "Aprovar o envio?" }, badge: 3, sound: "default", "thread-id": "nordus:bot-1" },
      botId: "bot-1", threadId: "thread-1", kind: "approval",
    });
  });

  it("carries the card's request so a tap lands on it", () => {
    expect(apnsPayload(note({ requestId: "req-7" }), { sounds: true }, 1)).toMatchObject({ threadId: "thread-1", requestId: "req-7" });
    expect(apnsPayload(note({ kind: "done" }), { sounds: true }, 1)).not.toHaveProperty("requestId");
  });

  it("follows the same rules as Web Push: switches, audience and an open page", async () => {
    configure();
    const { apns, sent, presence } = setup();
    apns.devices.save("phone", { token: TOKEN, ambiente: "producao", finished: false, sounds: false });
    await apns.dispatch(note({ kind: "done" }), everyone, presence);
    await apns.dispatch(note({ priority: "normal" }), everyone, presence);
    await apns.dispatch(note(), { sees: () => false }, presence);
    presence.notePresence("phone", "page-aaaaaaaa", true);
    await apns.dispatch(note(), everyone, presence);
    expect(sent).toEqual([]);
    presence.notePresence("phone", "page-aaaaaaaa", false);
    await apns.dispatch(note(), everyone, presence);
    expect(JSON.parse(sent[0]!.body).aps.sound).toBeUndefined();
  });

  it("forgets a token Apple says is gone, and keeps the device file private", async () => {
    configure();
    const { apns, presence } = setup(410, "Unregistered");
    apns.devices.save("phone", { token: TOKEN, ambiente: "producao", finished: true, sounds: true });
    expect(statSync(join(dataDir, "apns-devices.json")).mode & 0o777).toBe(0o600);
    expect(await apns.dispatch(note(), everyone, presence)).toEqual([410]);
    expect(apns.devices.list()).toEqual([]);
  });

  it("speaks HTTP/2 to the push service", async () => {
    const seen: Array<{ headers: Record<string, unknown>; body: string }> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk; });
      req.on("end", () => {
        seen.push({ headers: req.headers, body });
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ reason: "BadDeviceToken" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const out = await http2Send()({ origin: `http://127.0.0.1:${port}`, path: `/3/device/${TOKEN}`, headers: { "apns-topic": "ai.nordus.app" }, body: "{\"aps\":{}}" });
      expect(out).toEqual({ status: 400, reason: "BadDeviceToken" });
      expect(seen[0]).toMatchObject({ headers: { ":method": "POST", ":path": `/3/device/${TOKEN}`, "apns-topic": "ai.nordus.app" }, body: "{\"aps\":{}}" });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

it("registers and removes a device's token by its session, never from a bot's shell", async () => {
  const apns = createApns({ dataDir, unread: () => 0, send: async () => ({ status: 200 }) });
  const call = async (method: string, auth: unknown, body: unknown) => {
    const answer: { status?: number; value?: any } = {};
    const out = await createApnsRoutes(apns)({
      req: {} as RouteContext["req"], res: { setHeader() {} } as unknown as RouteContext["res"], url: new URL("http://x/api/push/apns"), path: "/api/push/apns", method,
      auth: auth as RouteContext["auth"],
      json: ((_res: unknown, status: number, value: unknown) => { answer.status = status; answer.value = value; }) as RouteContext["json"],
      readBody: (async () => body) as RouteContext["readBody"],
    });
    return out === PASS ? "pass" : answer;
  };
  const phone = { kind: "session", session: { id: "session-phone" }, via: "cookie", scopes: ["client"] };
  expect(await call("POST", phone, { token: TOKEN, ambiente: "producao" })).toEqual({ status: 200, value: { ok: true, enabled: false } });
  expect(apns.devices.list()).toMatchObject([{ owner: "session-phone", token: TOKEN, ambiente: "producao", finished: true, sounds: true }]);
  expect((await call("POST", phone, { token: "xyz", ambiente: "producao" }) as any).status).toBe(400);
  expect((await call("POST", phone, { token: TOKEN, ambiente: "prod" }) as any).status).toBe(400);
  expect((await call("POST", { kind: "loopback", scopes: ["client"], trust: "service" }, { token: TOKEN, ambiente: "producao" }) as any).status).toBe(403);
  expect(await call("DELETE", phone, { token: TOKEN })).toEqual({ status: 200, value: { ok: true, removed: true } });
});
