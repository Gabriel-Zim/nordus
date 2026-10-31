import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { siteState, withSiteState, type BrowserSitesTarget, type SavedBrowserState } from "./browser-sites.ts";
import { Keychain, KeychainBrowsers, keychainNameFor, keychainSiteFor } from "./keychain.ts";
import { keychainHttpUrl } from "./routes/keychain.ts";

const KEY = "a".repeat(64);
const dirs: string[] = [];
function dir(): string { const d = mkdtempSync(join(tmpdir(), "keychain-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const cookie = (domain: string, name: string, value: string) => ({ name, value, domain, path: "/", expires: -1, httpOnly: true, secure: true });
const state = (cookies: unknown[], origins: unknown[] = []): SavedBrowserState => ({ cookies, origins });

describe("keychain site", () => {
  it("is as wide as the sign-in's cookies", () => {
    expect(keychainSiteFor("www.instagram.com", state([cookie(".instagram.com", "sessionid", "x")]))).toBe("instagram.com");
    expect(keychainSiteFor("accounts.example.co.uk", state([]))).toBe("example.co.uk");
    expect(keychainSiteFor("httpbin.org", state([cookie("httpbin.org", "tok", "1")]))).toBe("httpbin.org");
    expect(keychainNameFor("instagram.com")).toBe("Instagram");
  });

  it("takes only web addresses", () => {
    expect(keychainHttpUrl("instagram.com")).toBe("https://instagram.com/");
    expect(keychainHttpUrl("javascript:alert(1)")).toBeNull();
    expect(keychainHttpUrl("https://user:pw@example.com")).toBeNull();
    expect(keychainHttpUrl("localhost")).toBeNull();
  });

  it("keeps one site apart from the rest of a browser", () => {
    const full = state([cookie(".a.com", "s", "1"), cookie("b.com", "t", "2")], [{ origin: "https://www.a.com", localStorage: [{ name: "k", value: "v" }] }, { origin: "https://b.com", localStorage: [] }]);
    expect(siteState(full, "a.com")).toEqual(state([cookie(".a.com", "s", "1")], [{ origin: "https://www.a.com", localStorage: [{ name: "k", value: "v" }] }]));
    const replaced = withSiteState(full, "a.com", state([cookie(".a.com", "s", "9")]));
    expect(replaced.cookies).toEqual([cookie("b.com", "t", "2"), cookie(".a.com", "s", "9")]);
  });
});

describe("Keychain", () => {
  it("stores the sign-in encrypted and lists none of it", () => {
    const d = dir();
    const keychain = new Keychain(d, () => KEY);
    const entry = keychain.save({ site: "httpbin.org", state: state([cookie("httpbin.org", "tok", "SECRETO"), cookie("other.org", "x", "1")]) });
    expect(entry).toMatchObject({ name: "Httpbin", site: "httpbin.org", bots: [], version: 1 });
    expect(readFileSync(join(d, "keychain", `${entry.id}.enc`)).toString("latin1")).not.toContain("SECRETO");
    expect(JSON.stringify(keychain.list())).not.toContain("SECRETO");
    expect(keychain.state(entry.id)?.cookies).toEqual([cookie("httpbin.org", "tok", "SECRETO")]);
    expect(new Keychain(d, () => KEY).list()).toHaveLength(1);
  });

  it("refuses a site with no sign-in", () => {
    const keychain = new Keychain(dir(), () => KEY);
    expect(() => keychain.save({ site: "httpbin.org", state: state([cookie("other.org", "x", "1")]) })).toThrow(/Nenhum login/);
  });

  it("signing in again keeps who may use it, and only a real change is a renewal", () => {
    const keychain = new Keychain(dir(), () => KEY);
    const first = keychain.save({ site: "httpbin.org", state: state([cookie("httpbin.org", "tok", "1")]) });
    keychain.setBots(first.id, ["design", "social"]);
    const again = keychain.save({ site: "httpbin.org", state: state([cookie("httpbin.org", "tok", "2")]) });
    expect(again).toMatchObject({ id: first.id, bots: ["design", "social"], version: 2 });
    expect(keychain.renew(first.id, state([cookie("httpbin.org", "tok", "2")]))).toBeNull();
    expect(keychain.renew(first.id, state([cookie("httpbin.org", "tok", "3")]))?.version).toBe(3);
    keychain.forgetBot("design");
    expect(keychain.get(first.id)?.bots).toEqual(["social"]);
  });
});

/** Two bots, each with its own browser: a map of session → running state (null when stopped) and saved state. */
function browsers() {
  const live = new Map<string, SavedBrowserState | null>();
  const saved = new Map<string, SavedBrowserState>();
  const target = (botId: string): BrowserSitesTarget => ({ binaryPath: "ab", session: `bot-${botId}`, env: {}, encryptionKey: KEY });
  const merge = (base: SavedBrowserState | undefined | null, part: SavedBrowserState) => {
    const cookies = (base?.cookies ?? []).filter((c) => !part.cookies.some((p) => (p as { name: string }).name === (c as { name: string }).name));
    return state([...cookies, ...part.cookies], [...(base?.origins ?? []), ...part.origins]);
  };
  return {
    live, saved, target,
    deps: {
      target: (botId: string) => botId === "guest" ? null : target(botId),
      running: async (t: BrowserSitesTarget) => live.get(t.session) ?? null,
      load: async (t: BrowserSitesTarget, part: SavedBrowserState) => {
        const now = live.get(t.session);
        if (!now) return false;
        live.set(t.session, merge(now, part));
        return true;
      },
      replaceSaved: (t: BrowserSitesTarget, site: string, part: SavedBrowserState | null) => {
        const base = saved.get(t.session) ?? state([]);
        saved.set(t.session, part ? withSiteState(base, site, part) : siteState(state([]), site));
      },
      signOut: async (t: BrowserSitesTarget, site: string) => {
        const strip = (s: SavedBrowserState) => state(s.cookies.filter((c) => !(c as { domain: string }).domain.endsWith(site)), []);
        const now = live.get(t.session);
        if (now) live.set(t.session, strip(now));
        const kept = saved.get(t.session);
        if (kept) saved.set(t.session, strip(kept));
      },
    },
  };
}

describe("KeychainBrowsers", () => {
  it("lends a site to two bots, each in its own browser, and brings a renewal to the other", async () => {
    const keychain = new Keychain(dir(), () => KEY);
    const entry = keychain.save({ site: "httpbin.org", state: state([cookie("httpbin.org", "tok", "AAA")]) });
    keychain.setBots(entry.id, ["design", "social"]);
    const b = browsers();
    b.live.set("bot-design", state([]));
    const lent = new KeychainBrowsers(keychain, b.deps, { settleMs: 0 });

    await Promise.all([lent.before("design"), lent.before("social")]);
    expect(b.live.get("bot-design")?.cookies).toEqual([cookie("httpbin.org", "tok", "AAA")]);
    // Social's browser was not running: the sign-in waits in its saved state for the next launch.
    expect(b.saved.get("bot-social")?.cookies).toEqual([cookie("httpbin.org", "tok", "AAA")]);

    // The site renews Design's sign-in.
    b.live.set("bot-design", state([cookie("httpbin.org", "tok", "BBB")]));
    expect(await lent.collect("design")).toEqual(["httpbin.org"]);
    expect(keychain.get(entry.id)?.version).toBe(2);

    b.live.set("bot-social", state([cookie("httpbin.org", "tok", "AAA")]));
    // Social's older copy is not a renewal.
    expect(await lent.collect("social")).toEqual([]);
    await lent.before("social");
    expect(b.live.get("bot-social")?.cookies).toEqual([cookie("httpbin.org", "tok", "BBB")]);
  });

  it("a bot not allowed gets nothing, and signing out reaches every bot", async () => {
    const keychain = new Keychain(dir(), () => KEY);
    const entry = keychain.save({ site: "httpbin.org", state: state([cookie("httpbin.org", "tok", "AAA")]) });
    keychain.setBots(entry.id, ["design"]);
    const b = browsers();
    b.live.set("bot-design", state([])); b.live.set("bot-social", state([]));
    const lent = new KeychainBrowsers(keychain, b.deps, { settleMs: 0 });
    await lent.before("design"); await lent.before("social"); await lent.before("guest");
    expect(b.live.get("bot-social")?.cookies).toEqual([]);
    expect(b.live.get("bot-design")?.cookies).toHaveLength(1);

    keychain.remove(entry.id);
    expect(await lent.signOutEverywhere(entry, ["design", "social", "guest"])).toEqual([]);
    expect(b.live.get("bot-design")?.cookies).toEqual([]);
  });

  it("turning a bot off takes the site out of its browser", async () => {
    const keychain = new Keychain(dir(), () => KEY);
    const entry = keychain.save({ site: "httpbin.org", state: state([cookie("httpbin.org", "tok", "AAA")]) });
    keychain.setBots(entry.id, ["design"]);
    const b = browsers();
    b.live.set("bot-design", state([]));
    const lent = new KeychainBrowsers(keychain, b.deps, { settleMs: 0 });
    await lent.before("design");
    keychain.setBots(entry.id, []);
    await lent.revoke("design", entry);
    expect(b.live.get("bot-design")?.cookies).toEqual([]);
  });
});
