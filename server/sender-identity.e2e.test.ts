// Who the lines of a room are from, through the real server: the name, address and photo a session stamps on what it writes,
// how a line stored under a device's label is shown once the owner has a name, what each browser is told it is, and what the
// agent reads. The sessions are seeded offline, like a workspace whose phones and browsers were paired or signed in before.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verificationServerArgs, verificationServerEnvironment } from "../scripts/control-nordus.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const OWNER = "avery@example.test";
const MARIA = "maria@example.test";
const GOOGLE_PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let port: number;
let dataDir: string;
let child: ChildProcess;
let avatarUrl = "";
let roomThread = "";
let roomId = "";
const tokens: Record<"device" | "staff" | "owner" | "maria", string> = { device: "", staff: "", owner: "", maria: "" };

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: any;
  bytes: Buffer;
}

/** No token: the owner on this machine. With one: that session, as a phone or another browser would call. */
function call(path: string, init: { method?: string; body?: unknown; raw?: Buffer; type?: string; token?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = init.raw ?? (init.body === undefined ? undefined : Buffer.from(JSON.stringify(init.body)));
    const req = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method: init.method ?? (payload ? "POST" : "GET"),
      signal: AbortSignal.timeout(10_000),
      headers: {
        host: `127.0.0.1:${port}`,
        ...(init.token ? { authorization: `Bearer ${init.token}` } : { origin: `http://127.0.0.1:${port}` }),
        ...(payload ? { "content-type": init.type ?? "application/json", "content-length": String(payload.length) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("error", reject);
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        let body: unknown = bytes.toString("utf8");
        try {
          body = JSON.parse(bytes.toString("utf8"));
        } catch {
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, bytes });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const dumpPath = () => join(dataDir, "turn-dump.json");

async function say(token: keyof typeof tokens, text: string): Promise<void> {
  const sent = await call(`/api/groups/${roomId}/messages`, { body: { text, threadId: roomThread }, token: tokens[token] });
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
}

/** The room's lines as a browser is served them, newest last. */
async function lines(token?: keyof typeof tokens): Promise<Array<{ text?: string; sender?: Record<string, unknown> }>> {
  const page = await call(`/api/threads/${roomThread}/messages`, token ? { token: tokens[token] } : {});
  expect(page.status, JSON.stringify(page.body)).toBe(200);
  return page.body.messages.filter((line: { role: string; kind: string }) => line.role === "user" && line.kind === "text");
}

const lineSaying = (all: Array<{ text?: string; sender?: Record<string, unknown> }>, text: string) => all.find((line) => line.text === text);

beforeAll(async () => {
  port = await freePortBlock([0, 1]);
  dataDir = mkdtempSync(join(tmpdir(), "nordus-sender-identity-"));
  mkdirSync(join(dataDir, "tmp"));
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    signIn: { admins: [OWNER], members: [MARIA] },
    instances: {
      claude: {
        driver: "claudeAgent",
        displayName: "Identity fixture",
        config: { cli: join(SERVER_DIR, "testing", "fake-claude-cli.ts") },
        environment: { FAKE_CLAUDE_DUMP: dumpPath() },
      },
    },
  }));
  const registry = new SessionRegistry({
    file: join(dataDir, "sessions.json"),
    emailScopes: (email) => (email === OWNER ? ["admin", "client"] : ["client"]),
  });
  tokens.device = registry.issue({ label: "Chrome on Mac", scopes: ["admin", "client"] }).token;
  tokens.staff = registry.issue({ label: "Staff phone", scopes: ["client"] }).token;
  tokens.owner = registry.issue({ label: "Mac", email: OWNER, name: "Avery Mercer", picture: GOOGLE_PHOTO, scopes: ["admin", "client"], userId: "google:1" }).token;
  tokens.maria = registry.issue({ label: "Laptop", email: MARIA, name: "Maria Souza", picture: GOOGLE_PHOTO, scopes: ["client"], userId: "google:2" }).token;
  registry.close();

  const env = verificationServerEnvironment(process.env, dataDir, port);
  child = spawn(process.execPath, verificationServerArgs(env), { cwd: join(SERVER_DIR, ".."), env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`fixture exited:\n${stderr}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok) break;
    } catch {
    }
    if (Date.now() > deadline) throw new Error(`server did not start:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  const bot = await call("/api/bots", { body: { name: "Helper" } });
  expect(bot.status, JSON.stringify(bot.body)).toBe(201);
  const room = await call("/api/groups", { body: { name: "Sala", memberIds: [bot.body.bot.id], setup: { bulletin: "", defaultResponder: { kind: "mentions" } } } });
  expect(room.status, JSON.stringify(room.body)).toBe(201);
  roomId = room.body.group.id;
  roomThread = room.body.group.threadId;
}, 60_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (dataDir) await removeTempDir(dataDir);
});

describe("who the lines of a room are from", () => {
  it("stamps the device's label on a line written before the owner has a name, the way older versions did", async () => {
    await say("device", "Alo antigo");
    const stored = lineSaying(await lines(), "Alo antigo")!.sender!;
    expect(stored).toMatchObject({ name: "Chrome on Mac", admin: true });
    expect(stored.email).toBeUndefined();
  });

  it("shows that old line as the owner, with the profile's name and photo, once the profile has them", async () => {
    const saved = await call("/api/attachments", { raw: PNG, type: "image/png" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    avatarUrl = `/api/attachments/${basename(saved.body.path)}`;
    const profile = await call("/api/config", { method: "PUT", body: { profile: { name: "Avery", email: OWNER, avatarUrl } } });
    expect(profile.status, JSON.stringify(profile.body)).toBe(200);

    for (const viewer of [undefined, "device", "maria", "owner"] as const) {
      const seen = lineSaying(await lines(viewer), "Alo antigo")!.sender!;
      expect(seen, String(viewer)).toMatchObject({ name: "Avery", email: OWNER, avatarUrl, admin: true });
    }
  });

  it("stamps what each kind of session writes now: the owner's device as the owner, a device with no admin scope under its label", async () => {
    await say("device", "Fala turma");
    await say("staff", "Oi da recepcao");
    await say("owner", "Do navegador do Google");
    await say("maria", "Bom dia");
    const all = await lines();

    expect(lineSaying(all, "Fala turma")!.sender).toMatchObject({ name: "Avery", email: OWNER, avatarUrl, admin: true });
    expect(lineSaying(all, "Fala turma")!.sender!.notOwner).toBeUndefined();
    expect(lineSaying(all, "Oi da recepcao")!.sender).toMatchObject({ name: "Staff phone" });
    const staff = lineSaying(all, "Oi da recepcao")!.sender!;
    expect([staff.email, staff.admin, staff.avatarUrl, staff.notOwner]).toEqual([undefined, undefined, undefined, undefined]);
    expect(lineSaying(all, "Do navegador do Google")!.sender).toMatchObject({ name: "Avery", email: OWNER, avatarUrl, admin: true });
    expect(lineSaying(all, "Do navegador do Google")!.sender!.notOwner).toBeUndefined();
    expect(lineSaying(all, "Bom dia")!.sender).toMatchObject({ name: "Maria Souza", email: MARIA, avatarUrl: GOOGLE_PHOTO, notOwner: true });
    expect(lineSaying(all, "Bom dia")!.sender!.admin).toBeUndefined();
  });

  it("tells each browser who it is, and nothing for a device that is not a person", async () => {
    const who = async (token: keyof typeof tokens) => (await call("/api/auth/session", { token: tokens[token] })).body.person;
    expect(await who("device")).toEqual({ name: "Avery", email: OWNER, avatarUrl, owner: true });
    expect(await who("owner")).toEqual({ name: "Avery", email: OWNER, avatarUrl, owner: true });
    expect(await who("maria")).toEqual({ name: "Maria Souza", email: MARIA, avatarUrl: GOOGLE_PHOTO });
    expect(await who("staff")).toBeUndefined();
  });

  it("lets a member open the owner's photo", async () => {
    const photo = await call(avatarUrl, { token: tokens.maria });
    expect(photo.status).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/png");
    expect(photo.bytes.equals(PNG)).toBe(true);
  });

  it("gives the agent the owner's name for the owner's device, old line included, and keeps the others as they are", async () => {
    await say("device", "@Helper quem falou comigo? marcador-final");
    const deadline = Date.now() + 30_000;
    let sent = "";
    while (Date.now() < deadline) {
      if (existsSync(dumpPath())) {
        const dump = JSON.parse(readFileSync(dumpPath(), "utf8")) as { prompt: unknown; systemPrompt: string };
        sent = `${JSON.stringify(dump.prompt)}\n${dump.systemPrompt}`;
        if (sent.includes("marcador-final")) break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(sent).toContain("marcador-final");
    expect(sent).toContain("Avery: Alo antigo");
    expect(sent).toContain("Avery: Fala turma");
    expect(sent).toContain("Avery: Do navegador do Google");
    expect(sent).toContain("Staff phone: Oi da recepcao");
    expect(sent).toContain(`Maria Souza (${MARIA}): Bom dia`);
    expect(sent).not.toContain("Chrome on Mac");
  });
});
