import type { NotificationTarget } from "./notify";
import { requestIdFrom } from "./card-focus";

/** Nordus: Web Push. The service worker shows banners while the app is closed (the iPhone home screen app needs
 *  iOS 16.4+), and the server pushes the same notify frames the live stream carries, minus the ones an open page shows. */

export const SERVICE_WORKER_URL = "/sw.js";
export const OPEN_NOTIFICATION_MESSAGE = "nordus:open-notification";
const HEARTBEAT_MS = 30_000;

export interface PushPreferences {
  finished: boolean;
  sounds: boolean;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator
    && "PushManager" in window && typeof Notification !== "undefined" && window.isSecureContext;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registered on every load, so a banner shown from the page can open its conversation through the worker too. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  registration = typeof navigator !== "undefined" && typeof navigator.serviceWorker?.register === "function" && typeof window !== "undefined" && window.isSecureContext
    ? navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" }).catch(() => null)
    : Promise.resolve(null);
  return registration;
}

/** The active worker, or null while it is still installing or where there is none. */
export async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await registerServiceWorker();
  return reg?.active ? reg : null;
}

function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function send(method: string, path: string, body?: unknown, keepalive = false): Promise<Response> {
  return fetch(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), keepalive });
}

/** Call after permission is granted. Resolves to false where the browser has no push (the Mac shell, older iPhones). */
export async function enablePush(preferences: PushPreferences): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await registerServiceWorker();
    if (!reg) return false;
    const ready = await navigator.serviceWorker.ready;
    let subscription = await ready.pushManager.getSubscription();
    if (!subscription) {
      const key = await send("GET", "/api/push/key");
      if (!key.ok) return false;
      const { publicKey } = (await key.json()) as { publicKey: string };
      subscription = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
    }
    const res = await send("PUT", "/api/push/subscription", { subscription: subscription.toJSON(), ...preferences });
    return res.ok;
  } catch {
    return false;
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await send("DELETE", "/api/push/subscription", { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {}
}

/** The switches changed: refresh what the server holds for this device, if it is signed up. */
export async function syncPushPreferences(preferences: PushPreferences): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const subscription = await reg?.pushManager.getSubscription();
    if (subscription) await send("PUT", "/api/push/subscription", { subscription: subscription.toJSON(), ...preferences });
  } catch {}
}

/** While this page is visible it shows its own banners, so the server holds the push. A page that stops beating
 *  (an iPhone suspends a backgrounded app without a word) stops counting after the server's grace period. */
export function startPushPresence(): () => void {
  if (typeof document === "undefined" || typeof document.addEventListener !== "function" || typeof window.addEventListener !== "function"
    || typeof fetch !== "function" || typeof crypto?.randomUUID !== "function") return () => {};
  const page = `page-${crypto.randomUUID()}`;
  let timer: ReturnType<typeof setInterval> | undefined;
  const report = (visible: boolean) => {
    try {
      void send("POST", "/api/push/presence", { page, visible }, !visible).catch(() => undefined);
    } catch {}
  };
  const update = () => {
    const visible = document.visibilityState === "visible";
    report(visible);
    clearInterval(timer);
    timer = visible ? setInterval(() => report(true), HEARTBEAT_MS) : undefined;
  };
  const hide = () => report(false);
  update();
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pagehide", hide);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("pagehide", hide);
    report(false);
  };
}

/** A banner click the worker routed to this open page. */
export function onNotificationOpen(open: (target: NotificationTarget) => void): () => void {
  if (typeof navigator === "undefined" || typeof navigator.serviceWorker?.addEventListener !== "function") return () => {};
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; botId?: unknown; threadId?: unknown; requestId?: unknown } | null;
    if (data?.type !== OPEN_NOTIFICATION_MESSAGE || typeof data.botId !== "string" || typeof data.threadId !== "string") return;
    const requestId = requestIdFrom(data.requestId);
    open({ botId: data.botId, threadId: data.threadId, ...(requestId ? { requestId } : {}) });
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

/** A click that had to open the app carries the conversation in the URL; the URL is put back as it was. */
export function takeNotificationTarget(href: string): { target: NotificationTarget; rest: string } | null {
  const url = new URL(href);
  const threadId = url.searchParams.get("notification-thread");
  const botId = url.searchParams.get("notification-bot");
  if (!threadId || !botId || !/^[\w-]{1,128}$/.test(threadId) || !/^[\w-]{1,128}$/.test(botId)) return null;
  const requestId = requestIdFrom(url.searchParams.get("notification-request"));
  url.searchParams.delete("notification-thread");
  url.searchParams.delete("notification-bot");
  url.searchParams.delete("notification-request");
  return { target: { botId, threadId, ...(requestId ? { requestId } : {}) }, rest: `${url.pathname}${url.search}${url.hash}` };
}
