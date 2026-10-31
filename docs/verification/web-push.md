# Banners with the app closed (Web Push)

The page registers `/sw.js` on load. Turning on Settings → Notifications (or
opening the app with banners already allowed) subscribes the device with the
server's VAPID key and stores the subscription under its paired session, with
the device's own switches (finished work, sounds). The server keeps the keys in
`web-push-vapid.json` and the subscriptions in `web-push-subscriptions.json`,
both mode 0600 in the data folder.

Every `notify` frame the live stream carries is also pushed, with the same
rules as the page's banner (`shared/notification-banner.ts`): normal news waits
for the daily summary, finished work only where the switch is on, spend alerts
only to admins, members only for bots and rooms they can see. A device whose
page is open and visible reports a heartbeat (`POST /api/push/presence`) and
gets no push, since the page shows its own banner; a page that stops beating
counts as gone after 75 seconds. Banners from the page go through the worker
with the same tag, so one that arrives both ways shows once. A click opens the
conversation in the open window, or opens the app on it.

Endpoints must be a known push service (Apple, Google, Mozilla, Microsoft):
the server POSTs to them. A 404 or 410 from the push service drops the
subscription, and so does revoking the session.

## Isolated checks

```sh
pnpm exec vitest run server/web-push.test.ts src/lib/web-push.test.ts src/lib/notify.test.ts
pnpm exec vitest run server/web-push.e2e.test.ts
```

The end-to-end test starts the real server with a fake engine and a fake push
service on loopback (`NORDUS_WEB_PUSH_TEST_ORIGIN=http://127.0.0.1:PORT`, accepted
only in that exact form). It checks that no push is sent while the page is
visible, that the push after it hides decrypts (RFC 8291) to the frame's title,
body, tag and conversation, that its VAPID JWT verifies against
`/api/push/key`, and that a 410 removes the subscription. Nothing leaves the
machine and no real data folder is used. The unit test pins the encryption to
RFC 8291's worked example byte for byte.

## On a phone

Physical-device qualification, with a disposable workspace: on iOS 16.4 or
later add the app to the Home Screen, open it from the icon, turn on
Notifications in Settings and allow. Send the app to the background, have a bot
finish or ask for approval, and confirm one banner that opens the right
conversation. With the app in front, confirm the page's banner only.

## The native iPhone app (APNs)

The native app has no Web Push in its web view. It registers its APNs device
token with `POST /api/push/apns {token, ambiente: "sandbox"|"producao"}` (and
`DELETE` with `{token}`), stored per paired session in `apns-devices.json`
(0600). The same notify frames, rules and open-page check apply; the payload is
`aps.alert {title, body}`, `aps.badge` (unread conversations this device can
see), `aps.sound` unless sounds are off, and `botId`/`threadId` to open the
conversation. APNs stays off, with no errors, until `apns.json` exists in the
data folder: `{keyId, teamId, bundleId, keyPath}`, with `keyPath` pointing at
the `.p8` key (relative to the data folder). It is read on every send, so
adding it needs no restart. A 410, `BadDeviceToken` or `DeviceTokenNotForTopic`
drops the token.

```sh
pnpm exec vitest run server/apns.test.ts
```
