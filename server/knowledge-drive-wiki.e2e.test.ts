import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DriveListing, DriveSaveResult, WikiImportSummary, WikiListing, WikiPageDetail, WikiSaveResult } from "../shared/knowledge.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = 29100 + Math.floor(Math.random() * 9_000);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPABILITY_KEY = "knowledge-drive-wiki-fixture-capability";
const ANA = "ana@zorg.test";
const BETO = "beto@evergreen.test";
const EVA = "eva@evergreen.test";
const CARLA = "carla@lumon.test";
const OUTSIDER = "dan@nowhere.test";
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess;
let home: string;
let log = "";
const tokens: Record<string, string> = {};
const bots: Record<"gerentedeoperacao" | "evergreen" | "lumon", { id: string; threadId: string }> = { gerentedeoperacao: { id: "", threadId: "" }, evergreen: { id: "", threadId: "" }, lumon: { id: "", threadId: "" } };
const encode = encodeURIComponent;

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 240_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out\n${log.slice(-3_000)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function call<T = Record<string, unknown>>(as: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" || body instanceof Uint8Array;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[as]}`, ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...headers },
    ...(body === undefined ? {} : { body: raw ? (body as string | Uint8Array) : JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* a file, not JSON */ }
  return { status: response.status, body: parsed as T, text, headers: response.headers };
}

/** An agent calls its Drive and Wiki tools through the server's internal door, with the capability its turn would carry. */
async function agent<T = Record<string, unknown>>(bot: keyof typeof bots, action: string, body: unknown = {}, threadId = bots[bot].threadId) {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nordus-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId: bots[bot].id, threadId }),
  });
  expect(minted.status, "the test capability").toBe(201);
  const { token } = (await minted.json()) as { token: string };
  const response = await fetch(`${BASE}/api/internal/knowledge/${action}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as T & { text?: string; error?: string; code?: string } };
}

posixOnly("Drive and Wiki, end to end", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "nordus-knowledge-"));
    const data = join(home, ".nordus");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({ signIn: { admins: [ANA], members: [BETO, EVA, CARLA, OUTSIDER] } }));
    const scopes = (email: string) => (email === ANA ? (["admin", "client"] as const) : (["client"] as const));
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...scopes(email)] });
    for (const email of [ANA, BETO, EVA, CARLA, OUTSIDER]) tokens[email] = registry.issue({ label: email.split("@")[0]!, email, scopes: [...scopes(email)] }).token;
    registry.close();
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, NORDUS_PORT: String(PORT), NORDUS_WEBHOOK_PORT: String(PORT + 1), NORDUS_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (log += chunk));
    child.stderr!.on("data", (chunk) => (log += chunk));
    await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok);

    const make = async (key: keyof typeof bots, name: string, visibleTo: string[], settings: Record<string, unknown>) => {
      const created = await call<{ bot: { id: string; threadId: string } }>(ANA, "POST", "/api/bots", { name, visibility: { people: visibleTo } });
      expect(created.status, created.text).toBe(201);
      bots[key] = { id: created.body.bot.id, threadId: created.body.bot.threadId };
      expect((await call(ANA, "PATCH", `/api/bots/${bots[key].id}`, settings)).status).toBe(200);
    };
    await make("gerentedeoperacao", "GerenteDeOperacao E2E", [ANA], { audience: "internal" });
    await make("evergreen", "EVERGREEN Bot E2E", [BETO, EVA], { client: "evergreen" });
    await make("lumon", "LUMON Bot E2E", [CARLA], { client: "lumon" });
  }, 300_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    if (home) removeTempDir(home);
  });

  it("a second upload keeps the first as a version, and restoring brings it back as a new one", async () => {
    const first = await call<DriveSaveResult>(ANA, "PUT", `/api/drive/file?space=internal&path=${encode("Reports/q4.md")}`, "first draft");
    expect([first.status, first.body.outcome, first.body.version]).toEqual([201, "created", 1]);
    const second = await call<DriveSaveResult>(ANA, "PUT", `/api/drive/file?space=internal&path=${encode("Reports/q4.md")}&note=${encode("final")}`, "final text");
    expect([second.status, second.body.outcome, second.body.version]).toEqual([200, "updated", 2]);

    const info = await call<{ versions: Array<{ n: number; note?: string; by: { name: string }; current: boolean }> }>(ANA, "GET", `/api/drive/info?space=internal&path=${encode("Reports/q4.md")}`);
    expect(info.body.versions.map((version) => [version.n, version.note, version.by.name, version.current])).toEqual([[2, "final", "ana", true], [1, undefined, "ana", false]]);

    const restored = await call<DriveSaveResult>(ANA, "POST", "/api/drive/restore", { space: "internal", path: "Reports/q4.md", version: 1 });
    expect([restored.status, restored.body.version]).toEqual([200, 3]);
    expect((await call(ANA, "GET", `/api/drive/download?space=internal&path=${encode("Reports/q4.md")}`)).text).toBe("first draft");
    expect((await call(ANA, "GET", `/api/drive/download?space=internal&path=${encode("Reports/q4.md")}&version=2`)).text).toBe("final text");
    const listing = await call<DriveListing>(ANA, "GET", `/api/drive/list?space=internal&path=Reports`);
    expect(listing.body.items).toMatchObject([{ kind: "file", name: "q4.md", versions: 3 }]);
  });

  it("carries a large file through the real server, with the right headers and a byte range", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 123, "abcdefghij");
    const saved = await call<DriveSaveResult>(ANA, "PUT", `/api/drive/file?space=internal&path=Media/big.bin`, big);
    expect([saved.status, saved.body.file.size]).toEqual([201, big.length]);
    const whole = await fetch(`${BASE}/api/drive/download?space=internal&path=Media/big.bin`, { headers: { authorization: `Bearer ${tokens[ANA]}` } });
    expect(whole.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(whole.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await whole.arrayBuffer()).equals(big)).toBe(true);
    const part = await call(ANA, "GET", `/api/drive/download?space=internal&path=Media/big.bin`, undefined, { range: "bytes=10-19" });
    expect([part.status, part.headers.get("content-range"), part.text]).toEqual([206, `bytes 10-19/${big.length}`, "abcdefghij"]);
    const html = await call(ANA, "PUT", `/api/drive/file?space=internal&path=Media/page.html`, "<script>alert(1)</script>");
    expect(html.status).toBe(201);
    const served = await call(ANA, "GET", `/api/drive/preview?space=internal&path=Media/page.html`);
    expect([served.headers.get("content-type"), served.headers.get("content-security-policy")]).toEqual(["text/plain; charset=utf-8", "sandbox"]);
  });

  it("an agent's Drive tool saves a file that people see with the agent as its author", async () => {
    const saved = await agent<{ saved: DriveSaveResult }>("gerentedeoperacao", "drive-save", { path: "Agent/notes.md", text: "# from GerenteDeOperacao", note: "weekly" });
    expect([saved.status, saved.body.text]).toMatchObject([200, expect.stringContaining("Saved Agent/notes.md to the Drive")]);
    const again = await agent("gerentedeoperacao", "drive-save", { path: "Agent/notes.md", text: "# from GerenteDeOperacao, v2" });
    expect(again.body.text).toContain("version 2");

    const seen = await call<DriveListing>(ANA, "GET", `/api/drive/list?space=internal&path=Agent`);
    expect(seen.body.items).toMatchObject([{ kind: "file", name: "notes.md", versions: 2, by: { kind: "bot", name: "GerenteDeOperacao E2E" } }]);
    const read = await agent("gerentedeoperacao", "drive-read", { path: "Agent/notes.md", version: 1 });
    expect(read.body.text).toContain("# from GerenteDeOperacao");
    expect((await agent("gerentedeoperacao", "drive-list", { path: "Agent" })).body.text).toContain("notes.md");
    expect((await call(ANA, "GET", `/api/drive/download?space=internal&path=${encode("Agent/notes.md")}`)).text).toBe("# from GerenteDeOperacao, v2");
  });

  it("an agent's Wiki tools write pages the Wiki shows, with links and backlinks", async () => {
    const written = await agent("gerentedeoperacao", "wiki-write", { title: "Playbooks/Onboarding", content: "Start with [[Pricing]].", summary: "first" });
    expect(written.body.text).toContain('Created the Wiki page "Onboarding"');
    await agent("gerentedeoperacao", "wiki-write", { title: "Pricing", content: "Tiers. Back to [[Onboarding|the playbook]]." });
    const listing = await call<WikiListing>(ANA, "GET", "/api/wiki/pages?space=internal");
    expect(listing.body.pages.map((page) => [page.title, page.updatedBy.name]).sort()).toEqual([["Onboarding", "GerenteDeOperacao E2E"], ["Pricing", "GerenteDeOperacao E2E"]]);
    const pricing = listing.body.pages.find((page) => page.title === "Pricing")!;
    const detail = await call<WikiPageDetail>(ANA, "GET", `/api/wiki/page?space=internal&id=${pricing.id}`);
    expect(detail.body.backlinks.map((link) => link.title)).toEqual(["Onboarding"]);
    expect((await agent("gerentedeoperacao", "wiki-search", { query: "pricing" })).body.text).toContain("Pricing");
    expect((await agent("gerentedeoperacao", "wiki-read", { title: "Pricing" })).body.text).toContain('"pagesThatLinkHere":["Onboarding"]');

    const edited = await call<WikiSaveResult>(ANA, "PATCH", "/api/wiki/page", { space: "internal", id: pricing.id, content: "Tiers v2.", expectedVersion: 1, summary: "edit by hand" });
    expect(edited.body.page.version).toBe(2);
    const versions = await call<{ versions: Array<{ n: number; by: { kind: string; name: string } }> }>(ANA, "GET", `/api/wiki/versions?space=internal&id=${pricing.id}`);
    expect(versions.body.versions.map((version) => [version.n, version.by.kind])).toEqual([[2, "person"], [1, "bot"]]);
  });

  it("imports an Obsidian vault folder over HTTP: pages keep their folders, pictures go to the Drive", async () => {
    const started = await call<{ session: string }>(ANA, "POST", "/api/wiki/import/start", { space: "internal", root: "Vault" });
    expect(started.status).toBe(201);
    const send = (path: string, content: string | Buffer) => call<{ accepted: boolean }>(ANA, "PUT", `/api/wiki/import/file?session=${started.body.session}&path=${encode(path)}`, content);
    expect((await send("Home.md", "---\ntags: [hub]\n---\nGo to [[Notes/Daily]] ![[logo.png]]")).body.accepted).toBe(true);
    expect((await send("Notes/Daily.md", "Back to [[Home]].")).body.accepted).toBe(true);
    expect((await send("assets/logo.png", Buffer.from([1, 2, 3]))).body.accepted).toBe(true);
    const summary = await call<WikiImportSummary>(ANA, "POST", "/api/wiki/import/finish", { session: started.body.session });
    expect(summary.body).toMatchObject({ pages: { created: 2 }, attachments: { created: 1 }, links: { missing: 0 } });
    const drive = await call<DriveListing>(ANA, "GET", `/api/drive/list?space=internal&path=${encode("Wiki/anexos/Vault/assets")}`);
    expect(drive.body.items).toMatchObject([{ name: "logo.png" }]);
    const home = (await call<WikiListing>(ANA, "GET", "/api/wiki/pages?space=internal&q=home")).body.pages.find((page) => page.title === "Home")!;
    expect(home.tags).toEqual(["hub"]);
  });

  it("a client sees only its own space, over HTTP and through its agent, and never the company's or another client's", async () => {
    expect((await call<{ spaces: Array<{ id: string }> }>(BETO, "GET", "/api/drive/spaces")).body.spaces.map((space) => space.id)).toEqual(["client:evergreen"]);
    expect((await call<{ spaces: Array<{ id: string }> }>(CARLA, "GET", "/api/wiki/spaces")).body.spaces.map((space) => space.id)).toEqual(["client:lumon"]);
    expect((await call<{ spaces: Array<{ id: string }> }>(OUTSIDER, "GET", "/api/drive/spaces")).body.spaces).toEqual([]);
    expect((await call<{ spaces: Array<{ id: string }> }>(ANA, "GET", "/api/drive/spaces")).body.spaces.map((space) => space.id)).toEqual(expect.arrayContaining(["internal", "client:evergreen", "client:lumon"]));

    expect((await call(BETO, "PUT", `/api/drive/file?path=${encode("Contracts/deal.txt")}`, "evergreen contract")).status).toBe(201);
    expect((await call(BETO, "POST", "/api/wiki/page", { title: "EVERGREEN brief", content: "client only" })).status).toBe(201);

    for (const [who, space] of [[BETO, "internal"], [BETO, "client:lumon"], [CARLA, "client:evergreen"], [CARLA, "internal"], [OUTSIDER, "client:evergreen"]] as const) {
      for (const path of [`/api/drive/list?space=${space}`, `/api/drive/download?space=${space}&path=Reports/q4.md`, `/api/wiki/pages?space=${space}`, `/api/drive/search?space=${space}&q=q4`, `/api/drive/trash?space=${space}`]) {
        const denied = await call<{ code?: string }>(who, "GET", path);
        expect([who, path, denied.status, denied.body.code]).toEqual([who, path, 403, "no_space"]);
      }
      expect((await call(who, "PUT", `/api/drive/file?space=${space}&path=intruder.txt`, "x")).status).toBe(403);
      expect((await call(who, "POST", "/api/wiki/page", { space, title: "Intruder", content: "x" })).status).toBe(403);
    }
    expect((await call<DriveListing>(BETO, "GET", "/api/drive/list")).body.items.map((item) => item.name)).toEqual(["Contracts"]);
    expect((await call<DriveListing>(CARLA, "GET", "/api/drive/list")).body.items).toEqual([]);

    expect((await agent("evergreen", "drive-list", {})).body.text).toContain("Contracts");
    expect((await agent("evergreen", "drive-read", { path: "Contracts/deal.txt" })).body.text).toContain("evergreen contract");
    expect((await agent("evergreen", "drive-read", { path: "Reports/q4.md" })).status).toBe(404);
    expect((await agent("evergreen", "drive-save", { path: "Reports/q4.md", text: "overwrite attempt", space: "internal" })).body.text).toContain("Saved Reports/q4.md");
    expect((await call(ANA, "GET", `/api/drive/download?space=internal&path=${encode("Reports/q4.md")}`)).text).toBe("first draft");
    expect((await call(ANA, "GET", `/api/drive/download?space=client:evergreen&path=${encode("Reports/q4.md")}`)).text).toBe("overwrite attempt");
    expect((await agent("evergreen", "wiki-read", { title: "Pricing" })).status).toBe(404);
    expect((await agent("evergreen", "wiki-search", { query: "pricing" })).body.text).toContain("No Wiki page matches");
    expect((await agent("lumon", "wiki-read", { title: "EVERGREEN brief" })).status).toBe(404);
    expect((await agent("lumon", "drive-list", {})).body.text).toContain("is empty");
    expect((await agent("gerentedeoperacao", "wiki-read", { title: "EVERGREEN brief" })).status).toBe(404);
    expect((await agent("gerentedeoperacao", "drive-read", { path: "Contracts/deal.txt" })).status).toBe(404);
  });

  it("only an admin or the person who saved a file can delete it, and a deleted file can be brought back", async () => {
    const listed = (await call<DriveListing>(EVA, "GET", `/api/drive/list?path=Contracts`)).body.items;
    expect(listed).toMatchObject([{ name: "deal.txt", canDelete: false }]);
    expect((await call<{ code: string }>(EVA, "DELETE", `/api/drive/file?path=${encode("Contracts/deal.txt")}`)).body.code).toBe("forbidden");
    expect((await call(BETO, "DELETE", `/api/drive/file?path=${encode("Contracts/deal.txt")}`)).status).toBe(200);
    const trash = (await call<{ items: Array<{ id: string; name: string }> }>(BETO, "GET", "/api/drive/trash")).body.items;
    expect(trash.map((item) => item.name)).toEqual(["deal.txt"]);
    expect((await call(EVA, "POST", "/api/drive/trash/restore", { id: trash[0]!.id })).status).toBe(403);
    expect((await call(BETO, "POST", "/api/drive/trash/restore", { id: trash[0]!.id })).status).toBe(200);
    expect((await call(BETO, "GET", `/api/drive/download?path=${encode("Contracts/deal.txt")}`)).text).toBe("evergreen contract");
  });

  it("keeps each space in its own folder on disk", () => {
    const root = join(home, ".nordus", "knowledge");
    expect(readdirSync(root).sort()).toEqual(["clients", "internal"]);
    expect(readdirSync(join(root, "clients")).sort()).toEqual(["evergreen", "lumon"]);
    expect(existsSync(join(root, "internal", "drive.json"))).toBe(true);
    expect(existsSync(join(root, "clients", "evergreen", "wiki.json"))).toBe(true);
  });

  it("an internal agent follows the room it is in: a client's room saves in that client's Drive, and another client's room cannot reach it", async () => {
    const room = async (name: string, client: string) => {
      const created = await call<{ group: { id: string; threadId: string } }>(ANA, "POST", "/api/groups", { name, memberIds: [bots.gerentedeoperacao.id] });
      expect(created.status, created.text).toBe(201);
      expect((await call(ANA, "PATCH", `/api/groups/${created.body.group.id}`, { client })).status).toBe(200);
      return created.body.group.threadId;
    };
    const fabrikam = await room("Fabrikam room", "fabrikam");
    const evergreen = await room("EVERGREEN room", "evergreen");

    expect((await agent("gerentedeoperacao", "drive-save", { path: "Planning/calendar.md", text: "fabrikam calendar" }, fabrikam)).status).toBe(200);
    expect((await agent("gerentedeoperacao", "wiki-write", { title: "Fabrikam brief", content: "fabrikam only" }, fabrikam)).status).toBe(200);
    expect((await agent("gerentedeoperacao", "drive-read", { path: "Contracts/deal.txt" }, fabrikam)).status).toBe(404);

    expect((await agent("gerentedeoperacao", "drive-read", { path: "Contracts/deal.txt" }, evergreen)).body.text).toContain("evergreen contract");
    expect((await agent("gerentedeoperacao", "drive-read", { path: "Planning/calendar.md" }, evergreen)).status).toBe(404);
    expect((await agent("gerentedeoperacao", "wiki-read", { title: "Fabrikam brief" }, evergreen)).status).toBe(404);
    expect((await agent("gerentedeoperacao", "wiki-search", { query: "fabrikam" }, evergreen)).body.text).toContain("No Wiki page matches");
    expect((await agent("gerentedeoperacao", "drive-list", {}, evergreen)).body.text).not.toContain("Planning");

    expect((await call(ANA, "GET", `/api/drive/download?space=client:fabrikam&path=${encode("Planning/calendar.md")}`)).text).toBe("fabrikam calendar");
    expect((await call(ANA, "GET", `/api/drive/download?space=client:evergreen&path=${encode("Planning/calendar.md")}`)).status).toBe(404);
    expect((await call(ANA, "GET", `/api/drive/download?space=internal&path=${encode("Planning/calendar.md")}`)).status).toBe(404);
  });

  it("'Save to the Drive' sends only the conversation, and the server picks the space", async () => {
    const created = await call<{ group: { id: string; threadId: string } }>(ANA, "POST", "/api/groups", { name: "Chart room", memberIds: [bots.gerentedeoperacao.id] });
    await call(ANA, "PATCH", `/api/groups/${created.body.group.id}`, { client: "northwind" });
    const thread = created.body.group.threadId;
    const saved = await call<DriveSaveResult & { space: string }>(ANA, "PUT", `/api/drive/file?conversation=${encode(thread)}&space=internal&path=${encode("Chat/chart.txt")}`, "chart");
    expect([saved.status, saved.body.space]).toEqual([201, "client:northwind"]);
    expect((await call(ANA, "GET", `/api/drive/download?space=client:northwind&path=${encode("Chat/chart.txt")}`)).text).toBe("chart");
    expect((await call(ANA, "GET", `/api/drive/download?space=internal&path=${encode("Chat/chart.txt")}`)).status).toBe(404);

    const outsider = await call<{ code: string }>(BETO, "PUT", `/api/drive/file?conversation=${encode(thread)}&space=client:evergreen&path=${encode("Chat/intruder.txt")}`, "x");
    expect([outsider.status, outsider.body.code]).toEqual([403, "no_space"]);
    expect((await call(ANA, "GET", `/api/drive/download?space=client:evergreen&path=${encode("Chat/intruder.txt")}`)).status).toBe(404);
    const unknown = await call<{ code: string }>(ANA, "PUT", `/api/drive/file?conversation=no-such-thread&path=${encode("Chat/x.txt")}`, "x");
    expect([unknown.status, unknown.body.code]).toEqual([403, "no_space"]);
  });

  it("opens the company's space to the people an admin names, and to no one else", async () => {
    expect((await call(OUTSIDER, "GET", "/api/drive/spaces")).body).toEqual({ spaces: [], admin: false });
    for (const who of [BETO, OUTSIDER]) {
      expect((await call(who, "GET", "/api/drive/internal-people")).status, who).toBe(403);
      expect((await call(who, "PUT", "/api/drive/internal-people", { people: [who] })).status, who).toBe(403);
    }
    expect((await call(ANA, "PUT", "/api/drive/internal-people", { people: ["@nowhere.test"] })).status).toBe(400);
    const named = await call<{ people: string[] }>(ANA, "PUT", "/api/drive/internal-people", { people: [OUTSIDER] });
    expect([named.status, named.body.people]).toEqual([200, [OUTSIDER]]);
    expect((await call<{ spaces: Array<{ id: string }> }>(OUTSIDER, "GET", "/api/drive/spaces")).body.spaces.map((space) => space.id)).toEqual(["internal"]);
    expect((await call(OUTSIDER, "GET", `/api/drive/download?space=internal&path=${encode("Reports/q4.md")}`)).text).toBe("first draft");
    expect((await call(BETO, "GET", "/api/drive/list?space=internal")).status).toBe(403);
    expect(JSON.parse(readFileSync(join(home, ".nordus", "knowledge", "settings.json"), "utf8"))).toMatchObject({ internalPeople: [OUTSIDER] });

    expect((await call(ANA, "PUT", "/api/drive/internal-people", { people: [] })).status).toBe(200);
    expect((await call(OUTSIDER, "GET", "/api/drive/spaces")).body).toEqual({ spaces: [], admin: false });
    expect((await call(OUTSIDER, "GET", "/api/drive/list?space=internal")).status).toBe(403);
  });
});
