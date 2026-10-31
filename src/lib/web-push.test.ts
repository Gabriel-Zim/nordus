import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { disablePush, enablePush, onNotificationOpen, OPEN_NOTIFICATION_MESSAGE, startPushPresence, syncPushPreferences, takeNotificationTarget } from "./web-push";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const KEY = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";

function installBrowser(options: { existing?: boolean; permission?: NotificationPermission } = {}) {
  const calls: Array<{ method: string; path: string; body?: any; keepalive?: boolean }> = [];
  const subscription = {
    endpoint: "https://web.push.apple.com/abc",
    toJSON: () => ({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
  let current = options.existing ? subscription : null;
  const subscribe = vi.fn(async (opts: PushSubscriptionOptionsInit) => { current = subscription; void opts; return subscription; });
  const pushManager = { getSubscription: async () => current, subscribe };
  const registration = { active: {}, pushManager };
  const listeners = new Map<string, (event: any) => void>();
  vi.stubGlobal("window", { isSecureContext: true, PushManager: class {}, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("Notification", { permission: options.permission ?? "granted" });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
      addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    },
  });
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
    calls.push({ method: init.method ?? "GET", path, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}), ...(init.keepalive ? { keepalive: true } : {}) });
    return { ok: true, json: async () => ({ publicKey: KEY }) };
  }));
  return { calls, subscribe, subscription, listeners };
}

describe("signing a device up", () => {
  it("subscribes with the server's key and sends the subscription with this device's switches", async () => {
    const { calls, subscribe } = installBrowser();
    await expect(enablePush({ finished: false, sounds: true })).resolves.toBe(true);
    const key = subscribe.mock.calls[0]![0].applicationServerKey as Uint8Array;
    expect(key).toHaveLength(65);
    expect(Buffer.from(key).toString("base64url")).toBe(KEY);
    expect(subscribe.mock.calls[0]![0].userVisibleOnly).toBe(true);
    expect(calls).toEqual([
      { method: "GET", path: "/api/push/key" },
      { method: "PUT", path: "/api/push/subscription", body: { subscription: { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p", auth: "a" } }, finished: false, sounds: true } },
    ]);
  });

  it("does nothing without permission, and reuses a subscription the browser already has", async () => {
    installBrowser({ permission: "default" });
    await expect(enablePush({ finished: true, sounds: true })).resolves.toBe(false);
    const { calls, subscribe } = installBrowser({ existing: true });
    await enablePush({ finished: true, sounds: false });
    expect(subscribe).not.toHaveBeenCalled();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["PUT /api/push/subscription"]);
  });

  it("updates the switches and signs out only a device that is signed up", async () => {
    const signedUp = installBrowser({ existing: true });
    await syncPushPreferences({ finished: true, sounds: false });
    await disablePush();
    expect(signedUp.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["PUT /api/push/subscription", "DELETE /api/push/subscription"]);
    expect(signedUp.calls[1]!.body).toEqual({ endpoint: "https://web.push.apple.com/abc" });
    expect(signedUp.subscription.unsubscribe).toHaveBeenCalled();
    const fresh = installBrowser();
    await syncPushPreferences({ finished: true, sounds: true });
    await disablePush();
    expect(fresh.calls).toEqual([]);
  });
});

it("tells the server while this page is visible, beating until it hides", () => {
  vi.useFakeTimers();
  const { calls } = installBrowser();
  const docListeners = new Map<string, () => void>();
  const doc = { visibilityState: "visible", addEventListener: (type: string, fn: () => void) => docListeners.set(type, fn), removeEventListener: vi.fn() };
  vi.stubGlobal("document", doc);
  const stop = startPushPresence();
  vi.advanceTimersByTime(30_000);
  doc.visibilityState = "hidden";
  docListeners.get("visibilitychange")!();
  vi.advanceTimersByTime(60_000);
  expect(calls.map((call) => call.body.visible)).toEqual([true, true, false]);
  expect(new Set(calls.map((call) => call.body.page)).size).toBe(1);
  expect(calls[2]!.keepalive).toBe(true);
  stop();
});

it("routes a click from the worker to the conversation, ignoring other messages", () => {
  const { listeners } = installBrowser();
  const open = vi.fn();
  const stop = onNotificationOpen(open);
  listeners.get("message")!({ data: { type: "other" } });
  listeners.get("message")!({ data: { type: OPEN_NOTIFICATION_MESSAGE, botId: "bot-1", threadId: "thread-1" } });
  expect(open).toHaveBeenCalledExactlyOnceWith({ botId: "bot-1", threadId: "thread-1" });
  stop();
  expect(listeners.size).toBe(0);
});

it("reads the conversation a click opened the app on, and puts the URL back", () => {
  expect(takeNotificationTarget("https://app.nordus.ai/?notification-thread=t-1&notification-bot=b-1&x=1#y")).toEqual({
    target: { botId: "b-1", threadId: "t-1" }, rest: "/?x=1#y",
  });
  expect(takeNotificationTarget("https://app.nordus.ai/?notification-thread=t-1&notification-bot=b-1&notification-request=req-7")).toEqual({
    target: { botId: "b-1", threadId: "t-1", requestId: "req-7" }, rest: "/",
  });
  expect(takeNotificationTarget("https://app.nordus.ai/?notification-thread=t-1")).toBeNull();
  expect(takeNotificationTarget("https://app.nordus.ai/?notification-thread=a%2Fb&notification-bot=b")).toBeNull();
});

describe("the service worker", () => {
  function loadWorker(windows: Array<{ url: string; postMessage: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }> = []) {
    const handlers = new Map<string, (event: any) => void>();
    const shown: Array<{ title: string; options: any }> = [];
    const opened: string[] = [];
    const self = {
      location: new URL("https://app.nordus.ai/sw.js"),
      addEventListener: (type: string, handler: (event: any) => void) => handlers.set(type, handler),
      skipWaiting: vi.fn(),
      registration: { showNotification: async (title: string, options: any) => void shown.push({ title, options }) },
      clients: { claim: vi.fn(), matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) },
    };
    new Function("self", readFileSync(join(__dirname, "../../public/sw.js"), "utf8"))(self);
    const run = async (type: string, event: any) => {
      let work: Promise<unknown> = Promise.resolve();
      handlers.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
      await work;
    };
    return { run, shown, opened };
  }

  it("always shows a banner for a push, with the payload's tag and the conversation", async () => {
    const worker = loadWorker();
    await worker.run("push", { data: { json: () => ({ title: "Ana precisa de você", body: "Aprovar?", tag: "nordus:b-1", botId: "b-1", threadId: "t-1", silent: true }) } });
    await worker.run("push", { data: { json: () => { throw new Error("not json"); }, text: () => "texto" } });
    expect(worker.shown[0]).toEqual({ title: "Ana precisa de você", options: expect.objectContaining({ body: "Aprovar?", tag: "nordus:b-1", silent: true, data: { botId: "b-1", threadId: "t-1" } }) });
    expect(worker.shown[1]).toEqual({ title: "Nordus", options: expect.objectContaining({ body: "texto" }) });
  });

  it("hands a click to the open app, or opens the app on the conversation", async () => {
    const page = { url: "https://app.nordus.ai/", postMessage: vi.fn(), focus: vi.fn(async () => undefined) };
    const withPage = loadWorker([page]);
    const notification = { close: vi.fn(), data: { botId: "b-1", threadId: "t-1" } };
    await withPage.run("notificationclick", { notification });
    expect(notification.close).toHaveBeenCalled();
    expect(page.postMessage).toHaveBeenCalledWith({ type: OPEN_NOTIFICATION_MESSAGE, botId: "b-1", threadId: "t-1" });
    expect(page.focus).toHaveBeenCalled();
    const closed = loadWorker();
    await closed.run("notificationclick", { notification });
    expect(closed.opened).toEqual(["https://app.nordus.ai/?notification-thread=t-1&notification-bot=b-1"]);
  });

  describe("approving from the banner", () => {
    const approval = { id: "t-1.m-1", token: "one-tap", done: { approve: "Aprovado por você · enviado", decline: "Recusado por você" } };
    const push = {
      title: "Atlas quer voltar produção para a v2.14.3", body: "Desfaz o deploy. Pediu a Rafael.", tag: "nordus:b-1", botId: "b-1", threadId: "t-1", requestId: "req-1",
      actions: [{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }], approval,
    };
    const shownBanner = async (payload: object) => {
      const worker = loadWorker();
      await worker.run("push", { data: { json: () => payload } });
      return { worker, banner: worker.shown[0]! };
    };

    it("shows Aprovar and Recusar with the token kept in the banner's own data", async () => {
      const { banner } = await shownBanner(push);
      expect(banner.options.actions).toEqual([{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }]);
      expect(banner.options.data).toMatchObject({ botId: "b-1", threadId: "t-1", requestId: "req-1", approval, title: push.title, tag: "nordus:b-1" });
    });

    it("shows no buttons without a token, and never more than the two it knows", async () => {
      const noToken = await shownBanner({ ...push, approval: undefined });
      expect(noToken.banner.options.actions).toBeUndefined();
      expect(noToken.banner.options.data.approval).toBeUndefined();
      const odd = await shownBanner({ ...push, actions: [{ action: "delete", title: "Apagar" }, { action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }, { action: "approve", title: "De novo" }] });
      expect(odd.banner.options.actions).toEqual([{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }]);
    });

    it("sends the token to the approval's own address as the signed-in person and says so quietly", async () => {
      const { worker, banner } = await shownBanner(push);
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const notification = { close: vi.fn(), data: banner.options.data };
      await worker.run("notificationclick", { notification, action: "approve" });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/approvals/t-1.m-1/approve", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "one-tap" }),
      });
      expect(notification.close).toHaveBeenCalled();
      expect(worker.opened).toEqual([]);
      expect(worker.shown.at(-1)).toEqual({ title: "Aprovado por você · enviado", options: expect.objectContaining({ body: push.title, tag: "nordus:b-1", silent: true }) });
    });

    it("declines the same way", async () => {
      const { worker, banner } = await shownBanner(push);
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await worker.run("notificationclick", { notification: { close: vi.fn(), data: banner.options.data }, action: "decline" });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/approvals/t-1.m-1/decline", expect.objectContaining({ method: "POST" }));
      expect(worker.shown.at(-1)?.title).toBe("Recusado por você");
    });

    it("opens the card instead when the server does not take the tap, or cannot be reached", async () => {
      for (const answer of [() => ({ ok: false, status: 403 }), () => { throw new Error("offline"); }]) {
        const page = { url: "https://app.nordus.ai/", postMessage: vi.fn(), focus: vi.fn(async () => undefined) };
        const worker = loadWorker([page]);
        await worker.run("push", { data: { json: () => push } });
        vi.stubGlobal("fetch", vi.fn(async () => answer()));
        await worker.run("notificationclick", { notification: { close: vi.fn(), data: worker.shown[0]!.options.data }, action: "approve" });
        expect(page.postMessage).toHaveBeenCalledWith({ type: OPEN_NOTIFICATION_MESSAGE, botId: "b-1", threadId: "t-1", requestId: "req-1" });
        expect(worker.shown).toHaveLength(1);
      }
    });

    it("opens the card on a tap on the banner itself, and for any button it does not know, without deciding anything", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      for (const action of [undefined, "", "delete"]) {
        const worker = loadWorker();
        await worker.run("push", { data: { json: () => push } });
        await worker.run("notificationclick", { notification: { close: vi.fn(), data: worker.shown[0]!.options.data }, ...(action === undefined ? {} : { action }) });
        expect(worker.opened, String(action)).toEqual(["https://app.nordus.ai/?notification-thread=t-1&notification-bot=b-1&notification-request=req-1"]);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never decides for a banner that carries no token, such as a critical action's or an iPhone's", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const worker = loadWorker();
      await worker.run("push", { data: { json: () => ({ ...push, approval: undefined, actions: undefined }) } });
      await worker.run("notificationclick", { notification: { close: vi.fn(), data: worker.shown[0]!.options.data }, action: "approve" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(worker.opened).toEqual(["https://app.nordus.ai/?notification-thread=t-1&notification-bot=b-1&notification-request=req-1"]);
    });
  });
});
