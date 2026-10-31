#!/usr/bin/env node
// Replays live-sync scenarios (latency, restart, away, drop, assets) against a running server through this
// worktree's own client transport, and reports full vs delta snapshots, bytes and time until each device is current.
// Usage: node scripts/live-sync-probe.ts --base http://127.0.0.1:PORT --scenario NAME [--restart-cmd "<shell>"] [--out file.json]
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import { openLiveEvents, type LiveEventSourceLike, type LiveFrame } from "../src/lib/live-events.ts";

const { values: args } = parseArgs({
  options: {
    base: { type: "string" },
    scenario: { type: "string" },
    "restart-cmd": { type: "string" },
    out: { type: "string" },
    thread: { type: "string" },
    "away-seconds": { type: "string", default: "120" },
    "away-rate": { type: "string", default: "8" },
    "drop-rate": { type: "string", default: "4" },
  },
});
const BASE = (args.base ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(BASE) || !args.scenario) {
  console.error("usage: node scripts/live-sync-probe.ts --base http://127.0.0.1:PORT --scenario latency|restart|away|drop|assets [--restart-cmd CMD] [--out FILE]");
  process.exit(2);
}

const THUMB = "👍";
const SNAPSHOT_PATH = "/api/bots?messages=60";

interface WireMessage { id: string; at?: number; reactions?: Array<{ emoji: string; by: string }> }
interface Owner { id: string; threadId: string; unread?: boolean; messages?: WireMessage[] }
interface Snapshot { bots: Owner[]; groups?: Owner[]; delta?: boolean; cursor?: string }
type Frame = LiveFrame & { seq?: number; bot?: Owner; group?: Owner; botId?: string; groupId?: string; threadId?: string; message?: WireMessage };

interface SnapshotRecord {
  phase: string;
  since: string | null;
  held: number;
  delta: boolean;
  status: number;
  rawBytes: number;
  brotliBytes?: number;
  brotliQ4Bytes?: number;
  msRequestToApplied: number;
  requestedAt: number;
  appliedAt: number;
  body?: Buffer;
}

interface Connection {
  helloAt: number;
  cursor: string;
  resumed: boolean;
  build?: unknown;
  snapshot?: SnapshotRecord;
  currentAt?: number;
}

const now = () => performance.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (ms: number) => Math.round(ms * 10) / 10;
const seqOf = (cursor: string | null | undefined) => {
  const tail = cursor?.split(":").pop();
  return tail && /^\d+$/.test(tail) ? Number(tail) : null;
};
const hasThumb = (message: WireMessage | undefined) => Boolean(message?.reactions?.some((r) => r.emoji === THUMB && r.by === "user"));

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function percentiles(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return sorted.length
    ? { n: sorted.length, p50: round(rank(0.5)), p95: round(rank(0.95)), max: round(sorted[sorted.length - 1]), min: round(sorted[0]) }
    : { n: 0 };
}

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(BASE + path, {
    method,
    headers: { origin: BASE, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.json() as Promise<T>;
}

const fullSnapshot = () => api<Snapshot>("GET", SNAPSHOT_PATH);
const toggleReaction = (threadId: string, messageId: string) =>
  api<{ message: WireMessage }>("POST", `/api/threads/${threadId}/messages/${messageId}/reactions`, { emoji: THUMB });
const setUnread = (botId: string, unread: boolean) => api("PATCH", `/api/bots/${botId}`, { unread });

interface ProbeSource extends LiveEventSourceLike {
  killSilently: () => void;
  killLoudly: () => void;
}

/** EventSource over fetch streaming: `lastEventId` persists across events as the spec says, and a hello is reported before delivery. */
function fetchEventSource(url: string, onData: (data: string, lastEventId: string) => void): ProbeSource {
  const controller = new AbortController();
  let state: "open" | "closed" | "silent" = "open";
  let lastEventId = "";
  const fail = () => {
    if (state !== "open") return;
    state = "closed";
    controller.abort();
    source.onerror?.();
  };
  const source: ProbeSource = {
    onopen: null,
    onerror: null,
    onmessage: null,
    close: () => {
      if (state === "open") state = "closed";
      controller.abort();
    },
    killSilently: () => {
      if (state === "open") state = "silent";
      controller.abort();
    },
    killLoudly: fail,
  };
  const dispatch = (block: string) => {
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "id") lastEventId = value;
      else if (field === "data") data.push(value);
    }
    if (!data.length || state !== "open") return;
    const payload = data.join("\n");
    onData(payload, lastEventId);
    source.onmessage?.({ data: payload, lastEventId });
  };
  void (async () => {
    try {
      const response = await fetch(url, { headers: { accept: "text/event-stream", origin: BASE }, signal: controller.signal });
      if (!response.ok || !response.body) return fail();
      if (state !== "open") return;
      source.onopen?.();
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        if (state !== "open") return;
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, "\n");
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          dispatch(buffer.slice(0, split));
          buffer = buffer.slice(split + 2);
        }
      }
      fail();
    } catch {
      fail();
    }
  })();
  return source;
}

type Waiter = { match: (frame: Frame) => boolean; resolve: (at: number) => void };

/** One device: the worktree's transport plus a model of bots by id and messages by thread and id. */
function openDevice(name: string) {
  let bots = new Map<string, Owner>();
  let threads = new Map<string, Map<string, WireMessage>>();
  let cursor: string | null = null;
  let visible = true;
  let source: ProbeSource | null = null;
  let phase = "initial";
  let snapshotsInFlight = 0;
  let duringSnapshot: Frame[] = [];
  let lastSeq = 0;
  const received = new Set<number>();
  const seqGaps: Array<{ after: number; missing: number; at: number }> = [];
  const connections: Connection[] = [];
  const snapshots: SnapshotRecord[] = [];
  const waiters: Waiter[] = [];
  const visibilityListeners = new Set<() => void>();
  const sourceCreatedAt: number[] = [];
  let framesApplied = 0;

  const markCurrent = () => {
    const connection = connections.at(-1);
    if (!connection || connection.currentAt !== undefined) return;
    if (connection.resumed) {
      const target = seqOf(connection.cursor);
      if (target === null || Math.max(lastSeq, seqOf(cursor) ?? 0) >= target) connection.currentAt = now();
    } else if (connection.snapshot) {
      connection.currentAt = connection.snapshot.appliedAt;
    }
  };

  const keepMessages = (threadId: string, messages: WireMessage[] | undefined) => {
    if (Array.isArray(messages)) threads.set(threadId, new Map(messages.map((message) => [message.id, message])));
  };

  const apply = (frame: Frame) => {
    switch (frame.kind) {
      case "bot":
        if (frame.bot) {
          const { messages, ...bot } = frame.bot;
          bots.set(bot.id, bot);
          keepMessages(bot.threadId, messages);
        }
        break;
      case "group":
        if (frame.group) keepMessages(frame.group.threadId, frame.group.messages);
        break;
      case "bot.deleted":
        if (frame.botId) bots.delete(frame.botId);
        break;
      case "message":
      case "message.patch":
        if (frame.threadId && frame.message) {
          const thread = threads.get(frame.threadId) ?? new Map<string, WireMessage>();
          thread.set(frame.message.id, frame.message);
          threads.set(frame.threadId, thread);
        }
        break;
    }
  };

  const onFrame = (raw: LiveFrame) => {
    const frame = raw as Frame;
    const at = now();
    if (typeof frame.seq === "number") {
      if (lastSeq && frame.seq > lastSeq + 1) seqGaps.push({ after: lastSeq, missing: frame.seq - lastSeq - 1, at });
      lastSeq = Math.max(lastSeq, frame.seq);
      received.add(frame.seq);
    }
    apply(frame);
    framesApplied += 1;
    if (snapshotsInFlight) duringSnapshot.push(frame);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (!waiters[i].match(frame)) continue;
      waiters.splice(i, 1)[0].resolve(at);
    }
    markCurrent();
  };

  const snapshot = async (since: string | null): Promise<boolean> => {
    const held = [...threads.keys()];
    const params = new URLSearchParams({ messages: "60" });
    if (since) params.set("since", since);
    if (held.length) params.set("held", held.join(","));
    const requestedAt = now();
    snapshotsInFlight += 1;
    try {
      const response = await fetch(`${BASE}/api/bots?${params}`, { headers: { origin: BASE, "accept-encoding": "identity" } });
      const body = Buffer.from(await response.arrayBuffer());
      if (!response.ok) {
        snapshots.push({ phase, since, held: held.length, delta: false, status: response.status, rawBytes: body.length, msRequestToApplied: round(now() - requestedAt), requestedAt, appliedAt: now() });
        return false;
      }
      const parsed = JSON.parse(body.toString("utf8")) as Snapshot;
      const delta = parsed.delta === true;
      const nextBots = new Map<string, Owner>();
      const nextThreads = new Map<string, Map<string, WireMessage>>();
      for (const owner of [...parsed.bots, ...(parsed.groups ?? [])]) {
        if (Array.isArray(owner.messages)) nextThreads.set(owner.threadId, new Map(owner.messages.map((m) => [m.id, m])));
        else if (delta && threads.has(owner.threadId)) nextThreads.set(owner.threadId, threads.get(owner.threadId)!);
      }
      for (const { messages: _messages, ...bot } of parsed.bots) nextBots.set(bot.id, bot);
      bots = nextBots;
      threads = nextThreads;
      // Frames that arrived while the request was in flight may be newer than the snapshot: replay them in order.
      for (const frame of duringSnapshot) apply(frame);
      const appliedAt = now();
      const record: SnapshotRecord = { phase, since, held: held.length, delta, status: response.status, rawBytes: body.length, msRequestToApplied: round(appliedAt - requestedAt), requestedAt, appliedAt, body };
      snapshots.push(record);
      const connection = connections.at(-1);
      if (connection && !connection.resumed && !connection.snapshot && connection.helloAt <= requestedAt) {
        connection.snapshot = record;
        const stream = (value: string | null) => value?.split(":")[0];
        if (!cursor || stream(cursor) !== stream(connection.cursor) || (seqOf(cursor) ?? 0) < (seqOf(connection.cursor) ?? 0)) cursor = connection.cursor;
      }
      markCurrent();
      return true;
    } catch {
      return false;
    } finally {
      snapshotsInFlight -= 1;
      if (!snapshotsInFlight) duringSnapshot = [];
    }
  };

  const stop = openLiveEvents(
    {
      onFrame,
      onSnapshotRequired: (since?: string | null) => snapshot(since ?? cursor),
    },
    {
      createEventSource: (path) => {
        sourceCreatedAt.push(now());
        const created = fetchEventSource(BASE + path, (data, lastEventId) => {
          let frame: Frame;
          try { frame = JSON.parse(data); } catch { return; }
          if (frame.kind === "hello") {
            connections.push({ helloAt: now(), cursor: String(frame.cursor ?? ""), resumed: frame.resumed === true, ...("build" in frame ? { build: (frame as { build?: unknown }).build } : {}) });
            markCurrent();
          } else if (lastEventId) {
            cursor = lastEventId;
          }
        });
        source = created;
        return created;
      },
      documentTarget: {
        addEventListener: (type, listener) => { if (type === "visibilitychange") visibilityListeners.add(listener); },
        removeEventListener: (type, listener) => { if (type === "visibilitychange") visibilityListeners.delete(listener); },
      },
      windowTarget: { addEventListener: () => {}, removeEventListener: () => {} },
      isVisible: () => visible,
      isOnline: () => true,
    },
  );

  return {
    name,
    connections,
    snapshots,
    seqGaps,
    sourceCreatedAt,
    get bots() { return bots; },
    get threads() { return threads; },
    get lastSeq() { return lastSeq; },
    get knownSeq() { return Math.max(lastSeq, seqOf(cursor) ?? 0); },
    /** Seqs in (from, to] on this stream the device never got as a frame: zero after an exact replay, everything after a snapshot. */
    missedBetween(from: number, to: number): number | null {
      if (!from || to < from || to - from > 1_000_000) return null;
      let missing = 0;
      for (let seq = from + 1; seq <= to; seq++) if (!received.has(seq)) missing += 1;
      return missing;
    },
    get framesApplied() { return framesApplied; },
    setPhase(next: string) { phase = next; },
    hide() { visible = false; for (const listener of visibilityListeners) listener(); },
    show() { visible = true; for (const listener of visibilityListeners) listener(); },
    killSilently() { source?.killSilently(); },
    killLoudly() { source?.killLoudly(); },
    waitFor(match: (frame: Frame) => boolean, timeoutMs = 15_000): Promise<number | null> {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) waiters.splice(index, 1);
          resolve(null);
        }, timeoutMs);
        const waiter: Waiter = { match, resolve: (at) => { clearTimeout(timer); resolve(at); } };
        waiters.push(waiter);
      });
    },
    async waitCurrent(after: number, timeoutMs = 60_000): Promise<Connection | null> {
      const deadline = now() + timeoutMs;
      while (now() < deadline) {
        const connection = connections.findLast((candidate) => candidate.helloAt >= after);
        if (connection?.currentAt !== undefined) return connection;
        await sleep(20);
      }
      return null;
    },
    close: stop,
  };
}
type Device = ReturnType<typeof openDevice>;

function deviceMismatches(device: { bots: Map<string, Owner>; threads: Map<string, Map<string, WireMessage>> }, fresh: Snapshot, threadId: string): string[] {
  const problems: string[] = [];
  const freshBots = new Map(fresh.bots.map((bot) => [bot.id, bot]));
  for (const [id, bot] of freshBots) {
    const held = device.bots.get(id);
    if (!held) problems.push(`bot ${id} missing`);
    else if (Boolean(held.unread) !== Boolean(bot.unread)) problems.push(`bot ${id} unread ${Boolean(held.unread)} != ${Boolean(bot.unread)}`);
  }
  for (const id of device.bots.keys()) if (!freshBots.has(id)) problems.push(`bot ${id} extra`);
  const page = [...fresh.bots, ...(fresh.groups ?? [])].find((owner) => owner.threadId === threadId)?.messages ?? [];
  const held = device.threads.get(threadId) ?? new Map<string, WireMessage>();
  for (const message of page) {
    const mine = held.get(message.id);
    if (!mine) problems.push(`message ${message.id} missing`);
    else if (canonical(mine) !== canonical(message)) problems.push(`message ${message.id} differs`);
  }
  const oldest = Math.min(...page.map((message) => message.at ?? Infinity));
  for (const [id, message] of held) {
    if (!page.some((candidate) => candidate.id === id) && (message.at ?? 0) >= oldest) problems.push(`message ${id} extra`);
  }
  return problems;
}

/** The comparator must catch a flipped unread flag and an altered reaction, or its `true` means nothing. */
function controlsDetect(device: Device, fresh: Snapshot, threadId: string, messageId: string) {
  const clone = () => ({
    bots: new Map([...device.bots].map(([id, bot]) => [id, { ...bot }])),
    threads: new Map([...device.threads].map(([id, thread]) => [id, new Map(thread)])),
  });
  const flipped = clone();
  const [firstId, firstBot] = [...flipped.bots][0] ?? [];
  if (firstId) flipped.bots.set(firstId, { ...firstBot!, unread: !firstBot!.unread });
  const altered = clone();
  const message = altered.threads.get(threadId)?.get(messageId);
  if (message) {
    altered.threads.get(threadId)!.set(messageId, { ...message, reactions: hasThumb(message) ? [] : [{ emoji: THUMB, by: "user" }] });
  }
  return {
    flippedUnreadDetected: deviceMismatches(flipped, fresh, threadId).length > 0,
    alteredReactionDetected: deviceMismatches(altered, fresh, threadId).length > 0,
  };
}

async function consistency(devices: Device[], threadId: string, messageId: string) {
  await sleep(1_000);
  const fresh = await fullSnapshot();
  return Object.fromEntries(devices.map((device) => {
    const problems = deviceMismatches(device, fresh, threadId);
    return [device.name, { consistent: problems.length === 0, problems: problems.slice(0, 10), controls: controlsDetect(device, fresh, threadId, messageId) }];
  }));
}

async function peekHello(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { source.close(); reject(new Error("no hello within 10 s")); }, 10_000);
    const source = fetchEventSource(`${BASE}/api/events`, (data) => {
      const frame = JSON.parse(data);
      if (frame.kind !== "hello") return;
      clearTimeout(timer);
      source.close();
      resolve(frame);
    });
  });
}

async function pickTarget() {
  const snapshot = await fullSnapshot();
  const owners = [...snapshot.bots, ...(snapshot.groups ?? [])];
  const owner = args.thread
    ? owners.find((candidate) => candidate.threadId === args.thread)
    : [...snapshot.bots].sort((a, b) => (b.messages?.length ?? 0) - (a.messages?.length ?? 0))[0];
  const message = owner?.messages?.at(-1);
  if (!owner || !message) throw new Error("no target thread with messages; pass --thread");
  return { threadId: owner.threadId, messageId: message.id, initialThumb: hasThumb(message), snapshot };
}

async function openReady(names: string[]): Promise<Device[]> {
  const devices = names.map(openDevice);
  for (const device of devices) {
    if (!(await device.waitCurrent(0, 60_000))) throw new Error(`${device.name} never loaded its first snapshot`);
    device.setPhase("measured");
  }
  return devices;
}

function snapshotSummary(records: SnapshotRecord[]) {
  for (const record of records) {
    if (!record.body) continue;
    record.brotliBytes = brotliCompressSync(record.body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }).length;
    record.brotliQ4Bytes = brotliCompressSync(record.body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } }).length;
  }
  return {
    full: records.filter((record) => !record.delta).length,
    delta: records.filter((record) => record.delta).length,
    rawBytes: records.reduce((sum, record) => sum + record.rawBytes, 0),
    brotliBytes: records.reduce((sum, record) => sum + (record.brotliBytes ?? 0), 0),
    brotliQ4Bytes: records.reduce((sum, record) => sum + (record.brotliQ4Bytes ?? 0), 0),
    requests: records.map(({ body: _body, requestedAt: _requested, appliedAt: _applied, ...rest }) => rest),
  };
}

const measured = (device: Device) => device.snapshots.filter((record) => record.phase === "measured");

/** Bot unread toggles round-robin with every fifth injection a reaction toggle, at `rate` per second until `stopAt`. */
async function inject(rate: number, durationMs: number, bots: string[], target: { threadId: string; messageId: string }) {
  const unread = new Map<string, boolean>();
  const startedAt = now();
  let count = 0;
  let errors = 0;
  while (now() - startedAt < durationMs) {
    const due = startedAt + (count * 1000) / rate;
    if (due > now()) await sleep(due - now());
    try {
      if (count % 5 === 4) await toggleReaction(target.threadId, target.messageId);
      else {
        const botId = bots[count % bots.length];
        const next = !unread.get(botId);
        unread.set(botId, next);
        await setUnread(botId, next);
      }
    } catch {
      errors += 1;
    }
    count += 1;
  }
  const elapsed = now() - startedAt;
  return { injections: count, errors, seconds: round(elapsed / 1000), ratePerSecond: round(count / (elapsed / 1000)) };
}

async function restore(initial: Snapshot, target: { threadId: string; messageId: string; initialThumb: boolean }) {
  const fresh = await fullSnapshot();
  const was = new Map(initial.bots.map((bot) => [bot.id, Boolean(bot.unread)]));
  let restored = 0;
  for (const bot of fresh.bots) {
    if (was.has(bot.id) && Boolean(bot.unread) !== was.get(bot.id)) {
      await setUnread(bot.id, was.get(bot.id)!);
      restored += 1;
    }
  }
  const message = [...fresh.bots, ...(fresh.groups ?? [])].find((owner) => owner.threadId === target.threadId)?.messages?.find((m) => m.id === target.messageId);
  if (hasThumb(message) !== target.initialThumb) {
    await toggleReaction(target.threadId, target.messageId);
    restored += 1;
  }
  return restored;
}

async function latency() {
  const target = await pickTarget();
  const [first, second] = await openReady(["device1", "device2"]);
  const samples: Array<{ device1: number | null; device2: number | null; post: number }> = [];
  let thumb = target.initialThumb;
  for (let i = 0; i < 20; i++) {
    const expected = !thumb;
    const match = (frame: Frame) => frame.kind === "message.patch" && frame.message?.id === target.messageId && hasThumb(frame.message) === expected;
    const arrivals = [first.waitFor(match), second.waitFor(match)];
    const sentAt = now();
    await toggleReaction(target.threadId, target.messageId);
    const post = now() - sentAt;
    const [one, two] = await Promise.all(arrivals);
    samples.push({ device1: one === null ? null : round(one - sentAt), device2: two === null ? null : round(two - sentAt), post: round(post) });
    thumb = expected;
    await sleep(500);
  }
  const restored = await restore(target.snapshot, target);
  first.close();
  second.close();
  return {
    target: { threadId: target.threadId, messageId: target.messageId },
    measuredFrom: "just before the POST that toggles the reaction to the message.patch frame applied on the device",
    device2: percentiles(samples.flatMap((sample) => (sample.device2 === null ? [] : [sample.device2]))),
    device1: percentiles(samples.flatMap((sample) => (sample.device1 === null ? [] : [sample.device1]))),
    postRoundTrip: percentiles(samples.map((sample) => sample.post)),
    lost: samples.filter((sample) => sample.device2 === null).length,
    samples,
    restored,
  };
}

async function healthy(): Promise<boolean> {
  try { return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
}

async function restart() {
  if (!args["restart-cmd"]) throw new Error("restart needs --restart-cmd");
  const target = await pickTarget();
  const devices = await openReady(["device1", "device2", "device3"]);
  const before = await peekHello();
  let downAt: number | null = null;
  let healthyAt: number | null = null;
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const ok = await healthy();
      if (!ok && downAt === null) downAt = now();
      if (ok && downAt !== null && healthyAt === null) healthyAt = now();
      await sleep(100);
    }
  })();
  const commandStartedAt = now();
  const exitCode = await new Promise<number | null>((resolve) => {
    const child = spawn(args["restart-cmd"]!, { shell: true, stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", resolve);
  });
  const commandMs = now() - commandStartedAt;
  const settleDeadline = now() + 30_000;
  while (healthyAt === null && now() < settleDeadline) await sleep(50);
  polling = false;
  await poller;
  if (downAt === null || healthyAt === null) throw new Error(`restart not observed (down ${downAt}, healthy ${healthyAt}, exit ${exitCode})`);
  const after = await peekHello();
  const perDevice: Record<string, unknown> = {};
  for (const device of devices) {
    const connection = await device.waitCurrent(downAt, 60_000);
    perDevice[device.name] = {
      resumed: connection?.resumed ?? null,
      reconnectedAfterHealthyMs: connection ? round(connection.helloAt - healthyAt) : null,
      msHealthyToCurrent: connection?.currentAt !== undefined ? round(connection.currentAt - healthyAt) : null,
      reconnectAttempts: device.sourceCreatedAt.filter((at) => at >= downAt!).length,
      snapshots: snapshotSummary(measured(device)),
    };
  }
  const expected = !(await fullSnapshot().then((s) => hasThumb([...s.bots, ...(s.groups ?? [])].find((o) => o.threadId === target.threadId)?.messages?.find((m) => m.id === target.messageId))));
  const match = (frame: Frame) => frame.kind === "message.patch" && frame.message?.id === target.messageId && hasThumb(frame.message) === expected;
  const arrivals = devices.map((device) => device.waitFor(match));
  const sentAt = now();
  await toggleReaction(target.threadId, target.messageId);
  const injection = Object.fromEntries((await Promise.all(arrivals)).map((at, i) => [devices[i].name, at === null ? null : round(at - sentAt)]));
  const consistent = await consistency(devices, target.threadId, target.messageId);
  const restored = await restore(target.snapshot, target);
  for (const device of devices) device.close();
  return {
    target: { threadId: target.threadId, messageId: target.messageId },
    streamBefore: before.cursor,
    streamAfter: after.cursor,
    restartCommandExit: exitCode,
    restartCommandMs: round(commandMs),
    downToHealthyMs: round(healthyAt - downAt),
    devices: perDevice,
    injectionLatencyMs: injection,
    consistency: consistent,
    restored,
  };
}

async function away() {
  const target = await pickTarget();
  const [device] = await openReady(["device"]);
  const awaySeconds = Number(args["away-seconds"]);
  const start = await peekHello();
  device.hide();
  device.killSilently();
  const seqAtHide = device.knownSeq;
  const hiddenAt = now();
  const bots = target.snapshot.bots.map((bot) => bot.id);
  const load = await inject(Number(args["away-rate"]), awaySeconds * 1000, bots, target);
  const end = await peekHello();
  const framesProduced = (seqOf(String(end.cursor)) ?? 0) - (seqOf(String(start.cursor)) ?? 0);
  await sleep(500);
  const shownAt = now();
  device.show();
  const connection = await device.waitCurrent(shownAt, 60_000);
  const consistent = await consistency([device], target.threadId, target.messageId);
  const restored = await restore(target.snapshot, target);
  device.close();
  return {
    target: { threadId: target.threadId, messageId: target.messageId },
    hiddenSeconds: round((shownAt - hiddenAt) / 1000),
    load: { ...load, framesProduced, framesPerSecond: round(framesProduced / load.seconds) },
    resumed: connection?.resumed ?? null,
    msVisibleToHello: connection ? round(connection.helloAt - shownAt) : null,
    msVisibleToCurrent: connection?.currentAt !== undefined ? round(connection.currentAt - shownAt) : null,
    framesMissedAsFrames: connection ? device.missedBetween(seqAtHide, seqOf(connection.cursor) ?? seqAtHide) : null,
    snapshots: snapshotSummary(measured(device)),
    consistency: consistent.device,
    restored,
  };
}

async function drop() {
  const target = await pickTarget();
  const [device] = await openReady(["device"]);
  const bots = target.snapshot.bots.map((bot) => bot.id);
  const seqBefore = device.lastSeq;
  const rate = Number(args["drop-rate"]);
  const start = await peekHello();
  const loading = inject(rate, 10_000, bots, target);
  await sleep(4_000);
  const killedAt = now();
  const seqAtKill = device.knownSeq;
  device.killLoudly();
  const load = await loading;
  const end = await peekHello();
  const connection = await device.waitCurrent(killedAt, 60_000);
  await sleep(1_000);
  const consistent = await consistency([device], target.threadId, target.messageId);
  const restored = await restore(target.snapshot, target);
  const gaps = device.seqGaps.filter((gap) => gap.after >= seqBefore);
  device.close();
  return {
    target: { threadId: target.threadId, messageId: target.messageId },
    load: { ...load, framesProduced: (seqOf(String(end.cursor)) ?? 0) - (seqOf(String(start.cursor)) ?? 0) },
    resumed: connection?.resumed ?? null,
    msKillToReconnect: connection ? round(connection.helloAt - killedAt) : null,
    msKillToCurrent: connection?.currentAt !== undefined ? round(connection.currentAt - killedAt) : null,
    framesMissedAsFrames: connection ? device.missedBetween(seqAtKill, seqOf(connection.cursor) ?? seqAtKill) : null,
    liveSeqGaps: gaps.reduce((sum, gap) => sum + gap.missing, 0),
    seqGaps: gaps.map(({ after, missing }) => ({ after, missing })),
    snapshots: snapshotSummary(measured(device)),
    consistency: consistent.device,
    restored,
  };
}

async function assets() {
  const path = `/assets/missing-${randomUUID().slice(0, 8)}.js`;
  const response = await fetch(BASE + path, { headers: { origin: BASE } });
  const body = await response.text();
  const hello = await peekHello();
  return {
    path,
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes: Buffer.byteLength(body),
    looksLikeHtml: /<!doctype html|<html/i.test(body),
    helloHasBuild: "build" in hello,
    helloBuild: hello.build ?? null,
    helloKeys: Object.keys(hello),
  };
}

const scenarios: Record<string, () => Promise<unknown>> = { latency, restart, away, drop, assets };
const run = scenarios[args.scenario];
if (!run) {
  console.error(`unknown scenario ${args.scenario}`);
  process.exit(2);
}
const startedAt = new Date().toISOString();
const result = { scenario: args.scenario, base: BASE, startedAt, ...(await run() as object), finishedAt: new Date().toISOString() };
const text = JSON.stringify(result, null, 2);
console.log(text);
if (args.out) writeFileSync(args.out, `${text}\n`);
process.exit(0);
