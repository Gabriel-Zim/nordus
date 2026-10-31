import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DriveListing, DriveSaveResult, WikiImportSummary, WikiListing, WikiPageDetail, WikiSaveResult } from "../../shared/knowledge.ts";
import type { Viewer } from "../bot-visibility.ts";
import { json, readBody } from "../harness/http.ts";
import { admin, botAsker, diskOf, isolated, lookupIn, type ConversationBook, type TestBot } from "../knowledge/testing.ts";
import { createKnowledge } from "../knowledge/wiring.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import type { SessionRecord } from "../sessions.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const people: Record<string, { name: string; email: string }> = {
  beto: { name: "Beto", email: "beto@evergreen.test" },
  eva: { name: "Eva", email: "eva@evergreen.test" },
  ana: { name: "Ana", email: "ana@zorg.test" },
  carla: { name: "Carla", email: "carla@fabrikam.test" },
};

function authFor(who: string): RequestAuth {
  if (who === "admin") return { kind: "loopback", scopes: ["admin", "client"] };
  const person = people[who]!;
  const session = { id: `s-${who}`, label: who, scopes: ["client"], ...person } as unknown as SessionRecord;
  return { kind: "session", session, via: "bearer", scopes: ["client"] };
}

async function serve(limits: Record<string, string> = {}, bots: readonly TestBot[] = isolated) {
  const folder = mkdtempSync(join(tmpdir(), "knowledge-routes-"));
  folders.push(folder);
  const book: ConversationBook = new Map();
  const knowledge = createKnowledge({
    dataDir: folder,
    env: limits,
    bots: () => bots,
    internal: () => (bot) => bot.internal === true,
    viewerFor: (auth): Viewer => (auth.kind === "loopback" || auth.scopes.includes("admin") ? { kind: "all" } : { kind: "member", email: auth.session.email }),
    sender: (auth) => (auth.kind === "session" ? { name: auth.session.name ?? "?", id: auth.session.id, email: auth.session.email } : { name: "Owner" }),
    conversation: lookupIn(book),
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const who = String(req.headers["x-test-user"] ?? "admin");
    try {
      const handled = await dispatchRoutes(knowledge.routes, {
        req, res, url, path: url.pathname, method: req.method ?? "GET", auth: authFor(who), json, readBody,
      });
      if (!handled) json(res, 404, { from: "inline routes" });
    } catch (error) {
      json(res, typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500, { error: String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (who: string) => {
    const request = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const raw = body instanceof Uint8Array || typeof body === "string";
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { "x-test-user": who, ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...headers },
        ...(body === undefined ? {} : { body: raw ? (body as string | Uint8Array) : JSON.stringify(body) }),
      });
      return response;
    };
    const data = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => {
      const response = await request(method, path, body);
      return { status: response.status, body: (await response.json()) as T, response };
    };
    return { request, data };
  };
  return { ...knowledge, base, as: call, book };
}

const enc = encodeURIComponent;

describe("Drive over HTTP", () => {
  it("uploads, keeps a version on the second upload, restores, and downloads the right bytes", async () => {
    const { as } = await serve();
    const beto = as("beto");
    const first = await beto.data<DriveSaveResult>("PUT", `/api/drive/file?path=${enc("Reports/q4.md")}`, Buffer.from("first"));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ outcome: "created", version: 1, file: { name: "q4.md", versions: 1, by: { kind: "person", name: "Beto" } } });
    const second = await beto.data<DriveSaveResult>("PUT", `/api/drive/file?path=${enc("Reports/q4.md")}&note=${enc("rewrite")}`, Buffer.from("second"));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ outcome: "updated", version: 2 });
    const same = await beto.data<DriveSaveResult>("PUT", `/api/drive/file?path=${enc("Reports/q4.md")}`, Buffer.from("second"));
    expect(same.body.outcome).toBe("unchanged");

    const info = await beto.data<{ versions: Array<{ n: number; note?: string; current: boolean }> }>("GET", `/api/drive/info?path=${enc("Reports/q4.md")}`);
    expect(info.body.versions.map((version) => [version.n, version.note, version.current])).toEqual([[2, "rewrite", true], [1, undefined, false]]);

    const restored = await beto.data<DriveSaveResult>("POST", "/api/drive/restore", { path: "Reports/q4.md", version: 1 });
    expect(restored.body).toMatchObject({ outcome: "updated", version: 3 });
    const download = await beto.request("GET", `/api/drive/download?path=${enc("Reports/q4.md")}`);
    expect(await download.text()).toBe("first");
    const older = await beto.request("GET", `/api/drive/download?path=${enc("Reports/q4.md")}&version=2`);
    expect(await older.text()).toBe("second");

    const listing = await beto.data<DriveListing>("GET", "/api/drive/list");
    expect(listing.body).toMatchObject({ space: "client:evergreen", path: "", items: [{ kind: "folder", name: "Reports" }] });
    expect((await beto.data<DriveListing>("GET", "/api/drive/list?path=reports")).body.items).toMatchObject([{ kind: "file", name: "q4.md", versions: 3 }]);
  });

  it("serves downloads as attachments inside a sandbox and never as a page", async () => {
    const { as } = await serve();
    const beto = as("beto");
    for (const [name, content] of [["page.html", "<script>alert(1)</script>"], ["vector.svg", "<svg onload=alert(1)/>"], ["notes.txt", "plain"], ["éxito ação.md", "# hi"]] as const) {
      await beto.data("PUT", `/api/drive/file?path=${enc(name)}`, Buffer.from(content));
      const response = await beto.request("GET", `/api/drive/download?path=${enc(name)}`);
      expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toBe("sandbox");
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
      expect(await response.text()).toBe(content);
    }
    expect((await beto.request("GET", `/api/drive/download?path=page.html`)).headers.get("content-type")).toBe("application/octet-stream");
    expect((await beto.request("GET", `/api/drive/download?path=vector.svg`)).headers.get("content-type")).toBe("application/octet-stream");
    expect((await beto.request("GET", `/api/drive/download?path=notes.txt`)).headers.get("content-type")).toBe("text/plain");
  });

  it("previews text as plain text and refuses a preview with no safe form", async () => {
    const { as } = await serve();
    const beto = as("beto");
    await beto.data("PUT", `/api/drive/file?path=page.html`, Buffer.from("<b>x</b>"));
    await beto.data("PUT", `/api/drive/file?path=data.csv`, Buffer.from("a,b\n1,2\n"));
    await beto.data("PUT", `/api/drive/file?path=tool.exe`, Buffer.from("MZ"));
    await beto.data("PUT", `/api/drive/file?path=pic.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const html = await beto.request("GET", "/api/drive/preview?path=page.html");
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(html.headers.get("content-security-policy")).toBe("sandbox");
    expect(await html.text()).toBe("<b>x</b>");
    expect(await (await beto.request("GET", "/api/drive/preview?path=data.csv")).text()).toBe("a,b\n1,2\n");
    const blocked = await beto.data<{ code: string }>("GET", "/api/drive/preview?path=tool.exe");
    expect([blocked.status, blocked.body.code]).toEqual([415, "no_preview"]);
    const image = await beto.request("GET", "/api/drive/preview?path=pic.png");
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("answers a repeat request with 304 and honours a byte range", async () => {
    const { as } = await serve();
    const beto = as("beto");
    await beto.data("PUT", `/api/drive/file?path=clip.mp3`, Buffer.from("0123456789"));
    const first = await beto.request("GET", "/api/drive/download?path=clip.mp3");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    await first.arrayBuffer();
    const cached = await beto.request("GET", "/api/drive/download?path=clip.mp3", undefined, { "if-none-match": etag });
    expect(cached.status).toBe(304);
    const part = await beto.request("GET", "/api/drive/preview?path=clip.mp3", undefined, { range: "bytes=2-5" });
    expect([part.status, part.headers.get("content-range"), await part.text()]).toEqual([206, "bytes 2-5/10", "2345"]);
    expect((await beto.request("GET", "/api/drive/preview?path=clip.mp3", undefined, { range: "bytes=50-" })).status).toBe(416);
  });

  it("keeps spaces apart for each person and for admins", async () => {
    const { as } = await serve();
    expect((await as("admin").data("PUT", "/api/drive/internal-people", { people: ["ana@zorg.test"] })).status).toBe(200);
    await as("beto").data("PUT", `/api/drive/file?path=evergreen.txt`, Buffer.from("evergreen"));
    await as("ana").data("PUT", `/api/drive/file?path=zorg.txt`, Buffer.from("zorg"));
    const betoSpaces = await as("beto").data<{ spaces: Array<{ id: string }> }>("GET", "/api/drive/spaces");
    expect(betoSpaces.body.spaces.map((space) => space.id)).toEqual(["client:evergreen"]);
    expect((await as("ana").data<{ spaces: Array<{ id: string }> }>("GET", "/api/drive/spaces")).body.spaces.map((space) => space.id)).toEqual(["internal"]);
    expect((await as("admin").data<{ spaces: Array<{ id: string }> }>("GET", "/api/drive/spaces")).body.spaces.map((space) => space.id)).toEqual(["internal", "client:evergreen", "client:fabrikam"]);

    const wrong = await as("beto").data<{ code: string }>("GET", "/api/drive/list?space=internal");
    expect([wrong.status, wrong.body.code]).toEqual([403, "no_space"]);
    expect((await as("beto").request("GET", "/api/drive/download?space=internal&path=zorg.txt")).status).toBe(403);
    expect((await as("beto").request("GET", "/api/drive/download?path=zorg.txt")).status).toBe(404);
    expect((await as("carla").data<DriveListing>("GET", "/api/drive/list")).body.items).toEqual([]);
    expect((await as("carla").request("PUT", `/api/drive/file?space=client:evergreen&path=intruder.txt`, Buffer.from("x"))).status).toBe(403);
    expect((await as("admin").data<DriveListing>("GET", "/api/drive/list?space=client:evergreen")).body.items).toMatchObject([{ name: "evergreen.txt" }]);
    expect((await as("nobody").data("GET", "/api/drive/spaces")).body).toEqual({ spaces: [], admin: false });
    expect((await as("nobody").data<{ code: string }>("GET", "/api/drive/list")).body.code).toBe("no_space");
  });

  it("refuses paths that climb out of the Drive", async () => {
    const { as } = await serve();
    const beto = as("beto");
    for (const query of [enc("../../etc/passwd"), enc("a/../../b"), enc("a\\b"), "%2e%2e%2fx", "..%2F..%2Fx", enc("ok/\u202Egpj.exe"), enc("a\u0000b")]) {
      const upload = await beto.data<{ code: string }>("PUT", `/api/drive/file?path=${query}`, Buffer.from("x"));
      expect([query, upload.status, upload.body.code]).toEqual([query, 400, "bad_path"]);
    }
    const literal = await beto.data<DriveSaveResult>("PUT", `/api/drive/file?path=${enc("%2e%2e/x")}`, Buffer.from("x"));
    expect([literal.status, literal.body.file.path]).toEqual([201, "%2e%2e/x"]);
    expect((await beto.data<DriveListing>("GET", "/api/drive/list")).body.items).toMatchObject([{ kind: "folder", name: "%2e%2e" }]);
    expect((await beto.data<{ code: string }>("GET", `/api/drive/download?path=${enc("../../etc/passwd")}`)).body.code).toBe("bad_path");
    expect((await beto.data<{ code: string }>("GET", `/api/drive/list?path=${enc("../..")}`)).body.code).toBe("bad_path");
    expect((await beto.data<{ code: string }>("POST", "/api/drive/move", { from: "a", to: "../b" })).body.code).toBe("bad_path");
    expect((await beto.data<{ code: string }>("GET", "/api/drive/download")).body.code).toBe("bad_path");
  });

  it("stops an upload over the file cap, before and while it is read", async () => {
    const { as } = await serve({ NORDUS_DRIVE_FILE_MAX_BYTES: "10" });
    const beto = as("beto");
    const tooBig = await beto.data<{ code: string }>("PUT", `/api/drive/file?path=big.bin`, Buffer.from("x".repeat(11)));
    expect([tooBig.status, tooBig.body.code]).toEqual([413, "too_large"]);
    expect((await beto.data<DriveListing>("GET", "/api/drive/list")).body.items).toEqual([]);
    expect((await beto.data("PUT", `/api/drive/file?path=ok.bin`, Buffer.from("x".repeat(10)))).status).toBe(201);
  });

  it("lets only an admin or the person who saved a file delete it, and keeps it recoverable", async () => {
    const { as } = await serve();
    await as("beto").data("PUT", `/api/drive/file?path=mine.txt`, Buffer.from("m"));
    const listing = (await as("eva").data<DriveListing>("GET", "/api/drive/list")).body;
    expect(listing.items).toMatchObject([{ name: "mine.txt", canDelete: false }]);
    const refused = await as("eva").data<{ code: string }>("DELETE", "/api/drive/file?path=mine.txt");
    expect([refused.status, refused.body.code]).toEqual([403, "forbidden"]);
    expect((await as("beto").data("DELETE", "/api/drive/file?path=mine.txt")).body).toEqual({ trashed: 1 });
    const trash = (await as("eva").data<{ items: Array<{ id: string; name: string }> }>("GET", "/api/drive/trash")).body.items;
    expect(trash.map((item) => item.name)).toEqual(["mine.txt"]);
    expect((await as("eva").data("POST", "/api/drive/trash/restore", { id: trash[0]!.id })).status).toBe(403);
    expect((await as("admin").data("POST", "/api/drive/trash/restore", { space: "client:evergreen", id: trash[0]!.id })).status).toBe(200);
    expect((await as("beto").data<DriveListing>("GET", "/api/drive/list")).body.items).toMatchObject([{ name: "mine.txt" }]);
  });

  it("creates folders, moves files and searches by name", async () => {
    const { as } = await serve();
    const beto = as("beto");
    expect((await beto.data("POST", "/api/drive/folder", { path: "Clients/EVERGREEN" })).status).toBe(201);
    expect((await beto.data("POST", "/api/drive/folder", { path: "clients/evergreen" })).status).toBe(200);
    await beto.data("PUT", `/api/drive/file?path=${enc("Clients/EVERGREEN/contract.pdf")}`, Buffer.from("pdf"));
    expect((await beto.data("POST", "/api/drive/move", { from: "Clients/EVERGREEN/contract.pdf", to: "Clients/EVERGREEN/signed.pdf" })).body).toMatchObject({ moved: 1 });
    expect((await beto.data<{ files: Array<{ path: string }> }>("GET", "/api/drive/search?q=SIGNED")).body.files.map((file) => file.path)).toEqual(["Clients/EVERGREEN/signed.pdf"]);
    expect((await beto.data<{ files: unknown[] }>("GET", "/api/drive/search?q=")).body.files).toEqual([]);
  });

  it("leaves other paths to the next handler", async () => {
    const { as } = await serve();
    for (const path of ["/api/drive", "/api/driver/list", "/api/drive/unknown", "/api/wiki", "/api/wikipedia/x"]) {
      expect((await as("beto").data("GET", path)).body).toEqual({ from: "inline routes" });
    }
  });
});

describe("Wiki over HTTP", () => {
  it("creates, reads, searches, edits with a version check, and shows history", async () => {
    const { as } = await serve();
    const beto = as("beto");
    const target = await beto.data<WikiSaveResult>("POST", "/api/wiki/page", { title: "Target", content: "target text" });
    expect(target.status).toBe(201);
    const source = await beto.data<WikiSaveResult>("POST", "/api/wiki/page", { title: "Source", folder: "Notes", content: "see [[Target]] and [[Target|alias]] and [[Target#Part]]" });
    const detail = await beto.data<WikiPageDetail>("GET", `/api/wiki/page?id=${target.body.page.id}`);
    expect(detail.body).toMatchObject({ title: "Target", version: 1, backlinks: [{ title: "Source", folder: "Notes" }], canDelete: true, createdBy: { name: "Beto" } });
    expect((await beto.data<WikiPageDetail>("GET", `/api/wiki/page?id=${source.body.page.id}`)).body.links).toEqual({ Target: target.body.page.id });

    const list = await beto.data<WikiListing>("GET", "/api/wiki/pages?q=target");
    expect(list.body.pages.map((page) => page.title)).toEqual(["Target", "Source"]);
    expect(list.body.pages[0]!.snippet).toBe("target text");
    expect((await beto.data<WikiListing>("GET", "/api/wiki/pages?folder=Notes")).body.pages.map((page) => page.title)).toEqual(["Source"]);

    const edited = await beto.data<WikiSaveResult>("PATCH", "/api/wiki/page", { id: target.body.page.id, content: "better", expectedVersion: 1, summary: "clearer" });
    expect(edited.body).toMatchObject({ outcome: "updated", page: { version: 2 } });
    const stale = await beto.data<{ code: string; currentVersion: number }>("PATCH", "/api/wiki/page", { id: target.body.page.id, content: "lost", expectedVersion: 1 });
    expect([stale.status, stale.body.code, stale.body.currentVersion]).toEqual([409, "conflict", 2]);

    const versions = await beto.data<{ versions: Array<{ n: number; summary?: string; current: boolean }> }>("GET", `/api/wiki/versions?id=${target.body.page.id}`);
    expect(versions.body.versions.map((version) => [version.n, version.summary, version.current])).toEqual([[2, "clearer", true], [1, undefined, false]]);
    expect((await beto.data<{ content: string }>("GET", `/api/wiki/version?id=${target.body.page.id}&n=1`)).body.content).toBe("target text");
    const restored = await beto.data<WikiSaveResult>("POST", "/api/wiki/restore", { id: target.body.page.id, version: 1 });
    expect(restored.body).toMatchObject({ page: { version: 3, content: "target text" } });
  });

  it("draws the graph and keeps a deleted page in the trash", async () => {
    const { as } = await serve();
    const beto = as("beto");
    const a = (await beto.data<WikiSaveResult>("POST", "/api/wiki/page", { title: "A", content: "[[B]]" })).body.page.id;
    const b = (await beto.data<WikiSaveResult>("POST", "/api/wiki/page", { title: "B", content: "" })).body.page.id;
    const graph = (await beto.data<{ nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> }>("GET", "/api/wiki/graph")).body;
    expect(graph.edges).toEqual([{ source: a, target: b }]);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([a, b].sort());
    expect((await beto.data("DELETE", `/api/wiki/page?id=${b}`)).status).toBe(200);
    expect((await beto.data("GET", `/api/wiki/page?id=${b}`)).status).toBe(404);
    expect((await beto.data<{ items: Array<{ title: string }> }>("GET", "/api/wiki/trash")).body.items.map((item) => item.title)).toEqual(["B"]);
    expect((await beto.data("POST", "/api/wiki/trash/restore", { id: b })).status).toBe(200);
    expect((await beto.data("GET", `/api/wiki/page?id=${b}`)).status).toBe(200);
  });

  it("keeps each space's pages apart", async () => {
    const { as } = await serve();
    await as("admin").data("PUT", "/api/drive/internal-people", { people: ["ana@zorg.test"] });
    const page = (await as("beto").data<WikiSaveResult>("POST", "/api/wiki/page", { title: "Client secret", content: "evergreen only" })).body.page.id;
    expect((await as("ana").data<WikiListing>("GET", "/api/wiki/pages")).body.pages).toEqual([]);
    expect((await as("ana").data("GET", `/api/wiki/page?id=${page}`)).status).toBe(404);
    expect((await as("ana").data("GET", `/api/wiki/page?space=client:evergreen&id=${page}`)).status).toBe(403);
    expect((await as("carla").data("POST", "/api/wiki/page", { space: "client:evergreen", title: "Intruder", content: "x" })).status).toBe(403);
    expect((await as("admin").data<WikiListing>("GET", "/api/wiki/pages?space=client:evergreen")).body.pages.map((entry) => entry.title)).toEqual(["Client secret"]);
    expect((await as("ana").data("DELETE", `/api/wiki/page?id=${page}`)).status).toBe(404);
  });

  it("imports a vault folder file by file, then shows the pages and pictures", async () => {
    const { as } = await serve({ NORDUS_WIKI_IMPORT_MAX_FILES: "6" });
    const beto = as("beto");
    const started = await beto.data<{ session: string; root: string; limits: { maxFiles: number } }>("POST", "/api/wiki/import/start", { root: "Vault" });
    expect([started.status, started.body.root, started.body.limits.maxFiles]).toEqual([201, "Vault", 6]);
    const send = (path: string, content: string | Buffer) => beto.data<{ accepted: boolean; skipped?: string }>("PUT", `/api/wiki/import/file?session=${started.body.session}&path=${enc(path)}`, content);
    expect((await send("Home.md", "---\ntags: [x]\n---\n# Home\n[[Other]] ![[pic.png]]")).body.accepted).toBe(true);
    expect((await send("Folder/Other.md", "back to [[Home]]")).body.accepted).toBe(true);
    expect((await send("img/pic.png", Buffer.from([1, 2, 3]))).body.accepted).toBe(true);
    expect((await send(".obsidian/workspace.json", "{}")).body).toEqual({ accepted: false, skipped: "hidden" });

    const stranger = await as("eva").data("POST", "/api/wiki/import/finish", { session: started.body.session });
    expect(stranger.status).toBe(404);
    const summary = await beto.data<WikiImportSummary>("POST", "/api/wiki/import/finish", { session: started.body.session });
    expect(summary.body).toMatchObject({ root: "Vault", pages: { created: 2 }, attachments: { created: 1 }, links: { resolved: 2, missing: 0 }, skippedCount: 1 });
    const home = (await beto.data<WikiListing>("GET", "/api/wiki/pages?q=home")).body.pages[0]!;
    const detail = await beto.data<WikiPageDetail>("GET", `/api/wiki/page?id=${home.id}`);
    expect(detail.body.content).toBe("---\ntags: [x]\n---\n# Home\n[[Other]] ![[pic.png]]");
    expect(detail.body.files).toEqual({ "pic.png": "Wiki/anexos/Vault/img/pic.png" });
    expect(detail.body.backlinks.map((link) => link.title)).toEqual(["Other"]);
    expect((await beto.data<DriveListing>("GET", "/api/drive/list?path=Wiki/anexos/Vault/img")).body.items).toMatchObject([{ name: "pic.png" }]);
  });

  it("stops an import that has too many files and lets the person cancel", async () => {
    const { as } = await serve({ NORDUS_WIKI_IMPORT_MAX_FILES: "2" });
    const beto = as("beto");
    const started = (await beto.data<{ session: string }>("POST", "/api/wiki/import/start", { root: "V" })).body.session;
    const send = (path: string) => beto.data<{ code?: string }>("PUT", `/api/wiki/import/file?session=${started}&path=${enc(path)}`, "x");
    await send("a.md");
    await send("b.md");
    const refused = await send("c.md");
    expect([refused.status, refused.body.code]).toEqual([413, "limit"]);
    expect((await beto.data("POST", "/api/wiki/import/cancel", { session: started })).status).toBe(200);
    expect((await beto.data("POST", "/api/wiki/import/finish", { session: started })).status).toBe(404);
  });
});

describe("who may reach these routes", () => {
  it("lists each route for members, and leaves anything else to the default of admins only", () => {
    const member: Array<[string, string]> = [
      ["GET", "/api/drive/spaces"], ["GET", "/api/drive/list"], ["GET", "/api/drive/search"], ["GET", "/api/drive/info"], ["GET", "/api/drive/download"], ["GET", "/api/drive/preview"],
      ["POST", "/api/drive/folder"], ["PUT", "/api/drive/file"], ["DELETE", "/api/drive/file"], ["POST", "/api/drive/restore"], ["POST", "/api/drive/move"], ["GET", "/api/drive/trash"], ["POST", "/api/drive/trash/restore"],
      ["GET", "/api/wiki/spaces"], ["GET", "/api/wiki/pages"], ["GET", "/api/wiki/page"], ["POST", "/api/wiki/page"], ["PATCH", "/api/wiki/page"], ["DELETE", "/api/wiki/page"],
      ["GET", "/api/wiki/versions"], ["GET", "/api/wiki/version"], ["POST", "/api/wiki/restore"], ["GET", "/api/wiki/graph"], ["GET", "/api/wiki/trash"], ["POST", "/api/wiki/trash/restore"],
      ["POST", "/api/wiki/import/start"], ["PUT", "/api/wiki/import/file"], ["POST", "/api/wiki/import/finish"], ["POST", "/api/wiki/import/cancel"],
    ];
    for (const [method, path] of member) expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
    for (const [method, path] of [["GET", "/api/drive/anything"], ["POST", "/api/drive/list"], ["GET", "/api/drive/file"], ["PUT", "/api/wiki/page"], ["GET", "/api/wiki/import/file"], ["DELETE", "/api/drive/folder"], ["GET", "/api/drive/list/extra"], ["GET", "/api/drive/internal-people"], ["PUT", "/api/drive/internal-people"]] as const) {
      expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
    }
  });
});

describe("who opens the company's space", () => {
  it("keeps it closed to the company's own people until an admin names them", async () => {
    const { as } = await serve();
    expect((await as("ana").data("GET", "/api/drive/spaces")).body).toEqual({ spaces: [], admin: false });
    expect((await as("ana").data<{ code: string }>("GET", "/api/drive/list?space=internal")).body.code).toBe("no_space");
    expect((await as("ana").data<{ code: string }>("GET", "/api/drive/list")).body.code).toBe("no_space");
    expect((await as("ana").data("GET", "/api/wiki/pages?space=internal")).status).toBe(403);
    expect((await as("ana").data("PUT", `/api/drive/file?space=internal&path=a.txt`, Buffer.from("x"))).status).toBe(403);
    expect((await as("ana").data("POST", "/api/wiki/page", { space: "internal", title: "Mine", content: "x" })).status).toBe(403);
    expect((await as("admin").data<{ spaces: Array<{ id: string }>; admin: boolean }>("GET", "/api/drive/spaces")).body).toMatchObject({ admin: true });
  });

  it("opens it to the people an admin named, and closes it again when they are taken off", async () => {
    const { as } = await serve();
    expect((await as("admin").data<{ people: string[] }>("GET", "/api/drive/internal-people")).body).toEqual({ people: [] });
    const named = await as("admin").data<{ people: string[] }>("PUT", "/api/drive/internal-people", { people: [" Ana@ZORG.test ", "ana@zorg.test"] });
    expect([named.status, named.body.people]).toEqual([200, ["ana@zorg.test"]]);
    expect((await as("admin").data("GET", "/api/drive/internal-people")).body).toEqual({ people: ["ana@zorg.test"] });
    expect((await as("ana").data<{ spaces: Array<{ id: string }> }>("GET", "/api/drive/spaces")).body.spaces.map((space) => space.id)).toEqual(["internal"]);
    expect((await as("ana").data("PUT", `/api/drive/file?path=a.txt`, Buffer.from("x"))).status).toBe(201);
    expect((await as("beto").data<{ spaces: Array<{ id: string }> }>("GET", "/api/drive/spaces")).body.spaces.map((space) => space.id)).toEqual(["client:evergreen"]);
    expect((await as("beto").data<{ code: string }>("GET", "/api/drive/list?space=internal")).body.code).toBe("no_space");

    await as("admin").data("PUT", "/api/drive/internal-people", { people: [] });
    expect((await as("ana").data("GET", "/api/drive/spaces")).body).toEqual({ spaces: [], admin: false });
    expect((await as("ana").data<{ code: string }>("GET", "/api/drive/list?space=internal")).body.code).toBe("no_space");
  });

  it("lets only an admin read or change the list, so nobody can open the space to themselves", async () => {
    const { as } = await serve();
    for (const who of ["ana", "beto", "carla"]) {
      const read = await as(who).data<{ code: string }>("GET", "/api/drive/internal-people");
      expect([who, read.status, read.body.code]).toEqual([who, 403, "forbidden"]);
      const write = await as(who).data<{ code: string }>("PUT", "/api/drive/internal-people", { people: [`${who}@zorg.test`, people[who]!.email] });
      expect([who, write.status, write.body.code]).toEqual([who, 403, "forbidden"]);
    }
    expect((await as("admin").data("GET", "/api/drive/internal-people")).body).toEqual({ people: [] });
    expect((await as("ana").data<{ code: string }>("GET", "/api/drive/list?space=internal")).body.code).toBe("no_space");
  });

  it("takes whole addresses only", async () => {
    const { as } = await serve();
    for (const people of [["@zorg.test"], ["*"], ["everyone"], [7], "ana@zorg.test", null]) {
      const refused = await as("admin").data<{ code: string }>("PUT", "/api/drive/internal-people", { people });
      expect([JSON.stringify(people), refused.status, refused.body.code]).toEqual([JSON.stringify(people), 400, "bad_input"]);
    }
    const tooMany = await as("admin").data<{ code: string }>("PUT", "/api/drive/internal-people", { people: Array.from({ length: 201 }, (_, index) => `p${index}@zorg.test`) });
    expect([tooMany.status, tooMany.body.code]).toEqual([413, "limit"]);
    expect((await as("admin").data("GET", "/api/drive/internal-people")).body).toEqual({ people: [] });
  });
});

describe("saving from a conversation", () => {
  const send = (who: ReturnType<Awaited<ReturnType<typeof serve>>["as"]>, query: string, content = "from the chat") =>
    who.data<DriveSaveResult & { space: string; code?: string; error?: string }>("PUT", `/api/drive/file?${query}&path=${enc("Chat/note.txt")}`, Buffer.from(content));
  const spaceHolds = async (admin: ReturnType<Awaited<ReturnType<typeof serve>>["as"]>, space: string) => {
    const listed = await admin.data<DriveListing>("GET", `/api/drive/list?space=${enc(space)}&path=Chat`);
    return listed.status === 404 ? [] : listed.body.items.map((item) => item.name);
  };

  it("puts the file in the space the server gives the conversation, whatever space the browser names", async () => {
    const { as, book } = await serve();
    book.set("room-fabrikam", { roomClient: "fabrikam", members: ["gerentedeoperacao"] });
    const saved = await send(as("admin"), `conversation=room-fabrikam&space=${enc("client:evergreen")}`);
    expect([saved.status, saved.body.space, saved.body.file.path]).toEqual([201, "client:fabrikam", "Chat/note.txt"]);
    expect(await spaceHolds(as("admin"), "client:fabrikam")).toEqual(["note.txt"]);
    expect(await spaceHolds(as("admin"), "client:evergreen")).toEqual([]);
    expect(await spaceHolds(as("admin"), "internal")).toEqual([]);
  });

  it("refuses a person who may not use the conversation's space, and does not fall back to a space of theirs", async () => {
    const { as, book } = await serve();
    book.set("room-fabrikam", { roomClient: "fabrikam", members: ["fabrikam-bot"] });
    for (const query of ["conversation=room-fabrikam", `conversation=room-fabrikam&space=${enc("client:evergreen")}`]) {
      const refused = await send(as("beto"), query);
      expect([query, refused.status, refused.body.code]).toEqual([query, 403, "no_space"]);
    }
    expect((await send(as("carla"), "conversation=room-fabrikam")).body).toMatchObject({ space: "client:fabrikam", outcome: "created" });
    expect(await spaceHolds(as("admin"), "client:evergreen")).toEqual([]);
    expect(await spaceHolds(as("admin"), "client:fabrikam")).toEqual(["note.txt"]);
  });

  it("lets an admin save from the room of a client that has nothing yet, and nobody else", async () => {
    const { as, book } = await serve();
    book.set("room-acme", { roomClient: "acme", members: ["gerentedeoperacao"] });
    expect((await send(as("beto"), "conversation=room-acme")).status).toBe(403);
    expect((await send(as("ana"), "conversation=room-acme")).status).toBe(403);
    const saved = await send(as("admin"), "conversation=room-acme");
    expect([saved.status, saved.body.space]).toEqual([201, "client:acme"]);
    expect((await as("admin").data<{ spaces: Array<{ id: string }> }>("GET", "/api/drive/spaces")).body.spaces.map((space) => space.id)).toContain("client:acme");
  });

  it("has no Drive to save to for a chat about more than one client, and says why", async () => {
    const { as, book } = await serve();
    book.set("chat-two", { named: ["evergreen", "fabrikam"], members: ["gerentedeoperacao"] });
    const refused = await send(as("admin"), "conversation=chat-two");
    expect([refused.status, refused.body.code]).toEqual([403, "no_space"]);
    expect(refused.body.error).toContain("more than one client");
    for (const space of ["internal", "client:evergreen", "client:fabrikam"]) expect(await spaceHolds(as("admin"), space)).toEqual([]);
  });

  it("saves a chat with no client in the company's space, for the people who may open it", async () => {
    const { as, book } = await serve();
    book.set("chat-gerentedeoperacao", { members: ["gerentedeoperacao"] });
    expect((await send(as("ana"), "conversation=chat-gerentedeoperacao")).status).toBe(403);
    expect((await send(as("admin"), "conversation=chat-gerentedeoperacao")).body).toMatchObject({ space: "internal", outcome: "created" });
    await as("admin").data("PUT", "/api/drive/internal-people", { people: ["ana@zorg.test"] });
    expect((await send(as("ana"), "conversation=chat-gerentedeoperacao", "from ana")).body).toMatchObject({ space: "internal", outcome: "updated" });
  });

  it("follows a task to the client of whoever asked for it", async () => {
    const { as, book } = await serve();
    book.set("task-1", { inherited: ["evergreen"], members: ["gerentedeoperacao"] });
    expect((await send(as("admin"), "conversation=task-1")).body).toMatchObject({ space: "client:evergreen" });
    expect(await spaceHolds(as("admin"), "internal")).toEqual([]);
  });

  it("has no single Drive for a room that mixes the company's agents with a client's", async () => {
    const { as, book } = await serve();
    book.set("room-mixed", { members: ["gerentedeoperacao", "evergreen-bot"] });
    const refused = await send(as("admin"), "conversation=room-mixed");
    expect([refused.status, refused.body.code]).toEqual([403, "no_space"]);
  });

  it("saves nowhere for a conversation it does not know or one whose agent has no space", async () => {
    const { as, book } = await serve();
    book.set("chat-loose", { members: ["loose"] });
    for (const thread of ["never-heard-of-it", "chat-loose"]) {
      const refused = await send(as("admin"), `conversation=${thread}`);
      expect([thread, refused.status, refused.body.code]).toEqual([thread, 403, "no_space"]);
    }
  });
});

describe("the room a space has left", () => {
  it("refuses an upload with no declared size that does not fit, and keeps nothing of it", async () => {
    const { as, base, service } = await serve({ NORDUS_DRIVE_SPACE_MAX_BYTES: "100" });
    expect((await as("beto").data("PUT", "/api/drive/file?path=first.bin", Buffer.alloc(90, 1))).status).toBe(201);
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 12; index += 1) controller.enqueue(new Uint8Array(10).fill(2 + index));
        controller.close();
      },
    });
    const response = await fetch(`${base}/api/drive/file?path=second.bin`, { method: "PUT", headers: { "x-test-user": "beto" }, body: chunks, duplex: "half" } as RequestInit);
    expect([response.status, ((await response.json()) as { code: string }).code]).toEqual([507, "full"]);
    const disk = diskOf(service.use(admin(isolated), "client:evergreen").space);
    expect(disk.blobs).toHaveLength(1);
    expect(disk.staging).toEqual([]);
    expect((await as("beto").data<DriveListing>("GET", "/api/drive/list")).body.items.map((item) => item.name)).toEqual(["first.bin"]);
  });

  it("refuses an upload that declares more than the room, before reading it", async () => {
    const { as, service } = await serve({ NORDUS_DRIVE_SPACE_MAX_BYTES: "100" });
    expect((await as("beto").data("PUT", "/api/drive/file?path=first.bin", Buffer.alloc(90, 1))).status).toBe(201);
    const refused = await as("beto").data<{ code: string }>("PUT", "/api/drive/file?path=second.bin", Buffer.alloc(50, 9));
    expect([refused.status, refused.body.code]).toEqual([507, "full"]);
    expect(diskOf(service.use(admin(isolated), "client:evergreen").space).blobs).toHaveLength(1);
  });
});

describe("names the asker cannot see", () => {
  async function withHiddenWork() {
    const served = await serve();
    await served.as("admin").data("PUT", "/api/drive/internal-people", { people: ["ana@zorg.test"] });
    const secret = served.service.use(botAsker("secret", isolated));
    await secret.drive.save("Board/plan.md", Buffer.from("closed"));
    secret.wiki.create({ title: "Layoffs", content: "closed" });
    return served;
  }

  it("answers a folder that holds only hidden things exactly as it answers one that does not exist", async () => {
    const { as } = await withHiddenWork();
    const hidden = await as("ana").data<{ error: string; code: string }>("GET", "/api/drive/list?space=internal&path=Board");
    const missing = await as("ana").data<{ error: string; code: string }>("GET", "/api/drive/list?space=internal&path=Nowhere");
    expect([hidden.status, hidden.body]).toEqual([404, missing.body]);
    expect(missing.status).toBe(404);
    expect((await as("ana").data<DriveListing>("GET", "/api/drive/list?space=internal")).body.items).toEqual([]);
  });

  it("refuses a name held by something hidden without saying that it is held", async () => {
    const { as } = await withHiddenWork();
    const upload = await as("ana").data<{ error: string; code: string }>("PUT", `/api/drive/file?space=internal&path=${enc("Board/plan.md")}`, Buffer.from("mine"));
    expect([upload.status, upload.body.code]).toEqual([400, "bad_path"]);
    expect(upload.body.error).not.toMatch(/exist|already|taken|hidden/i);
    const page = await as("ana").data<{ error: string; code: string }>("POST", "/api/wiki/page", { space: "internal", title: "Layoffs", content: "mine" });
    expect([page.status, page.body.code]).toEqual([400, "bad_title"]);
    expect(page.body.error).not.toMatch(/exist|already|taken|hidden/i);
  });
});
