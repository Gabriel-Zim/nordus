// Real server, restarted on the same data: a device that held a cursor from before the restart gets back only what changed.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { runControlNordus, verificationServerEnvironment } from "../scripts/control-nordus.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { openSse } from "./testing/sse.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_CLI = join(ROOT, "server/testing/fake-claude-cli.ts");
const BUILD = "0123456789abcdef";

const homes: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) await waitForExit(child, { signal: "SIGTERM" });
  for (const home of homes.splice(0)) await removeTempDir(home);
});

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "nordus-live-resume-"));
  homes.push(home);
  mkdirSync(join(home, "tmp"), { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({
    instances: { claude: { driver: "claudeAgent", displayName: "Verification fixture", config: { cli: FAKE_CLI } } },
  }));
  const site = join(home, "site");
  mkdirSync(join(site, "assets"), { recursive: true });
  writeFileSync(join(site, "index.html"), `<!doctype html><html><head><meta name="nordus-build" content="${BUILD}" /></head><body></body></html>`);
  writeFileSync(join(site, "assets", "index-present.js"), "export {};");
  return { home, site };
}

async function boot({ home, site }: { home: string; site: string }) {
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
    cwd: ROOT,
    env: { ...verificationServerEnvironment(process.env, home, port), NORDUS_STATIC_DIR: site },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error(`server exited during boot:\n${output}`);
    try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
  }, { timeout: 20_000, interval: 50 }).toBe(true);
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method, headers: { origin: base, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
  };
  const get = async (path: string) => {
    const response = await request("GET", path);
    expect(response.status).toBe(200);
    return JSON.parse(response.body);
  };
  const control = (...args: string[]) => runControlNordus([...args, "--url", base]) as Promise<any>;
  return { base, get, request, control, stop: () => waitForExit(child, { signal: "SIGTERM" }) };
}

function seedMessages(home: string, threadIds: string[]) {
  const db = new DatabaseSync(join(home, "messages.db"));
  try {
    const insert = db.prepare("INSERT INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, 'bot', 'text', ?, ?)");
    for (const threadId of threadIds) {
      for (let index = 0; index < 3; index += 1) {
        const message = { id: `${threadId}-m${index}`, at: 1_000 + index, role: "bot", kind: "text", text: `line ${index}` };
        insert.run(threadId, message.id, message.at, message.text, JSON.stringify(message));
      }
    }
  } finally {
    db.close();
  }
}

it("brings a device back after a restart with only the conversations that changed", async () => {
  const dirs = freshHome();
  const first = await boot(dirs);
  await first.control("new-bot", "--name", "Quiet one");
  const threads = (await first.get("/api/bots?messages=0")).bots.map((bot: { threadId: string }) => bot.threadId) as string[];
  expect(threads).toHaveLength(2);
  await first.stop();
  seedMessages(dirs.home, threads);

  const second = await boot(dirs);
  const held = (await second.get("/api/bots?messages=60")) as { cursor: string; bots: Array<{ id: string; threadId: string; messages: Array<{ id: string }> }> };
  expect(held.cursor).toMatch(/^[0-9a-f]{8}:\d+$/);
  expect(held.bots.every((bot) => bot.messages.some((message) => message.id === `${bot.threadId}-m2`))).toBe(true);
  const [changed, quiet] = held.bots;
  // A device that only needs the list asks for a short `preview` page and names the conversation about to open in `focus`.
  const shallow = (await second.get(`/api/bots?messages=60&preview=1&focus=${changed!.id}`)) as { bots: Array<{ id: string; hasMore?: boolean; messages: unknown[] }> };
  const byId = new Map(shallow.bots.map((bot) => [bot.id, bot]));
  expect(byId.get(changed!.id)?.messages.length).toBe(held.bots.find((bot) => bot.id === changed!.id)!.messages.length);
  expect(byId.get(quiet!.id)?.messages).toHaveLength(1);
  expect(byId.get(quiet!.id)?.hasMore).toBe(true);
  const reacted = await second.request("POST", `/api/threads/${changed!.threadId}/messages/${changed!.threadId}-m2/reactions`, { emoji: "👍" });
  expect(reacted.status).toBe(200);
  await second.stop();

  const third = await boot(dirs);
  const stream = await openSse(`${third.base}/api/events?since=${encodeURIComponent(held.cursor)}`, { origin: third.base });
  try {
    const hello = await stream.until((frame) => frame.kind === "hello");
    expect(hello).toMatchObject({ resumed: false, build: BUILD });
    expect(hello.cursor.split(":")[0]).toBe(held.cursor.split(":")[0]);
    expect(Number(hello.cursor.split(":")[1])).toBeGreaterThan(Number(held.cursor.split(":")[1]));
  } finally {
    stream.close();
  }

  const query = `messages=60&since=${encodeURIComponent(held.cursor)}&held=${threads.join(",")}`;
  const delta = await third.get(`/api/bots?${query}`) as { delta?: boolean; bots: Array<{ id: string; messages?: Array<{ id: string; reactions?: unknown }> }> };
  expect(delta.delta).toBe(true);
  const back = new Map(delta.bots.map((bot) => [bot.id, bot]));
  expect(back.get(quiet!.id)).not.toHaveProperty("messages");
  expect(back.get(changed!.id)?.messages?.find((message) => message.id === `${changed!.threadId}-m2`)?.reactions).toBeTruthy();

  const stranger = await third.get(`/api/bots?messages=60&since=deadbeef:1&held=${threads.join(",")}`) as { delta?: boolean; bots: Array<{ messages?: unknown[] }> };
  expect(stranger.delta).toBeUndefined();
  expect(stranger.bots.every((bot) => Array.isArray(bot.messages))).toBe(true);

  const unheld = await third.get(`/api/bots?messages=60&since=${encodeURIComponent(held.cursor)}`) as { bots: Array<{ messages?: unknown[] }> };
  expect(unheld.bots.every((bot) => Array.isArray(bot.messages))).toBe(true);
});

it("answers a chunk the build no longer has with a 404, never the app page", async () => {
  const server = await boot(freshHome());
  const missing = await server.request("GET", "/assets/index-gone.js");
  expect(missing.status).toBe(404);
  expect(missing.type).not.toContain("text/html");
  expect((await server.request("GET", "/assets/index-present.js")).status).toBe(200);
  const page = await server.request("GET", "/some/client/route");
  expect(page.status).toBe(200);
  expect(page.body).toContain(BUILD);
});
