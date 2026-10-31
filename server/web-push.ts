import {
  createECDH, createCipheriv, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject,
} from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Notification } from "../shared/notification.ts";
import { bannerTag, bannerWanted } from "../shared/notification-banner.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

/** Nordus: Web Push, so a closed web app (the iPhone home screen app included, iOS 16.4+) still gets its banners.
 *  RFC 8291 payload encryption and RFC 8292 VAPID, with node:crypto alone. */

const VAPID_FILE = "web-push-vapid.json";
const SUBSCRIPTIONS_FILE = "web-push-subscriptions.json";
const MAX_PER_OWNER = 5;
const MAX_TOTAL = 200;
/** A visible page heartbeats every 30 s; one that stopped (an iPhone suspends a backgrounded app) counts as gone. */
export const PRESENCE_TTL_MS = 75_000;
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const BODY_MAX = 600;

/** Only real push services: the server POSTs to this URL, so a free-form one would let any device aim it anywhere. */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "web.push.apple.com",
  ".push.apple.com",
  "updates.push.services.mozilla.com",
  ".push.services.mozilla.com",
  ".notify.windows.com",
];

export function pushEndpointAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => (allowed.startsWith(".") ? host.endsWith(allowed) : host === allowed));
}

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromB64u = (value: string) => Buffer.from(value, "base64url");
const hmac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();

// ---------- VAPID keys ----------

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url: what the browser's `applicationServerKey` takes. */
  publicKey: string;
  privateKey: KeyObject;
}

const vapidFile = z.object({ publicKey: z.string().min(80).max(100), privateJwk: z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string(), d: z.string() }) });

/** Made once and kept in the data folder (mode 0600): changing them would silently orphan every device's subscription. */
export function loadVapidKeys(dataDir: string): VapidKeys {
  const path = join(dataDir, VAPID_FILE);
  if (existsSync(path)) {
    const parsed = vapidFile.parse(JSON.parse(readFileSync(path, "utf8")));
    return { publicKey: parsed.publicKey, privateKey: createPrivateKey({ key: parsed.privateJwk, format: "jwk" }) };
  }
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { kty: "EC"; crv: "P-256"; x: string; y: string; d: string };
  const publicKey = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
  try {
    writeFileSync(path, JSON.stringify({ publicKey, privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } }) + "\n", { mode: 0o600, flag: "wx" });
  } catch (error) {
    // Two starts raced: the file that landed first wins.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return loadVapidKeys(dataDir);
    throw error;
  }
  return { publicKey, privateKey };
}

/** RFC 8292: `vapid t=<ES256 JWT>, k=<public key>`, the JWT scoped to the push service's origin. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: subject })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: keys.privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

// ---------- RFC 8291 payload encryption ----------

export interface EncryptOptions {
  /** Tests only: the RFC's fixed sender key and salt. */
  senderPrivateKey?: Uint8Array;
  salt?: Uint8Array;
}

/** One aes128gcm record (RFC 8188) keyed for the receiving browser (RFC 8291). */
export function encryptPushPayload(plaintext: Uint8Array, p256dh: string, auth: string, options: EncryptOptions = {}): Buffer {
  const receiverPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4) throw new Error("p256dh must be an uncompressed P-256 point");
  if (authSecret.length !== 16) throw new Error("auth must be 16 bytes");
  const ecdh = createECDH("prime256v1");
  if (options.senderPrivateKey) ecdh.setPrivateKey(options.senderPrivateKey);
  else ecdh.generateKeys();
  const senderPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(receiverPublic);
  const salt = options.salt ?? randomBytes(16);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublic, senderPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02: the last (and only) record's padding delimiter.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, body]);
}

// ---------- Subscriptions and presence ----------

const keyField = z.string().regex(/^[\w-]+=*$/).max(200);
export const subscriptionInput = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1_000),
    keys: z.object({ p256dh: keyField, auth: keyField }),
  }),
  /** The device's own switches, kept here because a closed page cannot read its local storage. */
  finished: z.boolean(),
  sounds: z.boolean(),
});

export interface PushSubscriptionRecord {
  /** The paired session this device signed in with, or "loopback" for the owner's own machine. */
  owner: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  finished: boolean;
  sounds: boolean;
  at: number;
}

const storedSubscriptions = z.array(z.object({
  owner: z.string(), endpoint: z.string(), p256dh: z.string(), auth: z.string(), finished: z.boolean(), sounds: z.boolean(), at: z.number(),
}));

export class PushSubscriptions {
  private rows: PushSubscriptionRecord[] = [];
  private readonly path: string;
  /** owner → page id → last visible heartbeat. */
  private readonly visiblePages = new Map<string, Map<string, number>>();

  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = Date.now, allowed: (endpoint: string) => boolean = pushEndpointAllowed) {
    this.now = now;
    this.path = join(dataDir, SUBSCRIPTIONS_FILE);
    try {
      const parsed = storedSubscriptions.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (parsed.success) this.rows = parsed.data.filter((row) => allowed(row.endpoint));
    } catch {}
  }

  list(): readonly PushSubscriptionRecord[] {
    return this.rows;
  }

  save(owner: string, input: z.infer<typeof subscriptionInput>): void {
    const { endpoint, keys } = input.subscription;
    // An endpoint belongs to one browser: a device that signed in again moves it to its new session.
    const rest = this.rows.filter((row) => row.endpoint !== endpoint);
    const mine = rest.filter((row) => row.owner === owner).sort((a, b) => b.at - a.at).slice(0, MAX_PER_OWNER - 1);
    const others = rest.filter((row) => row.owner !== owner);
    const row: PushSubscriptionRecord = { owner, endpoint, p256dh: keys.p256dh, auth: keys.auth, finished: input.finished, sounds: input.sounds, at: this.now() };
    this.rows = [row, ...mine, ...others].slice(0, MAX_TOTAL);
    this.persist();
  }

  remove(owner: string, endpoint: string): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !(row.owner === owner && row.endpoint === endpoint));
    if (this.rows.length === before) return false;
    this.persist();
    return true;
  }

  /** The push service said the browser dropped it (404/410), or the session that made it ended. */
  forget(predicate: (row: PushSubscriptionRecord) => boolean): void {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !predicate(row));
    if (this.rows.length !== before) this.persist();
  }

  notePresence(owner: string, page: string, visible: boolean): void {
    let pages = this.visiblePages.get(owner);
    if (visible) {
      if (!pages) this.visiblePages.set(owner, (pages = new Map()));
      if (pages.size >= 20 && !pages.has(page)) return;
      pages.set(page, this.now());
    } else if (pages) {
      pages.delete(page);
      if (!pages.size) this.visiblePages.delete(owner);
    }
  }

  /** An open, visible page already shows its own banner from the live stream: a push on top would be a second one. */
  hasVisiblePage(owner: string): boolean {
    const pages = this.visiblePages.get(owner);
    if (!pages) return false;
    const cutoff = this.now() - PRESENCE_TTL_MS;
    for (const [page, at] of pages) if (at < cutoff) pages.delete(page);
    if (!pages.size) this.visiblePages.delete(owner);
    return pages.size > 0;
  }

  private persist(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.rows) + "\n", { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}

// ---------- Who gets a push ----------

export interface PushAudience {
  /** Whether this device's owner may see the notification at all (live session, admin for spend, member visibility). */
  sees(owner: string): boolean;
}

export function pushTargets<Row extends Pick<PushSubscriptionRecord, "owner" | "finished">>(notification: Notification, rows: readonly Row[], audience: PushAudience, store: Pick<PushSubscriptions, "hasVisiblePage">): Row[] {
  return rows.filter((row) => bannerWanted(notification, { finished: row.finished }) && audience.sees(row.owner) && !store.hasVisiblePage(row.owner));
}

/** Nordus: what one device's banner says and offers when it is not the notification's own text: an approval's headline and its
 * Approve and Decline buttons, with the one-tap token the worker sends back. */
export interface PushDecoration {
  title?: string;
  body?: string;
  actions?: Array<{ action: string; title: string }>;
  approval?: { id: string; token: string; done: { approve: string; decline: string } };
}

/** What the service worker reads: the same title, body and tag the page's own banner uses. */
export function pushPayload(notification: Notification, row: Pick<PushSubscriptionRecord, "sounds">, decoration?: PushDecoration): Record<string, unknown> {
  const icon = notification.kind !== "spend" && notification.avatarUrl && notification.avatarUrl.startsWith("/") && notification.avatarUrl.length <= 500
    ? notification.avatarUrl : undefined;
  const body = decoration?.body ?? notification.body;
  return {
    title: (decoration?.title ?? notification.title).slice(0, 200),
    body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1)}…` : body,
    ...(decoration?.actions?.length ? { actions: decoration.actions.slice(0, 2) } : {}),
    ...(decoration?.approval ? { approval: decoration.approval } : {}),
    tag: bannerTag(notification),
    botId: notification.botId,
    threadId: notification.threadId,
    kind: notification.kind,
    ...(notification.requestId ? { requestId: notification.requestId } : {}),
    ...(icon ? { icon } : {}),
    ...(row.sounds ? {} : { silent: true }),
  };
}

export type PushFetch = (url: string, init: { method: string; headers: Record<string, string>; body: Uint8Array; signal?: AbortSignal }) => Promise<{ status: number }>;

export interface WebPushDeps {
  dataDir: string;
  subject: string;
  fetch?: PushFetch;
  now?: () => number;
  log?: (message: string) => void;
  /** Verification only: a loopback fake push service (`http://127.0.0.1:PORT`) also counts as one. */
  testOrigin?: string;
  /** Nordus: per device, what the banner says and offers instead of the notification's own text. */
  decorate?: (notification: Notification, row: Pick<PushSubscriptionRecord, "owner">) => PushDecoration | undefined;
}

const TEST_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

export function createWebPush(deps: WebPushDeps) {
  const keys = loadVapidKeys(deps.dataDir);
  const testOrigin = deps.testOrigin && TEST_ORIGIN.test(deps.testOrigin) ? deps.testOrigin : null;
  const endpointAllowed = (endpoint: string) => {
    if (pushEndpointAllowed(endpoint)) return true;
    try {
      return testOrigin !== null && new URL(endpoint).origin === testOrigin;
    } catch {
      return false;
    }
  };
  const subscriptions = new PushSubscriptions(deps.dataDir, deps.now, endpointAllowed);
  const send: PushFetch = deps.fetch ?? (async (url, init) => {
    const res = await fetch(url, { ...init, body: init.body as Uint8Array<ArrayBuffer> });
    return { status: res.status };
  });

  async function deliver(row: PushSubscriptionRecord, notification: Notification): Promise<number | null> {
    try {
      const body = encryptPushPayload(Buffer.from(JSON.stringify(pushPayload(notification, row, deps.decorate?.(notification, row)))), row.p256dh, row.auth);
      const res = await send(row.endpoint, {
        method: "POST",
        headers: {
          authorization: vapidAuthorization(row.endpoint, keys, deps.subject, deps.now?.()),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(PUSH_TTL_SECONDS),
          urgency: "high",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 410) subscriptions.forget((candidate) => candidate.endpoint === row.endpoint);
      else if (res.status >= 400) deps.log?.(`push refused with ${res.status}`);
      return res.status;
    } catch (error) {
      deps.log?.(`push failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  return {
    publicKey: keys.publicKey,
    subscriptions,
    endpointAllowed,
    /** Fire-and-forget from the notify broadcast; resolves with each device's push service status for tests. */
    dispatch(notification: Notification, audience: PushAudience): Promise<Array<number | null>> {
      const targets = pushTargets(notification, subscriptions.list(), audience, subscriptions);
      return Promise.all(targets.map((row) => deliver(row, notification)));
    },
  };
}

export type WebPush = ReturnType<typeof createWebPush>;

// ---------- Route ----------

export const WEB_PUSH_PATHS = { key: "/api/push/key", subscription: "/api/push/subscription", presence: "/api/push/presence" } as const;

const removeInput = z.object({ endpoint: z.string().max(1_000) });
const presenceInput = z.object({ page: z.string().regex(/^[\w-]{8,64}$/), visible: z.boolean() });

/** Behind the auth gate. A device is its paired session; the owner's own machine is "loopback". */
export function createWebPushRoutes(webPush: WebPush): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== WEB_PUSH_PATHS.key && path !== WEB_PUSH_PATHS.subscription && path !== WEB_PUSH_PATHS.presence) return PASS;
    res.setHeader("cache-control", "no-store");
    if (path === WEB_PUSH_PATHS.key) {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      return json(res, 200, { publicKey: webPush.publicKey });
    }
    // A bot's shell is a service loopback caller: it must not sign a device up for the owner's banners.
    const owner = auth.kind === "session" ? auth.session.id : auth.trust === "service" ? null : "loopback";
    if (!owner) return json(res, 403, { error: "This connection cannot receive notifications." });
    const body = await readBody(req, 8_192).catch(() => null);
    if (path === WEB_PUSH_PATHS.presence) {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      const parsed = presenceInput.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Send page and visible." });
      webPush.subscriptions.notePresence(owner, parsed.data.page, parsed.data.visible);
      return json(res, 200, { ok: true });
    }
    if (method === "PUT") {
      const parsed = subscriptionInput.safeParse(body);
      if (!parsed.success || !webPush.endpointAllowed(parsed.data.subscription.endpoint)) {
        return json(res, 400, { error: "Send a push subscription from a supported browser." });
      }
      webPush.subscriptions.save(owner, parsed.data);
      return json(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      const parsed = removeInput.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Send the endpoint to remove." });
      return json(res, 200, { ok: true, removed: webPush.subscriptions.remove(owner, parsed.data.endpoint) });
    }
    return json(res, 405, { error: "PUT or DELETE" });
  };
}
