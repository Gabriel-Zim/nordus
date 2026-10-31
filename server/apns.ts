import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { connect, type ClientHttp2Session } from "node:http2";
import { join } from "node:path";
import { z } from "zod";
import type { Notification } from "../shared/notification.ts";
import { bannerTag } from "../shared/notification-banner.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { pushTargets, type PushAudience, type PushSubscriptionRecord, type PushSubscriptions } from "./web-push.ts";

/** Nordus: the native iPhone app has no Web Push inside its web view; Apple's push service (APNs) carries its
 *  banners instead, for the same notify frames and the same rules. Off, without errors, until the key is set up. */

const CONFIG_FILE = "apns.json";
const DEVICES_FILE = "apns-devices.json";
const MAX_PER_OWNER = 5;
const MAX_TOTAL = 200;
/** APNs refuses a provider token older than an hour and throttles one renewed more often than every 20 minutes. */
const TOKEN_TTL_MS = 50 * 60_000;
const BODY_MAX = 600;

export const APNS_HOSTS = { sandbox: "https://api.sandbox.push.apple.com", producao: "https://api.push.apple.com" } as const;
export type ApnsEnvironment = keyof typeof APNS_HOSTS;

const configFile = z.object({
  keyId: z.string().regex(/^[A-Z0-9]{10}$/),
  teamId: z.string().regex(/^[A-Z0-9]{10}$/),
  bundleId: z.string().regex(/^[\w.-]{3,155}$/),
  /** The .p8 file Apple gives; relative paths are inside the data folder. Never in git. */
  keyPath: z.string().min(1),
});

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  key: KeyObject;
}

/** Null (APNs off) when the file or the key is missing or unreadable. */
export function loadApnsConfig(dataDir: string, log?: (message: string) => void): ApnsConfig | null {
  let raw: string;
  try {
    raw = readFileSync(join(dataDir, CONFIG_FILE), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = configFile.parse(JSON.parse(raw));
    const keyPath = parsed.keyPath.startsWith("/") ? parsed.keyPath : join(dataDir, parsed.keyPath);
    return { keyId: parsed.keyId, teamId: parsed.teamId, bundleId: parsed.bundleId, key: createPrivateKey(readFileSync(keyPath, "utf8")) };
  } catch (error) {
    log?.(`apns.json ignored: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The provider token: an ES256 JWT with the key id in the header and the team as issuer. */
export function apnsProviderToken(config: Pick<ApnsConfig, "keyId" | "teamId" | "key">, now = Date.now()): string {
  const b64u = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${b64u({ alg: "ES256", kid: config.keyId })}.${b64u({ iss: config.teamId, iat: Math.floor(now / 1000) })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key: config.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

// ---------- Devices ----------

export const apnsDeviceInput = z.object({
  token: z.string().regex(/^[0-9a-fA-F]{64,200}$/),
  ambiente: z.enum(["sandbox", "producao"]),
  /** The device's own switches, as for Web Push; absent is on. */
  finished: z.boolean().default(true),
  sounds: z.boolean().default(true),
});

export interface ApnsDeviceRecord extends Pick<PushSubscriptionRecord, "owner" | "finished" | "sounds" | "at"> {
  token: string;
  ambiente: ApnsEnvironment;
}

const storedDevices = z.array(z.object({
  owner: z.string(), token: z.string(), ambiente: z.enum(["sandbox", "producao"]), finished: z.boolean(), sounds: z.boolean(), at: z.number(),
}));

export class ApnsDevices {
  private rows: ApnsDeviceRecord[] = [];
  private readonly path: string;
  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = Date.now) {
    this.now = now;
    this.path = join(dataDir, DEVICES_FILE);
    try {
      const parsed = storedDevices.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (parsed.success) this.rows = parsed.data;
    } catch {}
  }

  list(): readonly ApnsDeviceRecord[] {
    return this.rows;
  }

  save(owner: string, input: z.infer<typeof apnsDeviceInput>): void {
    const token = input.token.toLowerCase();
    // A token belongs to one app install: a device that signed in again moves it to its new session.
    const rest = this.rows.filter((row) => row.token !== token);
    const mine = rest.filter((row) => row.owner === owner).sort((a, b) => b.at - a.at).slice(0, MAX_PER_OWNER - 1);
    const others = rest.filter((row) => row.owner !== owner);
    this.rows = [{ owner, token, ambiente: input.ambiente, finished: input.finished, sounds: input.sounds, at: this.now() }, ...mine, ...others].slice(0, MAX_TOTAL);
    this.persist();
  }

  remove(owner: string, token: string): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !(row.owner === owner && row.token === token.toLowerCase()));
    if (this.rows.length === before) return false;
    this.persist();
    return true;
  }

  forget(predicate: (row: ApnsDeviceRecord) => boolean): void {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !predicate(row));
    if (this.rows.length !== before) this.persist();
  }

  private persist(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.rows) + "\n", { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}

// ---------- Sending ----------

export function apnsPayload(notification: Notification, row: Pick<ApnsDeviceRecord, "sounds">, badge: number): Record<string, unknown> {
  return {
    aps: {
      alert: {
        title: notification.title.slice(0, 200),
        body: notification.body.length > BODY_MAX ? `${notification.body.slice(0, BODY_MAX - 1)}…` : notification.body,
      },
      badge: Math.max(0, Math.floor(badge)),
      ...(row.sounds ? { sound: "default" } : {}),
      "thread-id": bannerTag(notification),
    },
    botId: notification.botId,
    threadId: notification.threadId,
    kind: notification.kind,
    ...(notification.requestId ? { requestId: notification.requestId } : {}),
  };
}

export interface ApnsRequest {
  origin: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

/** One HTTP/2 POST; resolves with the status and APNs' reason, if any. */
export type ApnsSend = (request: ApnsRequest) => Promise<{ status: number; reason?: string }>;

export function http2Send(): ApnsSend {
  const sessions = new Map<string, ClientHttp2Session>();
  const session = (origin: string) => {
    const open = sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const created = connect(origin);
    created.on("error", () => sessions.delete(origin));
    created.on("close", () => sessions.delete(origin));
    // An idle connection should not keep the process alive.
    created.unref();
    sessions.set(origin, created);
    return created;
  };
  return (request) => new Promise((resolve, reject) => {
    const stream = session(request.origin).request({ ":method": "POST", ":path": request.path, ...request.headers });
    let status = 0;
    let text = "";
    stream.setTimeout(10_000, () => stream.close());
    stream.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
    stream.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); });
    stream.on("end", () => {
      let reason: string | undefined;
      try {
        reason = text ? (JSON.parse(text) as { reason?: string }).reason : undefined;
      } catch {}
      resolve({ status, ...(reason ? { reason } : {}) });
    });
    stream.on("error", reject);
    stream.end(request.body);
  });
}

export interface ApnsDeps {
  dataDir: string;
  /** Conversations unread for this owner, for the app icon's number. */
  unread(owner: string): number;
  send?: ApnsSend;
  now?: () => number;
  log?: (message: string) => void;
}

export function createApns(deps: ApnsDeps) {
  const devices = new ApnsDevices(deps.dataDir, deps.now);
  const send = deps.send ?? http2Send();
  let token: { value: string; at: number; keyId: string } | null = null;
  // Read per send: dropping the file in place turns APNs on without a restart.
  const config = () => loadApnsConfig(deps.dataDir, deps.log);
  const providerToken = (current: ApnsConfig) => {
    const now = deps.now?.() ?? Date.now();
    if (!token || token.keyId !== current.keyId || now - token.at > TOKEN_TTL_MS) token = { value: apnsProviderToken(current, now), at: now, keyId: current.keyId };
    return token.value;
  };

  async function deliver(current: ApnsConfig, row: ApnsDeviceRecord, notification: Notification): Promise<number | null> {
    const tag = bannerTag(notification);
    try {
      const res = await send({
        origin: APNS_HOSTS[row.ambiente],
        path: `/3/device/${row.token}`,
        headers: {
          authorization: `bearer ${providerToken(current)}`,
          "apns-topic": current.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor((deps.now?.() ?? Date.now()) / 1000) + 24 * 60 * 60),
          // Banners for one bot replace each other, as on the web.
          ...(Buffer.byteLength(tag) <= 64 ? { "apns-collapse-id": tag } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(apnsPayload(notification, row, deps.unread(row.owner))),
      });
      if (res.status === 410 || (res.status === 400 && (res.reason === "BadDeviceToken" || res.reason === "DeviceTokenNotForTopic"))) {
        devices.forget((candidate) => candidate.token === row.token);
      } else if (res.status === 403 && res.reason === "ExpiredProviderToken") {
        token = null;
      } else if (res.status >= 400) {
        deps.log?.(`apns refused with ${res.status}${res.reason ? ` ${res.reason}` : ""}`);
      }
      return res.status;
    } catch (error) {
      deps.log?.(`apns failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  return {
    devices,
    enabled: () => config() !== null,
    dispatch(notification: Notification, audience: PushAudience, presence: Pick<PushSubscriptions, "hasVisiblePage">): Promise<Array<number | null>> {
      if (!devices.list().length) return Promise.resolve([]);
      const current = config();
      if (!current) return Promise.resolve([]);
      const targets = pushTargets(notification, devices.list(), audience, presence);
      return Promise.all(targets.map((row) => deliver(current, row, notification)));
    },
  };
}

export type Apns = ReturnType<typeof createApns>;

export const APNS_PATH = "/api/push/apns";
const removeInput = z.object({ token: z.string().max(200) });

/** Behind the auth gate, like the Web Push routes: a device is its paired session. */
export function createApnsRoutes(apns: Apns): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== APNS_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const owner = auth.kind === "session" ? auth.session.id : auth.trust === "service" ? null : "loopback";
    if (!owner) return json(res, 403, { error: "This connection cannot receive notifications." });
    const body = await readBody(req, 4_096).catch(() => null);
    if (method === "POST") {
      const parsed = apnsDeviceInput.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Send token (hex) and ambiente (sandbox or producao)." });
      apns.devices.save(owner, parsed.data);
      return json(res, 200, { ok: true, enabled: apns.enabled() });
    }
    if (method === "DELETE") {
      const parsed = removeInput.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Send the token to remove." });
      return json(res, 200, { ok: true, removed: apns.devices.remove(owner, parsed.data.token) });
    }
    return json(res, 405, { error: "POST or DELETE" });
  };
}
