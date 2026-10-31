import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedScopes } from "./account-signin.ts";
import { requiredScope } from "./request-auth.ts";
import { createWaitlistRoutes } from "./routes/waitlist.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import { WAITLIST_FILE, WAITLIST_MAX, WaitlistStore } from "./waitlist.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nordus-waitlist-"));
  dirs.push(dir);
  return dir;
}

describe("a fila da lista de espera", () => {
  it("guarda o e-mail em minúsculo, sem duplicar, e conta as tentativas", () => {
    let clock = 1_000;
    const store = new WaitlistStore(tempDir(), { now: () => clock });
    store.request("Ana@Gmail.com", "Ana");
    clock = 5_000;
    store.request(" ana@gmail.com ", null);
    expect(store.list()).toEqual([{ email: "ana@gmail.com", name: "Ana", firstAt: 1_000, lastAt: 5_000, attempts: 2 }]);
  });

  it("sobrevive a um reinício e não aceita endereço sem arroba", () => {
    const dir = tempDir();
    const store = new WaitlistStore(dir, { now: () => 7 });
    store.request("bia@gmail.com", "Bia");
    store.request("sem-arroba", null);
    expect(JSON.parse(readFileSync(join(dir, WAITLIST_FILE), "utf8")).entries).toHaveLength(1);
    expect(new WaitlistStore(dir).list()).toMatchObject([{ email: "bia@gmail.com", name: "Bia" }]);
  });

  it("para de gravar endereços novos no teto, mas segue contando quem já está", () => {
    const dir = tempDir();
    const store = new WaitlistStore(dir, { now: () => 1 });
    for (let i = 0; i < WAITLIST_MAX; i += 1) store.request(`p${i}@x.com`, null);
    store.request("novo@x.com", null);
    expect(store.list()).toHaveLength(WAITLIST_MAX);
    expect(store.list().some((entry) => entry.email === "novo@x.com")).toBe(false);
    store.request("p0@x.com", null);
    expect(store.list().find((entry) => entry.email === "p0@x.com")?.attempts).toBe(2);
  });

  it("remove uma entrada e diz se havia", () => {
    const store = new WaitlistStore(tempDir());
    store.request("a@x.com", null);
    expect(store.remove("A@X.com")).toBe(true);
    expect(store.remove("a@x.com")).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("começa vazia quando o arquivo está estragado", () => {
    const dir = tempDir();
    new WaitlistStore(dir).request("a@x.com", null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(join(dir, WAITLIST_FILE), "{");
    expect(new WaitlistStore(dir).list()).toEqual([]);
  });
});

describe("rotas da lista de espera", () => {
  it("são só de administrador", () => {
    expect(requiredScope("GET", "/api/waitlist")).toBe("admin");
    expect(requiredScope("DELETE", "/api/waitlist")).toBe("admin");
  });

  function call(handler: ReturnType<typeof createWaitlistRoutes>, method: string, path: string, query = "") {
    const out: { status?: number; body?: unknown } = {};
    const ctx = {
      res: {}, path, method, url: new URL(`http://x${path}${query}`),
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
    } as unknown as RouteContext;
    return handler(ctx).then((result) => ({ result, ...out }));
  }

  it("lista a fila sem quem já está na lista e remove uma entrada", async () => {
    const store = new WaitlistStore(tempDir(), { now: () => 1 });
    store.request("ana@gmail.com", "Ana");
    store.request("bia@gmail.com", "Bia");
    const list = { admins: [], members: ["bia@gmail.com"] };
    const handler = createWaitlistRoutes({ store, listed: (email) => Boolean(allowedScopes(email, list)) });
    const got = await call(handler, "GET", "/api/waitlist");
    expect(got.status).toBe(200);
    expect((got.body as { entries: Array<{ email: string }> }).entries.map((entry) => entry.email)).toEqual(["ana@gmail.com"]);
    const gone = await call(handler, "DELETE", "/api/waitlist", "?email=Ana%40gmail.com");
    expect(gone.status).toBe(200);
    expect(store.list().map((entry) => entry.email)).toEqual(["bia@gmail.com"]);
    expect((await call(handler, "DELETE", "/api/waitlist")).status).toBe(400);
    expect((await call(handler, "POST", "/api/waitlist")).status).toBe(405);
    expect((await call(handler, "GET", "/api/outra")).result).toBe(PASS);
  });
});
