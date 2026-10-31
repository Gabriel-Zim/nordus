// Real agent-browser and Chrome: one sign-in kept in the Chaveiro reaches two bots' own browsers at once, a renewal in one
// reaches the other, and signing out empties both. Runs only with NORDUS_KEYCHAIN_E2E=1 and an installed engine (network: httpbin.org).
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

import { agentBrowserIntegration, closeBrowserSession, prepareBrowserSessionState, resolveAgentBrowserBinary } from "./browser-engine.ts";
import { browserRuntimeEnv } from "./browser-runtime.ts";
import { loadIntoRunningBrowser, readRunningBrowserState, replaceSiteInSavedState, signOutOfSites, type BrowserSitesTarget } from "./browser-sites.ts";
import { Keychain, KeychainBrowsers, keychainSiteFor } from "./keychain.ts";

const run = promisify(execFile);
const binary = resolveAgentBrowserBinary();
const enabled = process.env.NORDUS_KEYCHAIN_E2E === "1" && binary !== null;
const KEY = "b".repeat(64);
const home = mkdtempSync(join(tmpdir(), "keychain-e2e-"));

function target(session: string): BrowserSitesTarget {
  const spec = agentBrowserIntegration({ binaryPath: binary!, session, encryptionKey: KEY, env: { ...process.env, HOME: home } });
  return { binaryPath: binary!, session, env: { ...browserRuntimeEnv({ HOME: home, XDG_RUNTIME_DIR: undefined }), ...spec.env }, encryptionKey: KEY };
}
async function browse(t: BrowserSitesTarget, ...args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await run(t.binaryPath, [...args, "--json", "--no-webmcp"], { env: browserRuntimeEnv({ ...t.env, HOME: home, XDG_RUNTIME_DIR: undefined }) as NodeJS.ProcessEnv, timeout: 60_000 });
  return JSON.parse(stdout).data;
}
const cookies = async (t: BrowserSitesTarget) => {
  await browse(t, "open", "https://httpbin.org/cookies");
  return String((await browse(t, "get", "text", "body")).text);
};

const login = target("chaveiro-e2e"), design = target("bot-design"), social = target("bot-social");

afterAll(async () => {
  if (enabled) for (const t of [login, design, social]) await closeBrowserSession(t.binaryPath, browserRuntimeEnv({ ...t.env, HOME: home, XDG_RUNTIME_DIR: undefined })).catch(() => false);
  rmSync(home, { recursive: true, force: true });
});

describe.skipIf(!enabled)("Chaveiro with real browsers", () => {
  it("lends one sign-in to two bots in parallel, renews it and signs both out", async () => {
    const keychain = new Keychain(home, () => KEY);
    for (const t of [login, design, social]) await prepareBrowserSessionState(t.binaryPath, t.session, { env: { HOME: home }, persistent: false });
    await browse(login, "open", "https://httpbin.org/cookies/set?tok=AAA");
    const state = await readRunningBrowserState(login);
    expect(state).not.toBeNull();
    const entry = keychain.save({ site: keychainSiteFor("httpbin.org", state!), state: state! });
    expect(entry.site).toBe("httpbin.org");
    keychain.setBots(entry.id, ["design", "social"]);

    // Design's browser is already open; Social's is not, so it gets the sign-in in its saved state on launch.
    await browse(design, "open", "about:blank");
    const lent = new KeychainBrowsers(keychain, {
      target: (botId) => botId === "design" ? design : botId === "social" ? social : null,
      running: (t) => readRunningBrowserState(t),
      load: (t, part) => loadIntoRunningBrowser(t, part),
      replaceSaved: (t, site, part) => replaceSiteInSavedState(t, site, part),
      signOut: (t, site) => signOutOfSites(t, site),
    }, { settleMs: 0 });
    await Promise.all([lent.before("design"), lent.before("social")]);
    const [a, b] = await Promise.all([cookies(design), cookies(social)]);
    expect(a).toContain('"tok": "AAA"');
    expect(b).toContain('"tok": "AAA"');

    // The site renews the sign-in in Design's browser; Social picks the renewal up on its next call.
    await browse(design, "open", "https://httpbin.org/cookies/set?tok=BBB");
    expect(await lent.collect("design")).toEqual(["httpbin.org"]);
    await lent.before("social");
    expect(await cookies(social)).toContain('"tok": "BBB"');

    keychain.remove(entry.id);
    expect(await lent.signOutEverywhere(entry, ["design", "social"])).toEqual([]);
    const [c, d] = await Promise.all([cookies(design), cookies(social)]);
    expect(c).not.toContain("tok");
    expect(d).not.toContain("tok");
  }, 240_000);
});
