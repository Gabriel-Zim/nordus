import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const BOB = "bob@example.test";

let child: ChildProcess;
let home: string;
let log = "";
const tokens: Record<string, string> = {};

const headers = (as?: string, json = true) => ({
  ...(json ? { "content-type": "application/json" } : {}),
  ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
});
const api = async (method: string, path: string, body?: unknown, as?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, { method, headers: headers(as, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, NORDUS_PORT: String(PORT), NORDUS_WEBHOOK_PORT: String(PORT + 1),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function waitFor<T>(read: () => Promise<T | null | undefined> | T | null | undefined, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** `lastEventId` resumes from a cursor the way a browser's EventSource does. */
function openStream(as: string, lastEventId?: string) {
  const controller = new AbortController();
  const frames: any[] = [];
  const state: { hello: any; ended: boolean; cursor?: string } = { hello: null, ended: false };
  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, {
        headers: { ...headers(as, false), ...(lastEventId ? { "last-event-id": lastEventId } : {}) },
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of chunk.split("\n")) {
            if (line.startsWith("id: ")) state.cursor = line.slice(4);
            if (!line.startsWith("data: ")) continue;
            const frame = JSON.parse(line.slice(6));
            if (frame.kind === "hello") {
              state.hello = frame;
              state.cursor = frame.cursor;
            } else if (frame.kind !== "ping") frames.push(frame);
          }
        }
      }
      state.ended = true;
    } catch {
    }
  })();
  return { frames, state, ready: () => waitFor(() => state.hello, 10_000), close: () => controller.abort() };
}

async function makeBot(name: string, visibility?: unknown, audience: "internal" | null = "internal") {
  const created = await api("POST", "/api/bots", { name }, BOSS);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" }, ...(audience ? { audience } : {}), ...(visibility ? { visibility } : {}) }, BOSS);
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  return created.body.bot as { id: string; threadId: string };
}

const general = async (as?: string) => {
  const { body } = await api("GET", "/api/bots?messages=0", undefined, as);
  return (body.groups as any[]).find((group) => group.general);
};

posixOnly("the shared Geral room", () => {
  const bots: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-general-room-"));
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      profile: { name: "Avery", email: "avery@example.test" },
      instances: { grok: { driver: "grokAgent", config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => (email === BOSS ? ["admin", "client"] : ["client"]) });
    tokens[BOSS] = registry.issue({ label: "boss", email: BOSS, scopes: ["admin", "client"] }).token;
    tokens[ADA] = registry.issue({ label: "ada's laptop", email: ADA, scopes: ["client"], name: "Ada Lovelace" }).token;
    tokens[BOB] = registry.issue({ label: "bob's laptop", email: BOB, scopes: ["client"] }).token;
    registry.close();
    await start();
  }, 60_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("appears with the second open bot and leaves restricted bots out", async () => {
    bots.one = (await makeBot("Otter")).id;
    expect(await general(BOB)).toBeUndefined();
    bots.two = (await makeBot("Heron")).id;
    bots.boss = (await makeBot("Zebra", "admins")).id;
    const room = await general(BOB);
    expect(room.name).toBe("Geral");
    expect(room.memberIds).toEqual(expect.arrayContaining([bots.one, bots.two]));
    expect(room.memberIds).not.toContain(bots.boss);
    expect((await api("GET", "/api/bots?messages=0", undefined, BOB)).body.groups.filter((group: any) => group.general)).toHaveLength(1);
  });

  it("never takes a client's bot, marked or not", async () => {
    const unmarked = (await makeBot("Fox", undefined, null)).id;
    expect((await general(BOB)).memberIds).not.toContain(unmarked);
    const marked = (await makeBot("Lynx")).id;
    expect((await api("PATCH", `/api/bots/${marked}`, { audience: "client" }, BOSS)).status).toBe(200);
    expect((await general(BOB)).memberIds).not.toContain(marked);
  });

  it("stores who spoke and shows it live to the other members", async () => {
    const room = await general(BOB);
    const stream = openStream(BOB);
    expect(await stream.ready()).toBeTruthy();
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Bom dia, time" }, ADA)).status).toBe(202);
    const seen = await waitFor(() => stream.frames.find((frame) => frame.kind === "message" && frame.message?.text === "Bom dia, time"));
    stream.close();
    expect(seen?.message.sender).toMatchObject({ name: "Ada Lovelace", email: ADA });

    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Oi Ada" }, BOB)).status).toBe(202);
    expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Passando pelo terminal" })).status).toBe(202);
    const load = async () => (await api("GET", `/api/threads/${room.threadId}/messages`, undefined, ADA)).body.messages as Array<{ role: string; text?: string; sender?: any }>;
    const stored = await waitFor(async () => {
      const all = await load();
      return ["Oi Ada", "Passando pelo terminal"].every((text) => all.some((message) => message.text === text)) ? all : undefined;
    }, 20_000);
    const from = (text: string) => stored?.find((message) => message.role === "user" && message.text === text)?.sender;
    expect(from("Bom dia, time")).toMatchObject({ name: "Ada Lovelace", email: ADA });
    expect(from("Oi Ada")).toMatchObject({ name: "bob", email: BOB });
    expect(from("Passando pelo terminal")).toEqual({ name: "Avery", email: "avery@example.test" });
  }, 30_000);

  it("follows bots as they change visibility and are deleted", async () => {
    const members = async () => (await general(BOB)).memberIds as string[];
    expect(await members()).not.toContain(bots.boss);
    expect((await api("PATCH", `/api/bots/${bots.boss}`, { visibility: "everyone" }, BOSS)).status).toBe(200);
    expect(await members()).toContain(bots.boss);
    expect((await api("PATCH", `/api/bots/${bots.one}`, { visibility: { people: [ADA] } }, BOSS)).status).toBe(200);
    expect(await members()).not.toContain(bots.one);
    expect(await members()).toContain(bots.two);
    expect((await api("DELETE", `/api/bots/${bots.boss}`, undefined, BOSS)).status).toBe(200);
    expect(await members()).not.toContain(bots.boss);
    expect((await api("GET", "/api/bots?messages=0", undefined, BOB)).body.groups.filter((group: any) => group.general)).toHaveLength(1);
  });
});
