import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { readBody } from "./http.ts";

const request = (chunks: Buffer[]) => Readable.from(chunks) as unknown as IncomingMessage;

function splitInsideCharacter(bytes: Buffer, from: number): [Buffer, Buffer] {
  let cut = from;
  while ((bytes[cut]! & 0xc0) !== 0x80) cut += 1;
  return [bytes.subarray(0, cut), bytes.subarray(cut)];
}

describe("readBody", () => {
  it("keeps a character whole when a chunk boundary splits it", async () => {
    const text = "مرحبا بالعالم 中文 😀 ".repeat(50);
    const bytes = Buffer.from(JSON.stringify({ text }));
    const body = await readBody(request(splitInsideCharacter(bytes, 100)));
    expect(body.text).toBe(text);
  });

  it("keeps every character whole across many small chunks", async () => {
    const text = "مرحبا 中文 😀".repeat(20);
    const bytes = Buffer.from(JSON.stringify({ text }));
    const chunks: Buffer[] = [];
    for (let at = 0; at < bytes.length; at += 7) chunks.push(bytes.subarray(at, at + 7));
    const body = await readBody(request(chunks));
    expect(body.text).toBe(text);
  });

  it("still refuses a body over the limit", async () => {
    const bytes = Buffer.from(JSON.stringify({ text: "中".repeat(100) }));
    await expect(readBody(request(splitInsideCharacter(bytes, 10)), 64)).rejects.toMatchObject({ status: 413 });
  });
});

describe("json compression", () => {
  const big = { items: Array.from({ length: 400 }, (_, index) => ({ index, text: "mensagem do robô" })) };
  async function fetchJson(acceptEncoding: string | null) {
    const { createServer } = await import("node:http");
    const { compressReplies, json } = await import("./http.ts");
    const server = createServer(compressReplies((_req, res) => json(res, 200, big)));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const { request: get } = await import("node:http");
    try {
      return await new Promise<{ encoding?: string; vary?: string; bytes: Buffer }>((resolve, reject) => {
        const req = get({ port, host: "127.0.0.1", path: "/", headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ encoding: res.headers["content-encoding"], vary: res.headers.vary as string | undefined, bytes: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.end();
      });
    } finally {
      server.close();
    }
  }

  it("sends brotli or gzip when the client accepts it, and plain JSON otherwise", async () => {
    const { brotliDecompressSync, gunzipSync } = await import("node:zlib");
    const plain = await fetchJson(null);
    expect(plain.encoding).toBeUndefined();
    expect(JSON.parse(plain.bytes.toString())).toEqual(big);

    const br = await fetchJson("gzip, deflate, br");
    expect(br.encoding).toBe("br");
    expect(br.vary).toBe("accept-encoding");
    expect(br.bytes.length).toBeLessThan(plain.bytes.length / 5);
    expect(JSON.parse(brotliDecompressSync(br.bytes).toString())).toEqual(big);

    const gz = await fetchJson("gzip");
    expect(gz.encoding).toBe("gzip");
    expect(JSON.parse(gunzipSync(gz.bytes).toString())).toEqual(big);

    expect((await fetchJson("br;q=0, gzip")).encoding).toBe("gzip");
  });
});
