// Nordus: banners with the app closed (Web Push), and the click that opens the conversation.
// No fetch handler: the app is always loaded from the network, so this worker never serves a stale page.

const FALLBACK_ICON = "/app-icon-192.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function bannerActions(data) {
  if (!Array.isArray(data.actions)) return [];
  return data.actions
    .filter((entry) => entry && (entry.action === "approve" || entry.action === "decline") && typeof entry.title === "string" && entry.title)
    .slice(0, 2)
    .map((entry) => ({ action: entry.action, title: entry.title }));
}

function bannerApproval(data) {
  const approval = data.approval;
  if (!approval || typeof approval.id !== "string" || typeof approval.token !== "string") return undefined;
  const done = approval.done || {};
  return {
    id: approval.id,
    token: approval.token,
    done: { approve: typeof done.approve === "string" ? done.approve : "", decline: typeof done.decline === "string" ? done.decline : "" },
  };
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Nordus", body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Nordus";
  const approval = bannerApproval(data);
  const actions = approval ? bannerActions(data) : [];
  // Every push shows a banner: Safari drops the subscription of a site that receives pushes and shows none.
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    icon: typeof data.icon === "string" ? data.icon : FALLBACK_ICON,
    badge: FALLBACK_ICON,
    silent: data.silent === true,
    ...(actions.length ? { actions } : {}),
    data: { botId: data.botId, threadId: data.threadId, requestId: data.requestId, ...(approval ? { approval, title, tag: data.tag } : {}) },
  }));
});

async function decideFromBanner(data, action) {
  const approval = data.approval;
  if (!approval || (action !== "approve" && action !== "decline")) return false;
  try {
    const response = await fetch(`/api/approvals/${encodeURIComponent(approval.id)}/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: approval.token }),
    });
    if (!response.ok) return false;
  } catch {
    return false;
  }
  const said = approval.done[action];
  if (said) {
    await self.registration.showNotification(said, {
      body: typeof data.title === "string" ? data.title : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: FALLBACK_ICON,
      badge: FALLBACK_ICON,
      silent: true,
    });
  }
  return true;
}

async function openConversation({ botId, threadId, requestId }) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
  if (open) {
    // The page knows how to open a conversation in place; a reload would lose what is on screen.
    open.postMessage({ type: "nordus:open-notification", botId, threadId, requestId });
    await open.focus();
    return;
  }
  const url = new URL("/", self.location.origin);
  if (typeof threadId === "string" && threadId) url.searchParams.set("notification-thread", threadId);
  if (typeof botId === "string" && botId) url.searchParams.set("notification-bot", botId);
  if (typeof requestId === "string" && requestId) url.searchParams.set("notification-request", requestId);
  await self.clients.openWindow(url.href);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    if (event.action && await decideFromBanner(data, event.action)) return;
    await openConversation(data);
  })());
});
