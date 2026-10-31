import { requestIdFrom } from "./card-focus";
import type { NotificationTarget } from "@/lib/notify";

/** Window event the composer listens to: appends `detail.text` to the open draft. */
export const COMPOSE_TEXT_EVENT = "nordus:compose-text";

type Listener = { remove: () => Promise<void> | void };

interface PushPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: "registration", cb: (token: { value: string }) => void): Promise<Listener>;
  addListener(event: "registrationError", cb: (error: unknown) => void): Promise<Listener>;
  addListener(
    event: "pushNotificationActionPerformed",
    cb: (action: { notification: { data?: Record<string, unknown> } }) => void,
  ): Promise<Listener>;
}

interface BadgePlugin {
  set(options: { count: number }): Promise<void>;
  clear(): Promise<void>;
}

export interface SharedItem {
  id: string;
  kind: "text" | "url" | "file";
  text?: string;
  url?: string;
  name?: string;
  mime?: string;
  base64?: string;
}

interface NordusNativePlugin {
  info(): Promise<{ apnsEnvironment: "sandbox" | "production"; version: string; build: string }>;
  takeShared(): Promise<{ items: SharedItem[] }>;
  addListener(event: "shared", cb: () => void): Promise<Listener>;
}

/** The bridge the Nordus iPhone app (Capacitor) injects into the page it loads. */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: {
    PushNotifications?: PushPlugin;
    Badge?: BadgePlugin;
    NordusNative?: NordusNativePlugin;
  };
}

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

export function isNativeApp(): boolean {
  return capacitor() !== null;
}

export function nativeBadge(): BadgePlugin | null {
  return capacitor()?.Plugins?.Badge ?? null;
}

export function pushTargetFromData(data: Record<string, unknown> | undefined): NotificationTarget | null {
  const botId = typeof data?.botId === "string" ? data.botId : null;
  const threadId = typeof data?.threadId === "string" ? data.threadId : null;
  if (!botId || !threadId) return null;
  return requestIdFrom(data?.requestId) ? { botId, threadId, requestId: data!.requestId as string } : { botId, threadId };
}

export function sharedItemsToComposerInput(items: SharedItem[]): { text: string; files: File[] } {
  const lines: string[] = [];
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === "text" && item.text) lines.push(item.text);
    if (item.kind === "url" && item.url) lines.push(item.url);
    if (item.kind === "file" && item.base64) {
      const bytes = Uint8Array.from(atob(item.base64), (char) => char.charCodeAt(0));
      files.push(new File([bytes], item.name ?? "arquivo", { type: item.mime ?? "application/octet-stream" }));
    }
  }
  return { text: lines.join("\n"), files };
}

/** Hands shared files to the composer through the same window drop path a dragged file takes. */
function deliverFiles(files: File[]) {
  if (!files.length) return;
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
}

async function deliverShared(plugin: NordusNativePlugin) {
  const { items } = await plugin.takeShared();
  if (!items.length) return;
  const { text, files } = sharedItemsToComposerInput(items);
  if (text) window.dispatchEvent(new CustomEvent(COMPOSE_TEXT_EVENT, { detail: { text } }));
  deliverFiles(files);
}

async function registerPush(push: PushPlugin, native: NordusNativePlugin | undefined): Promise<Listener[]> {
  const listeners: Listener[] = [];
  listeners.push(
    await push.addListener("registration", (token) => {
      void (async () => {
        const environment = (await native?.info().catch(() => null))?.apnsEnvironment ?? "production";
        await fetch("/api/push/apns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: token.value, ambiente: environment === "sandbox" ? "sandbox" : "producao" }),
        }).catch(() => {});
      })();
    }),
  );
  let status = (await push.checkPermissions()).receive;
  if (status === "prompt" || status === "prompt-with-rationale") status = (await push.requestPermissions()).receive;
  if (status === "granted") await push.register();
  return listeners;
}

/** Wires the iPhone app's native parts once the page is connected. Returns the cleanup. */
export function startNativeApp(openTarget: (target: NotificationTarget) => void): () => void {
  const cap = capacitor();
  if (!cap) return () => {};
  const push = cap.Plugins?.PushNotifications;
  const native = cap.Plugins?.NordusNative;
  const listeners: Listener[] = [];
  let stopped = false;

  void (async () => {
    if (push) {
      listeners.push(
        await push.addListener("pushNotificationActionPerformed", (action) => {
          const target = pushTargetFromData(action.notification.data);
          if (target) openTarget(target);
        }),
      );
      listeners.push(...(await registerPush(push, native).catch(() => [])));
    }
    if (native) {
      listeners.push(await native.addListener("shared", () => void deliverShared(native).catch(() => {})));
      await deliverShared(native).catch(() => {});
    }
    if (stopped) for (const listener of listeners) void listener.remove();
  })();

  return () => {
    stopped = true;
    for (const listener of listeners) void listener.remove();
  };
}
