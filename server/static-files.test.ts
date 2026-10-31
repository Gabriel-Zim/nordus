import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseEncoding, sendStaticFile, staticCachePolicy } from "./static-files.ts";

let dir = "";
let server: Server;
let port = 0;
const script = `export const x = "${"abc".repeat(2000)}";\n`;

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "static-files-"));
  writeFileSync(join(dir, "app.js"), script);
  writeFileSync(join(dir, "tiny.js"), "x");
  writeFileSync(join(dir, "pic.png"), Buffer.alloc(4000, 7));
  server = createServer((req, res) => {
    const name = (req.url ?? "/").slice(1);
    const stat = statSync(join(dir, name));
    const type = name.endsWith(".png") ? "image/png" : "text/javascript";
    void sendStaticFile(req, res, { file: join(dir, name), size: stat.size, mtimeMs: stat.mtimeMs, type, headers: { "cache-control": "public, max-age=31536000, immutable" } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe("static files", () => {
  it("prefers brotli, then gzip, and ignores an encoding refused with q=0", () => {
    expect(chooseEncoding("gzip, deflate, br")).toBe("br");
    expect(chooseEncoding("gzip;q=1.0")).toBe("gzip");
    expect(chooseEncoding("br;q=0, gzip")).toBe("gzip");
    expect(chooseEncoding(undefined)).toBeNull();
  });

  it("serves a script compressed with the cache headers kept", async () => {
    const br = await get("/app.js", { "accept-encoding": "br" });
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(br.headers.vary).toBe("accept-encoding");
    expect(brotliDecompressSync(br.body).toString()).toBe(script);
    const gz = await get("/app.js", { "accept-encoding": "gzip" });
    expect(gunzipSync(gz.body).toString()).toBe(script);
    expect(br.body.length).toBeLessThan(script.length / 10);
  });

  it("sends the plain file to a client that accepts no encoding, a tiny file and an image", async () => {
    expect((await get("/app.js")).body.toString()).toBe(script);
    const tiny = await get("/tiny.js", { "accept-encoding": "br" });
    expect(tiny.headers["content-encoding"]).toBeUndefined();
    const png = await get("/pic.png", { "accept-encoding": "br" });
    expect(png.headers["content-encoding"]).toBeUndefined();
    expect(png.body.length).toBe(4000);
  });

  it("answers 304 when the validator still matches", async () => {
    const first = await get("/app.js", { "accept-encoding": "br" });
    const second = await get("/app.js", { "accept-encoding": "br", "if-none-match": String(first.headers.etag) });
    expect(second.status).toBe(304);
    expect(second.body.length).toBe(0);
  });

  it("caches by how the file changes", () => {
    expect(staticCachePolicy("/assets/index-abc.js", "text/javascript")).toBe("public, max-age=31536000, immutable");
    expect(staticCachePolicy("/index.html", "text/html")).toBe("no-cache");
    expect(staticCachePolicy("/sw.js", "text/javascript")).toBe("no-cache");
    expect(staticCachePolicy("/ui-manifest.json", "application/json")).toBe("no-cache");
    expect(staticCachePolicy("/brand/zimstudio.svg", "image/svg+xml")).toBe("public, max-age=3600, stale-while-revalidate=86400");
  });
});
