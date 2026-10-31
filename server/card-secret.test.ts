import { describe, expect, it } from "vitest";

import { inspectCardPage, typeCardSecret, type CardSecretDeps } from "./card-secret.ts";

function fake(options: { url?: string; tabs?: Array<{ url: string }> | null; field?: "password" | "code" | null; moved?: string; focused?: boolean } = {}) {
  const typed: string[] = [];
  const pressed: string[] = [];
  const remembered: string[] = [];
  const evals: string[] = [];
  const deps: CardSecretDeps = {
    engine: async (args) => {
      if (args[0] === "get") return { url: options.url ?? "https://accounts.google.com/signin/pwd" };
      if (args[0] === "tab") return options.tabs === null ? null : { tabs: options.tabs ?? [{ url: options.url ?? "https://accounts.google.com/signin/pwd" }] };
      evals.push(args[1] ?? "");
      return { result: JSON.stringify({ href: options.moved ?? options.url ?? "https://accounts.google.com/signin/pwd", field: options.field === undefined ? "password" : options.field, focused: options.focused ?? true }) };
    },
    insertText: async (text) => { typed.push(text); },
    press: async (key) => { pressed.push(key); },
    remember: (value) => { remembered.push(value); },
  };
  return { deps, typed, pressed, remembered, evals };
}

describe("typing a card value into the page", () => {
  it("types a password on the card's own site, sends it, remembers it so it is scrubbed, and holds the page", async () => {
    const { deps, typed, pressed, remembered } = fake();
    const result = await typeCardSecret(deps, "accounts.google.com", "hunter2");
    expect(result).toMatchObject({ ok: true, pageHost: "accounts.google.com", kind: "password" });
    expect(typed).toEqual(["hunter2"]);
    expect(pressed).toEqual(["Enter"]);
    expect(remembered).toEqual(["hunter2"]);
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(result.ok && result.held.url).toBe("https://accounts.google.com/signin/pwd");
  });

  it("types a code the same way when the page asks for one", async () => {
    const { deps, typed } = fake({ field: "code" });
    expect(await typeCardSecret(deps, "google.com", "123456")).toMatchObject({ ok: true, kind: "code" });
    expect(typed).toEqual(["123456"]);
  });

  it("refuses, typing nothing, when the page is another site", async () => {
    const { deps, typed } = fake({ url: "https://evil.example.net/login" });
    const result = await typeCardSecret(deps, "accounts.google.com", "hunter2");
    expect(result.ok).toBe(false);
    expect(typed).toEqual([]);
  });

  it("refuses an insecure page and a blank one", async () => {
    for (const url of ["http://accounts.google.com/login", "about:blank"]) {
      const { deps, typed } = fake({ url });
      expect((await typeCardSecret(deps, "accounts.google.com", "x")).ok).toBe(false);
      expect(typed).toEqual([]);
    }
  });

  it("refuses when another open tab is on the same site", async () => {
    const { deps, typed } = fake({ tabs: [{ url: "https://accounts.google.com/a" }, { url: "https://mail.google.com/" }] });
    const result = await typeCardSecret(deps, "accounts.google.com", "hunter2");
    expect(result.ok).toBe(false);
    expect(typed).toEqual([]);
  });

  it("allows other tabs that are on other sites", async () => {
    const { deps } = fake({ tabs: [{ url: "https://accounts.google.com/a" }, { url: "https://news.example.org/" }] });
    expect((await typeCardSecret(deps, "accounts.google.com", "hunter2")).ok).toBe(true);
  });

  it("fails closed when the tabs cannot be read", async () => {
    const { deps, typed } = fake({ tabs: null });
    expect((await typeCardSecret(deps, "accounts.google.com", "hunter2")).ok).toBe(false);
    expect(typed).toEqual([]);
  });

  it("refuses when the page moved to another site while the field was found, or shows no field", async () => {
    const moved = fake({ moved: "https://evil.example.net/" });
    expect((await typeCardSecret(moved.deps, "accounts.google.com", "x")).ok).toBe(false);
    expect(moved.typed).toEqual([]);
    const none = fake({ field: null });
    expect((await typeCardSecret(none.deps, "accounts.google.com", "x")).ok).toBe(false);
    expect(none.typed).toEqual([]);
  });

  it("refuses an empty or oversized value", async () => {
    const { deps, typed } = fake();
    expect((await typeCardSecret(deps, "accounts.google.com", "  ")).ok).toBe(false);
    expect((await typeCardSecret(deps, "accounts.google.com", "x".repeat(2000))).ok).toBe(false);
    expect(typed).toEqual([]);
  });

  it("inspects the page without typing: its real host and the field it asks for", async () => {
    const { deps, typed } = fake({ field: "code" });
    expect(await inspectCardPage(deps, "accounts.google.com")).toEqual({ ok: true, pageHost: "accounts.google.com", field: "code" });
    expect(typed).toEqual([]);
  });
});
