# Live updates that survive restarts and long gaps

## Problem

A device that loses its event stream for longer than the replay buffer, or across any server restart, downloads the whole workspace again. On production that is 1.4 MB of JSON (270 KB brotli) with every bot, every task and 60 messages per conversation, and the reducer replaces every message array, so the whole screen re-renders.

Measured on production (19 Oct 2026):

- Runtime deltas are merged by the bus before broadcast, so one working bot sends about 1 frame per second. The 500-frame buffer lasts about 8 minutes with one bot and about 1 minute with an 8-bot team. Screen captures also take buffer slots.
- The stream id is random per process, so every deploy sends every connected device into a full snapshot.
- The thin bot list (`/api/bots?messages=0`) is 210 KB raw, 41 KB brotli.

## Data shapes

- **Cursor** `streamId:seq`. `streamId` lives in `messages.db` and survives restarts. `seq` is monotonic across restarts: each boot starts at `max(reserved, Date.now())`, and a block of seqs is reserved on disk before it is handed out, so a crash or a restored backup never reuses a seq.
- **Replay ring**. The same in-memory ring of frames as today, bounded at 2 MB or 5,000 frames instead of 500 frames, without screen captures. A cursor is replayable while it is at or above the ring floor. Past those bounds a delta snapshot costs a device less than replaying every frame.
- **Thread change index** `thread_changes(thread_id, seq)` in `messages.db`. Every message write (append, update, import, branch leaf) files its thread under the stream's next seq in the same transaction, so a change made without a frame (at boot, by an import) is indexed too.
- **Delta snapshot** `GET /api/bots?messages=60&since=<cursor>&held=<threadIds>`. Every visible bot and room as today, but a conversation's messages are included only when its thread changed after `since` or the device does not hold that thread. The response carries `cursor` (the seq it reflects) and `delta: true`. A page it carries replaces what the device held.

## Protocol

1. The device connects with its cursor. Inside the ring it gets an exact replay (`resumed: true`), as today.
2. Outside the ring (long gap, restart, deploy) it gets `resumed: false` and asks for a delta snapshot from its cursor. Only a cursor from another stream id, or one newer than the server's last seq, gets a full snapshot.
3. `hello` carries the page build the server is serving. A page from an older build reloads itself the next time it is hidden, and at once if a lazy chunk fails and fetching `/` confirms a newer page. Never during a call or an upload, and once per build per tab in 10 minutes.
4. A missing `/assets/` file is a 404, not the app's HTML.
5. Coming back to a hidden page reconnects at once with the cursor instead of waiting up to 40 s for the staleness timer.

## Alternatives considered

- **Persist every frame to disk and replay across restarts.** Rejected. A restart changes in-memory state (busy flags, live turns) without emitting frames, so an exact replay across a restart leaves devices showing bots as working forever. It also writes every bot frame (about 5 KB) to disk.
- **Track changes per bot and group too.** Rejected for now. Within the ring the replay is already exact, and the delta path runs mostly after restarts, when every bot has to be resent anyway.
- **WebSocket.** Out of scope. Traffic is server to device; SSE already passes Cloudflare.

## Scenarios proven

Server restart, a publish with a page from the previous build, a device away for 2 minutes while frames flow, and a dropped connection. `scripts/live-sync-probe.ts` replays each against a running server and reports full versus delta snapshots, bytes and the time until the device is current.
