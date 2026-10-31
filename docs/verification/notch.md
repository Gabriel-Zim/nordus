# Agents in the Mac notch

On macOS the desktop app shows what the agents are doing at the top of the
screen, around the notch. Nothing is visible while nobody works. When an agent
starts, its avatar appears on the left of the notch and a short status on the
right (several agents: stacked avatars and a count). When an agent needs a
simple approval the notch grows downward with a plain sentence and Aprovar /
Recusar. Only an ordinary permission can be answered there: no payload to review
(no `...Request` on the card, so no outbound send, team memory, routine, skill,
profile, model, setting, helper connection, lesson or any kind added later), no
hold of ours (only the provider's own, `approval.held.native`, or none), not a
question and not expired. Everything else, including a card the notch cannot
describe in one sentence, only offers "Abrir no app", which opens that
conversation. The rule is one pure function, `decidableFromNotch` in
`src/lib/notch-feed.ts`. When the work ends it says "Pronto" for a moment and
hides. A tap on the avatar or the status opens the conversation.

A request has to be on screen for 0.7 s (`NOTCH_ARM_MS`) before a tap on it
counts. The page keeps its buttons disabled for that time each time a request
appears or changes, or the window comes back on screen, and the controller in the
main process refuses a decision earlier than that after it put the request on
screen. A tap meant for the request just answered, or for what lies behind the
window as it grows, therefore never answers the next one unread.

When the page that publishes starts or commits a navigation (for example a switch
to a remote workspace) or goes away, the notch clears at once; the old workspace's
agents and requests do not stay on screen.

On a Mac without a notch, or when the person turns it on there, it is a small
pill under the menu bar of the main display. It is on by default only on a Mac
with a notch; Settings, Notifications has "Mostrar agentes no notch".

It never takes focus: the window is a non-focusable panel, always on top, on
every Space, and `activate` ignores it when deciding whether to reopen the app.

## How it is built

- `electron/notch-state.mjs`: the pure machine (idle, working, approval, done)
  that turns the published snapshot into what to draw.
- `electron/notch-placement.mjs`: which display, notched or not, and the bounds.
  Electron has no safe-area API, so a notch is the built-in display with a menu
  bar of 28 points or more, or one remembered with such a bar, or a panel shaped
  like the notched MacBook panels.
- `electron/notch-ipc.mjs`: channel names and validation of everything that
  crosses (snapshots, decisions, text cleaning, caps, ids).
- `electron/notch.mjs`: the controller that owns the window; `notch-prefs.mjs`
  keeps the on/off choice in `notch.json`.
- `electron/notch.html`, `notch.css`, `notch-page.js`, `notch-preload.cjs`: the
  window. It only paints a view and sends back `decide`, `open` and `ready`; it
  carries no secret and answers nothing itself.
- `src/lib/notch-feed.ts`, `src/hooks/use-notch-feed.ts`: the main window builds
  the snapshot from its own state and, when a decision comes back, dispatches
  the same `decideRequest` action the approval card uses. No new route, token or
  session.

## Checks

```sh
node --test electron/notch-state.node-test.mjs electron/notch-placement.node-test.mjs electron/notch-ipc.node-test.mjs electron/notch.node-test.mjs electron/notch-page.node-test.mjs electron/notch-preload.node-test.mjs electron/single-instance.node-test.mjs
pnpm exec vitest run src/lib/notch-feed.test.ts src/hooks/use-notch-feed.test.ts src/components/NotchSettingsRow.test.ts
pnpm i18n:check
node scripts/verify-notch.mjs
```

The last command opens the real notch window in a disposable Electron profile.
By default it never shows it on screen (it still renders and is captured); a
screenshot of each phase is kept in the evidence directory it names. Add `--show`
on a Mac to watch the same sequence at the top of the screen and tap Aprovar or
Recusar yourself.

| Behavior | Checked by |
|---|---|
| Idle, working, approval, done and back; short work never shows; several agents; the approval stays on one request until it is answered | `electron/notch-state.node-test.mjs` |
| Notch versus pill, built-in display with an external monitor, display on the left of the primary, hidden menu bar, scaled modes, window kept inside the display | `electron/notch-placement.node-test.mjs` |
| Every message crossing the IPC: strict shapes, caps, text cleaning, colors, references, decisions, only the notch window's own top frame | `electron/notch-ipc.node-test.mjs` |
| The window and its policies, answers going back to the page that published, a request that cannot be answered from the notch, duplicates, the 0.7 s wait before a tap counts (first appearance, a replacing request, a request that returns, the window coming back from full-screen), clearing when the publishing page starts or commits a navigation or goes away, display changes, full-screen, on/off and the default, closing | `electron/notch.node-test.mjs` |
| The notch page's buttons: disabled until the first drawing, 0.7 s wait for each request and each appearance, the 4 s lock after a tap that the next request does not inherit, the open button waiting too | `electron/notch-page.node-test.mjs` |
| The notch page's bridge exposes only `onView`, `decide` and `open` | `electron/notch-preload.node-test.mjs` |
| The notch window is not the app's window when the app is reactivated | `electron/single-instance.node-test.mjs` |
| What the snapshot says, which approvals can be answered from the notch (outbound send, opaque connected-app code, team memory, sandbox and other holds, unknown payloads, questions and expired cards stay with the app), and the decision dispatched back | `src/lib/notch-feed.test.ts`, `src/hooks/use-notch-feed.test.ts` |
| The setting row appears only in the Mac desktop app and says plainly when there is no notch | `src/components/NotchSettingsRow.test.ts` |
| In real Electron: the flags that matter really took effect (not focusable, always on top, every Space, not movable), top-of-display placement with the gap centered on the display, the page policy (no inline or remote script, no Node), draw, a tap in the first moments refused from the page and from the window, decide, open and hide, turning it off | `scripts/verify-notch.mjs` |

## Not checked

The fixture does not put the window on screen by default, so these are not
proven and need a person on a Mac:

- That the window is really visible around the notch, and how it looks there.
- That clicking it does not take focus from the app in front, and that the first
  click lands (`acceptFirstMouse`).
- That it goes away over a full-screen app and across Spaces. The window asks
  for that and the controller also hides it when the menu bar is gone, but no
  full-screen app was used.
- Several displays, plugging and unplugging, and sleep and wake.
- Other Macs and scaled display modes. The placement was measured on one 14-inch
  MacBook Pro in its default mode (display 1512x982, menu bar 33 points). The
  notch width is a fixed 212 points; a more scaled mode makes the real notch
  wider or narrower than that.
- A Mac whose menu bar is set to hide automatically: the notch is then found only
  by the panel's shape.
- The full path with a real agent: the notch is fed by the main window, so with
  the main window closed (the app stays in the Dock) it stays quiet.
- Approvals asked inside rooms and group chats: only each agent's own
  conversations were considered and tested.
- How 0.7 s feels on a real tap, and that no tap lands on what is behind the
  window while it grows: the wait is proven with a fake clock and with the hidden
  window, not with a person.
- A card with `approvalScope: "local-computer"` is still answered from the notch
  like an ordinary permission; whether it should stay with the app is open.

Manual pass on a Mac with a notch: `node scripts/verify-notch.mjs --show`, then
the app itself: turn the setting on, start an agent in one conversation and
another in a second, ask one of them to do something that needs approval,
approve from the notch, tap the avatar to open the conversation, enter and leave
a full-screen app, and turn the setting off.
