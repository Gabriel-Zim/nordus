import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJoinRequests, MAX_PENDING_JOIN_REQUESTS } from "./join-requests.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "nordus-join-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

describe("join requests", () => {
  it("creates, matches, rotates and revokes the link, and survives a restart", () => {
    const dir = fresh();
    const store = createJoinRequests(dir, () => 5);
    expect(store.link()).toBeNull();
    expect(store.matches("anything")).toBe(false);
    const first = store.rotateLink();
    expect(first.createdAt).toBe(5);
    expect(Buffer.from(first.token, "base64url")).toHaveLength(24);
    expect(store.matches(first.token)).toBe(true);
    expect(store.matches(first.token + "x")).toBe(false);
    expect(store.matches(undefined)).toBe(false);
    expect(createJoinRequests(dir).link()).toEqual(first);
    const second = store.rotateLink();
    expect(store.matches(first.token)).toBe(false);
    expect(store.matches(second.token)).toBe(true);
    store.revokeLink();
    expect(store.matches(second.token)).toBe(false);
    expect(createJoinRequests(dir).link()).toBeNull();
  });

  it("counts plus-aliases of one mailbox as one request and keeps the first real address", () => {
    const store = createJoinRequests(fresh());
    expect(store.record("ann+one@example.test")).toMatchObject({ ok: true, created: true });
    expect(store.record("ann+two@example.test")).toMatchObject({ ok: true, created: false });
    expect(store.record("ann@example.test")).toMatchObject({ ok: true, created: false });
    expect(store.list().map((request) => request.email)).toEqual(["ann+one@example.test"]);
    expect(store.record("bob@example.test")).toMatchObject({ created: true });
  });

  it("keeps the Google name on the request and across a reload", () => {
    const dir = fresh();
    createJoinRequests(dir).record("Ben@Example.test", "  Ben Souza ");
    expect(createJoinRequests(dir).list()).toEqual([expect.objectContaining({ email: "ben@example.test", name: "Ben Souza" })]);
  });

  it("dedupes by lowercased email, persists, and removes on take", () => {
    const dir = fresh();
    const store = createJoinRequests(dir);
    const a = store.record(" Ann@Example.test ");
    const again = store.record("ann@example.test");
    expect(a).toMatchObject({ ok: true, created: true });
    expect(again).toMatchObject({ ok: true, created: false });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.email).toBe("ann@example.test");
    expect(createJoinRequests(dir).list()).toHaveLength(1);
    const id = store.list()[0]!.id;
    expect(store.take(id)?.email).toBe("ann@example.test");
    expect(store.take(id)).toBeNull();
    expect(createJoinRequests(dir).list()).toEqual([]);
  });

  it("refuses new people beyond the cap but keeps answering known ones", () => {
    const store = createJoinRequests(fresh());
    for (let i = 0; i < MAX_PENDING_JOIN_REQUESTS; i += 1) expect(store.record(`p${i}@example.test`).ok).toBe(true);
    expect(store.record("late@example.test")).toMatchObject({ ok: false, status: 429 });
    expect(store.record("p0@example.test")).toMatchObject({ ok: true, created: false });
  });

  it("starts empty from a corrupt file", () => {
    const dir = fresh();
    writeFileSync(join(dir, "join-requests.json"), "{nope");
    expect(createJoinRequests(dir).list()).toEqual([]);
    const store = createJoinRequests(dir);
    store.rotateLink();
    expect(JSON.parse(readFileSync(join(dir, "join-requests.json"), "utf8")).link.token).toBeTruthy();
  });
});
