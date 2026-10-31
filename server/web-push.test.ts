import { createECDH, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Notification } from "../shared/notification.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { decryptPush as decrypt } from "./testing/web-push-receiver.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import {
  createWebPush, createWebPushRoutes, encryptPushPayload, loadVapidKeys, PRESENCE_TTL_MS, pushEndpointAllowed, pushPayload, PushSubscriptions, pushTargets, subscriptionInput, vapidAuthorization,
  type PushFetch,
} from "./web-push.ts";

let dataDir: string;
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "nordus-web-push-")); });
afterEach(async () => { await removeTempDir(dataDir); });

const b = (value: string) => Buffer.from(value, "base64url");

describe("RFC 8291 encryption", () => {
  // Appendix A of RFC 8291.
  const rfc = {
    plaintext: "When I grow up, I want to be a watermelon",
    senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    receiverPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    receiverPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    expected: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  };

  it("matches the RFC's worked example byte for byte", () => {
    const out = encryptPushPayload(Buffer.from(rfc.plaintext), rfc.receiverPublic, rfc.auth, { senderPrivateKey: b(rfc.senderPrivate), salt: b(rfc.salt) });
    expect(out.toString("base64url")).toBe(rfc.expected);
  });

  it("round-trips with a fresh sender key and salt each time", () => {
    const one = encryptPushPayload(Buffer.from("olá"), rfc.receiverPublic, rfc.auth);
    const two = encryptPushPayload(Buffer.from("olá"), rfc.receiverPublic, rfc.auth);
    expect(one.equals(two)).toBe(false);
    expect(decrypt(one, b(rfc.receiverPrivate), b(rfc.auth))).toBe("olá");
  });

  it("refuses keys that are not a browser's", () => {
    expect(() => encryptPushPayload(Buffer.from("x"), b64(Buffer.alloc(33, 1)), rfc.auth)).toThrow();
    expect(() => encryptPushPayload(Buffer.from("x"), rfc.receiverPublic, b64(Buffer.alloc(8)))).toThrow();
  });
});
const b64 = (bytes: Buffer) => bytes.toString("base64url");

describe("VAPID", () => {
  it("keeps one key pair in the data folder, private to the owner", () => {
    const first = loadVapidKeys(dataDir);
    const again = loadVapidKeys(dataDir);
    expect(again.publicKey).toBe(first.publicKey);
    expect(b(first.publicKey)).toHaveLength(65);
    expect(statSync(join(dataDir, "web-push-vapid.json")).mode & 0o777).toBe(0o600);
  });

  it("signs a JWT for the push service's origin that the public key verifies", () => {
    const keys = loadVapidKeys(dataDir);
    const header = vapidAuthorization("https://web.push.apple.com/QGuQ", keys, "https://nordus.ai", 1_000_000_000_000);
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(b(claims).toString())).toEqual({ aud: "https://web.push.apple.com", exp: 1_000_000_000 + 12 * 3600, sub: "https://nordus.ai" });
    const point = b(keys.publicKey);
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64(point.subarray(1, 33)), y: b64(point.subarray(33)) }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b(signature))).toBe(true);
  });
});

it("takes a loopback fake push service only when verification names one", () => {
  const fake = createWebPush({ dataDir, subject: "https://nordus.ai", testOrigin: "http://127.0.0.1:4555" });
  expect(fake.endpointAllowed("http://127.0.0.1:4555/push/1")).toBe(true);
  expect(fake.endpointAllowed("http://127.0.0.1:4556/push/1")).toBe(false);
  expect(createWebPush({ dataDir, subject: "https://nordus.ai", testOrigin: "http://10.0.0.5:4555" }).endpointAllowed("http://10.0.0.5:4555/x")).toBe(false);
  expect(createWebPush({ dataDir, subject: "https://nordus.ai" }).endpointAllowed("http://127.0.0.1:4555/push/1")).toBe(false);
});

it("accepts only real push services as endpoints", () => {
  expect(pushEndpointAllowed("https://web.push.apple.com/abc")).toBe(true);
  expect(pushEndpointAllowed("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
  expect(pushEndpointAllowed("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
  expect(pushEndpointAllowed("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true);
  expect(pushEndpointAllowed("http://web.push.apple.com/abc")).toBe(false);
  expect(pushEndpointAllowed("https://127.0.0.1/abc")).toBe(false);
  expect(pushEndpointAllowed("https://evilpush.apple.com.example/abc")).toBe(false);
  expect(pushEndpointAllowed("https://web.push.apple.com:8443/abc")).toBe(false);
  expect(pushEndpointAllowed("not a url")).toBe(false);
});

const receiver = createECDH("prime256v1");
receiver.generateKeys();
const receiverAuth = Buffer.alloc(16, 7);
const subscription = (endpoint: string, extra: Partial<{ finished: boolean; sounds: boolean }> = {}) => subscriptionInput.parse({
  subscription: { endpoint, keys: { p256dh: b64(receiver.getPublicKey()), auth: b64(receiverAuth) } },
  finished: true, sounds: true, ...extra,
});

const note = (extra: Partial<Notification> = {}): Notification => ({
  kind: "approval", botId: "bot-1", botName: "Ana", threadId: "thread-1", title: "Ana precisa de você", body: "Aprovar o envio?", ...extra,
});

describe("who gets a push", () => {
  const everyone = { sees: () => true };

  it("follows the banner rules: normal news waits for the summary, done only for devices that want it", () => {
    const store = new PushSubscriptions(dataDir);
    store.save("phone", subscription("https://web.push.apple.com/a", { finished: false }));
    store.save("laptop", subscription("https://fcm.googleapis.com/b", { finished: true }));
    const owners = (n: Notification) => pushTargets(n, store.list(), everyone, store).map((row) => row.owner).sort();
    expect(owners(note())).toEqual(["laptop", "phone"]);
    expect(owners(note({ priority: "urgent" }))).toEqual(["laptop", "phone"]);
    expect(owners(note({ priority: "normal" }))).toEqual([]);
    expect(owners(note({ kind: "done" }))).toEqual(["laptop"]);
  });

  it("skips a device whose page is open and visible, until its heartbeat goes stale", () => {
    let now = 1_000;
    const store = new PushSubscriptions(dataDir, () => now);
    store.save("phone", subscription("https://web.push.apple.com/a"));
    store.notePresence("phone", "page-aaaaaaaa", true);
    expect(pushTargets(note(), store.list(), everyone, store)).toHaveLength(0);
    now += PRESENCE_TTL_MS + 1;
    expect(pushTargets(note(), store.list(), everyone, store)).toHaveLength(1);
    store.notePresence("phone", "page-aaaaaaaa", true);
    store.notePresence("phone", "page-aaaaaaaa", false);
    expect(pushTargets(note(), store.list(), everyone, store)).toHaveLength(1);
  });

  it("asks the audience, so spend reaches admins only and members only their own bots", () => {
    const store = new PushSubscriptions(dataDir);
    store.save("admin", subscription("https://web.push.apple.com/a"));
    store.save("member", subscription("https://web.push.apple.com/b"));
    expect(pushTargets(note({ kind: "spend" }), store.list(), { sees: (owner) => owner === "admin" }, store).map((row) => row.owner)).toEqual(["admin"]);
  });

  it("keeps an endpoint under one owner and persists across restarts", () => {
    const store = new PushSubscriptions(dataDir);
    store.save("old-session", subscription("https://web.push.apple.com/a"));
    store.save("new-session", subscription("https://web.push.apple.com/a"));
    expect(new PushSubscriptions(dataDir).list().map((row) => row.owner)).toEqual(["new-session"]);
    expect(statSync(join(dataDir, "web-push-subscriptions.json")).mode & 0o777).toBe(0o600);
    expect(store.remove("someone-else", "https://web.push.apple.com/a")).toBe(false);
    expect(store.remove("new-session", "https://web.push.apple.com/a")).toBe(true);
    expect(new PushSubscriptions(dataDir).list()).toEqual([]);
  });
});

describe("delivery", () => {
  it("posts an encrypted, VAPID-signed message the browser can read, and forgets a gone subscription", async () => {
    const sent: Array<{ url: string; headers: Record<string, string>; body: Uint8Array }> = [];
    let status = 201;
    const fetch: PushFetch = async (url, init) => { sent.push({ url, headers: init.headers, body: init.body }); return { status }; };
    const webPush = createWebPush({ dataDir, subject: "https://nordus.ai", fetch });
    webPush.subscriptions.save("phone", subscription("https://web.push.apple.com/a", { sounds: false }));

    expect(await webPush.dispatch(note({ avatarUrl: "/api/bots/bot-1/avatar" }), { sees: () => true })).toEqual([201]);
    expect(sent[0].url).toBe("https://web.push.apple.com/a");
    expect(sent[0].headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "86400", urgency: "high" });
    expect(sent[0].headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(JSON.parse(decrypt(Buffer.from(sent[0].body), receiver.getPrivateKey(), receiverAuth))).toEqual({
      title: "Ana precisa de você", body: "Aprovar o envio?", tag: "nordus:bot-1", botId: "bot-1", threadId: "thread-1", kind: "approval",
      icon: "/api/bots/bot-1/avatar", silent: true,
    });

    status = 410;
    expect(await webPush.dispatch(note(), { sees: () => true })).toEqual([410]);
    expect(webPush.subscriptions.list()).toEqual([]);
    expect(JSON.parse(readFileSync(join(dataDir, "web-push-subscriptions.json"), "utf8"))).toEqual([]);
  });

  it("never sends a data: avatar or a body past the push size", async () => {
    const sent: Uint8Array[] = [];
    const webPush = createWebPush({ dataDir, subject: "https://nordus.ai", fetch: async (_url, init) => { sent.push(init.body); return { status: 201 }; } });
    webPush.subscriptions.save("phone", subscription("https://web.push.apple.com/a"));
    await webPush.dispatch(note({ avatarUrl: `data:image/png;base64,${"A".repeat(5_000)}`, body: "x".repeat(5_000) }), { sees: () => true });
    const payload = JSON.parse(decrypt(Buffer.from(sent[0]), receiver.getPrivateKey(), receiverAuth));
    expect(payload.icon).toBeUndefined();
    expect(payload.body.length).toBe(600);
    expect(sent[0].length).toBeLessThan(4_096);
  });
});

describe("routes", () => {
  const sessionAuth = (id: string) => ({ kind: "session", session: { id }, via: "cookie", scopes: ["client"] }) as unknown as RouteContext["auth"];
  async function call(webPush: ReturnType<typeof createWebPush>, method: string, path: string, auth: RouteContext["auth"], body?: unknown) {
    const answer: { status?: number; value?: any } = {};
    const res = { setHeader() {}, headersSent: false, writableEnded: false } as unknown as RouteContext["res"];
    const out = await createWebPushRoutes(webPush)({
      req: {} as RouteContext["req"], res, url: new URL(`http://x${path}`), path, method, auth,
      json: ((_res: unknown, status: number, value: unknown) => { answer.status = status; answer.value = value; }) as RouteContext["json"],
      readBody: (async () => body) as RouteContext["readBody"],
    });
    return out === PASS ? "pass" : answer;
  }

  it("saves and removes one device's subscription, and lets no bot shell sign up", async () => {
    const webPush = createWebPush({ dataDir, subject: "https://nordus.ai", fetch: async () => ({ status: 201 }) });
    const phone = sessionAuth("session-phone");
    expect(await call(webPush, "GET", "/api/push/key", phone)).toEqual({ status: 200, value: { publicKey: webPush.publicKey } });
    const input = { subscription: { endpoint: "https://web.push.apple.com/a", keys: { p256dh: b64(receiver.getPublicKey()), auth: b64(receiverAuth) } }, finished: false, sounds: true };
    expect(await call(webPush, "PUT", "/api/push/subscription", phone, input)).toEqual({ status: 200, value: { ok: true } });
    expect(webPush.subscriptions.list().map((row) => [row.owner, row.finished])).toEqual([["session-phone", false]]);
    expect((await call(webPush, "PUT", "/api/push/subscription", phone, { ...input, subscription: { ...input.subscription, endpoint: "https://127.0.0.1/x" } }) as any).status).toBe(400);
    const shell = { kind: "loopback", scopes: ["client"], trust: "service" } as RouteContext["auth"];
    expect((await call(webPush, "PUT", "/api/push/subscription", shell, input) as any).status).toBe(403);
    expect(await call(webPush, "POST", "/api/push/presence", phone, { page: "page-aaaaaaaa", visible: true })).toEqual({ status: 200, value: { ok: true } });
    expect(webPush.subscriptions.hasVisiblePage("session-phone")).toBe(true);
    expect(await call(webPush, "DELETE", "/api/push/subscription", sessionAuth("someone-else"), { endpoint: "https://web.push.apple.com/a" })).toEqual({ status: 200, value: { ok: true, removed: false } });
    expect(await call(webPush, "DELETE", "/api/push/subscription", phone, { endpoint: "https://web.push.apple.com/a" })).toEqual({ status: 200, value: { ok: true, removed: true } });
    expect(await call(webPush, "GET", "/api/notifications", phone)).toBe("pass");
  });
});

it("hands the service worker the card's request along with the conversation", () => {
  const notification: Notification = { kind: "approval", botId: "b", botName: "DESIGNERGRAFICO", threadId: "t", title: "DESIGNERGRAFICO precisa de você: autorizar publicar", body: "publicar", requestId: "req-7" };
  expect(pushPayload(notification, { sounds: true })).toMatchObject({ botId: "b", threadId: "t", requestId: "req-7" });
  expect(pushPayload({ ...notification, requestId: undefined }, { sounds: true })).not.toHaveProperty("requestId");
});
