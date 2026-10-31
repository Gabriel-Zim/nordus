import { describe, expect, it } from "vitest";

import { catalogAppEntries, mergeAppEntries, oauthAppEntries, serverAppEntries, type CustomServerInput } from "./app-status";
import { setLocale } from "./i18n";

setLocale("en");

const cards = [{ slug: "gmail", label: "Gmail", logo: null }, { slug: "slack", label: "Slack", logo: "https://logo/slack.png" }];
const server = (extra: Partial<CustomServerInput> = {}): CustomServerInput => ({ name: "notes", label: "Notes", slug: null, enabled: true, ...extra });

describe("catalog apps", () => {
  it("is connected through an active account, or by the server's own flag when there is no account list", () => {
    expect(catalogAppEntries(cards, { gmail: { connected: true, accounts: [{ id: "1", status: "ACTIVE" }] } })[0]).toMatchObject({ id: "catalog:gmail", name: "Gmail", source: "catalog", state: "connected" });
    expect(catalogAppEntries(cards, { slack: { connected: true } })[0]).toMatchObject({ state: "connected", logo: "https://logo/slack.png" });
  });

  it.each(["INITIATED", "EXPIRED", "initializing"])("needs a sign-in while the account is %s", (status) => {
    expect(catalogAppEntries(cards, { gmail: { connected: false, accounts: [{ id: "1", status }] } })[0]!.state).toBe("needs-sign-in");
  });

  it("needs a sign-in while the connection is pending, even with no account yet", () => {
    expect(catalogAppEntries(cards, { gmail: { connected: false, pending: true, status: "INITIATED" } })[0]!.state).toBe("needs-sign-in");
  });

  it("has a problem when the account failed, with a plain sentence and no status code", () => {
    const [entry] = catalogAppEntries(cards, { gmail: { connected: false, accounts: [{ id: "1", status: "FAILED" }] } });
    expect(entry).toMatchObject({ state: "problem", reason: "The connection did not finish. Connect the app again from the list below." });
    expect(entry!.reason).not.toMatch(/FAILED/);
  });

  it("prefers a working account over a dead one, and leaves out apps the person never started", () => {
    const status = {
      gmail: { connected: true, accounts: [{ id: "1", status: "EXPIRED" }, { id: "2", status: "ACTIVE" }] },
      slack: { connected: false },
    };
    const entries = catalogAppEntries(cards, status);
    expect(entries.map((entry) => `${entry.name}:${entry.state}`)).toEqual(["Gmail:connected"]);
  });

  it("falls back to the slug as the name for an app missing from the catalog", () => {
    expect(catalogAppEntries([], { zoho: { connected: true } })[0]!.name).toBe("zoho");
  });
});

describe("custom and built-in connections", () => {
  it("is connected when on and answering, and says so for the built-in ones by source", () => {
    expect(serverAppEntries([server()])[0]).toMatchObject({ id: "custom:notes", source: "custom", state: "connected" });
    expect(serverAppEntries([server({ name: "whop", label: "Whop", native: true })])[0]).toMatchObject({ id: "native:whop", source: "native", state: "connected" });
    expect(serverAppEntries([server({ health: { state: "ok" } })])[0]!.state).toBe("connected");
  });

  it("is off, not a problem, when the person switched it off, whatever its health", () => {
    expect(serverAppEntries([server({ enabled: false, health: { state: "down", reason: "x" } })])[0]).toMatchObject({ state: "off" });
  });

  it("needs a sign-in when its auth says so", () => {
    expect(serverAppEntries([server({ auth: "needs-sign-in" })])[0]!.state).toBe("needs-sign-in");
    expect(serverAppEntries([server({ auth: "signed-in" })])[0]!.state).toBe("connected");
  });

  it("has a problem with the health reason when degraded or down, and a generic sentence without one", () => {
    expect(serverAppEntries([server({ health: { state: "down", reason: "O app demorou demais para responder." } })])[0])
      .toMatchObject({ state: "problem", reason: "O app demorou demais para responder." });
    expect(serverAppEntries([server({ health: { state: "degraded" } })])[0])
      .toMatchObject({ state: "problem", reason: "Could not reach the app right now." });
  });
});

describe("OAuth apps", () => {
  const app = (extra: { configured: boolean; connected: boolean }) => ({ provider: "github", label: "GitHub", slug: "github", ...extra });

  it("is connected once signed in, and needs a sign-in when set up but not signed in", () => {
    expect(oauthAppEntries([app({ configured: true, connected: true })])[0]).toMatchObject({ id: "oauth:github", source: "oauth", state: "connected" });
    expect(oauthAppEntries([app({ configured: true, connected: false })])[0]!.state).toBe("needs-sign-in");
  });

  it("leaves out an app the person never set up", () => {
    expect(oauthAppEntries([app({ configured: false, connected: false })])).toEqual([]);
  });
});

describe("the merged list", () => {
  it("puts what needs attention first, working apps next, switched-off ones last, keeping each source's order", () => {
    const merged = mergeAppEntries(
      catalogAppEntries(cards, { gmail: { connected: true }, slack: { connected: false, pending: true } }),
      serverAppEntries([server({ name: "a", label: "A", enabled: false }), server({ name: "b", label: "B", health: { state: "down" } }), server({ name: "c", label: "C" })]),
    );
    expect(merged.map((entry) => `${entry.name}:${entry.state}`)).toEqual(["Slack:needs-sign-in", "B:problem", "Gmail:connected", "C:connected", "A:off"]);
  });

  it("lists an app once even when two sources report the same id", () => {
    const one = serverAppEntries([server()]);
    expect(mergeAppEntries(one, one)).toHaveLength(1);
  });
});
