import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { encryptBrowserState } from "./browser-sites.ts";
import { githubMcpServersForBot, googleMcpServersForBot, OAuthAppStore } from "./oauth-apps.ts";
import { writeFileAtomic } from "./atomic.ts";

const internal = (id: string) => ({ id, internal: true });
const client = (id: string) => ({ id, internal: false });
const dir = () => mkdtempSync(join(tmpdir(), "oauth-apps-"));

describe("OAuthAppStore", () => {
  it("keeps several accounts per app, each with its own bots", () => {
    const store = new OAuthAppStore(dir());
    store.set("google", "client", "secret");
    store.addAccount("google", { access: "a1", account: "member@example.com", connectedAt: 1 });
    store.addAccount("google", { access: "a2", account: "admin@example.com", connectedAt: 2 });
    store.addAccount("google", { access: "a3", account: "member@example.com", connectedAt: 3 });
    const google = store.list().find((app) => app.provider === "google")!;
    expect(google.accounts.map((account) => account.account)).toEqual(["member@example.com", "admin@example.com"]);
    const info = google.accounts[1]!;
    store.setAccountBots("google", info.id, ["financeiro"]);
    expect(store.accountsForBot("google", internal("financeiro")).map((account) => account.access)).toEqual(["a3", "a2"]);
    expect(store.accountsForBot("google", internal("social")).map((account) => account.access)).toEqual(["a3"]);
    store.removeAccount("google", info.id);
    expect(store.list().find((app) => app.provider === "google")!.accounts).toHaveLength(1);
  });

  it("never lists a secret or a token", () => {
    const data = dir();
    const store = new OAuthAppStore(data);
    store.set("github", "client", "very-secret");
    store.addAccount("github", { access: "gho_token", account: "zorg", connectedAt: 1 });
    expect(JSON.stringify(store.list())).not.toMatch(/very-secret|gho_token/);
    expect(readFileSync(join(data, "oauth-apps.json.enc")).toString("utf8")).not.toMatch(/very-secret|gho_token/);
  });

  it("reads a file from before accounts as its first account", () => {
    const data = dir();
    const key = "a".repeat(64);
    writeFileAtomic(join(data, "oauth-apps-key"), `${key}\n`, { mode: 0o600 });
    writeFileAtomic(join(data, "oauth-apps.json.enc"), encryptBrowserState(JSON.stringify({ apps: { google: {
      clientId: "c", clientSecret: "s", updatedAt: 1, connection: { access: "old", account: "admin@example.com", connectedAt: 1 },
    } } }), key), { mode: 0o600 });
    const first = new OAuthAppStore(data).list().find((app) => app.provider === "google")!;
    expect(first.accounts.map((account) => account.account)).toEqual(["admin@example.com"]);
    const again = new OAuthAppStore(data).list().find((app) => app.provider === "google")!;
    expect(again.accounts[0]!.id).toBe(first.accounts[0]!.id);
  });

  it("hands each Google account a bot may use to it as the Google connector, and only to the bots allowed", () => {
    const store = new OAuthAppStore(dir());
    expect(googleMcpServersForBot(store, internal("design"))).toEqual({});
    store.set("google", "client", "secret");
    store.addAccount("google", { access: "a1", refresh: "r1", expiresAt: 5, account: "member@example.com", connectedAt: 1 });
    const single = googleMcpServersForBot(store, internal("design"));
    expect(Object.keys(single)).toEqual(["google"]);
    expect(single.google!.env).toMatchObject({
      GOOGLE_ACCOUNT: "member@example.com", GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_ACCESS_TOKEN: "a1", GOOGLE_REFRESH_TOKEN: "r1", GOOGLE_EXPIRES_AT: "5",
    });
    expect(single.google!.args.at(-1)).toMatch(/connectors\/google-mcp\.(ts|js)$/);
    store.addAccount("google", { access: "a2", account: "admin@example.com", connectedAt: 2 });
    const info = store.list().find((app) => app.provider === "google")!.accounts[1]!;
    store.setAccountBots("google", info.id, ["financeiro"]);
    expect(Object.keys(googleMcpServersForBot(store, internal("design")))).toEqual(["google"]);
    expect(Object.keys(googleMcpServersForBot(store, internal("financeiro")))).toEqual(["google-member-example-com", "google-admin-example-com"]);
  });

  it("never hands an account without its own list of bots to a client's bot", () => {
    const store = new OAuthAppStore(dir());
    for (const provider of ["google", "github", "slack", "hubspot"] as const) {
      store.set(provider, "client", "secret");
      store.addAccount(provider, { access: `${provider}-token`, account: "member@example.com", connectedAt: 1 });
      expect(store.accountsForBot(provider, client("evergreen"))).toEqual([]);
      expect(store.accountsForBot(provider, internal("gerentedeoperacao")).map((entry) => entry.access)).toEqual([`${provider}-token`]);
    }
    expect(googleMcpServersForBot(store, client("evergreen"))).toEqual({});
    expect(githubMcpServersForBot(store, client("evergreen"))).toEqual({});
    expect(Object.keys(googleMcpServersForBot(store, internal("gerentedeoperacao")))).toEqual(["google"]);
    expect(Object.keys(githubMcpServersForBot(store, internal("gerentedeoperacao")))).toEqual(["github"]);
  });

  it("hands an account to a client's bot only when the person lists that bot for it", () => {
    const store = new OAuthAppStore(dir());
    store.set("google", "client", "secret");
    store.addAccount("google", { access: "a1", account: "evergreen@cliente.com", connectedAt: 1 });
    const account = store.list().find((app) => app.provider === "google")!.accounts[0]!;
    store.setAccountBots("google", account.id, ["evergreen"]);
    expect(Object.keys(googleMcpServersForBot(store, client("evergreen")))).toEqual(["google"]);
    expect(googleMcpServersForBot(store, client("fabrikam"))).toEqual({});
    expect(googleMcpServersForBot(store, internal("gerentedeoperacao"))).toEqual({});
  });

  it("hands each GitHub account a bot may use to it as the official MCP server", () => {
    const store = new OAuthAppStore(dir());
    store.set("github", "client", "secret");
    store.addAccount("github", { access: "t1", account: "zorgcontent", connectedAt: 1 });
    expect(githubMcpServersForBot(store, internal("design"))).toEqual({
      github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer t1" } },
    });
    store.addAccount("github", { access: "t2", account: "averymercer", connectedAt: 2 });
    expect(Object.keys(githubMcpServersForBot(store, internal("design")))).toEqual(["github-zorgcontent", "github-averymercer"]);
  });
});
