import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FIGMA_MCP_PACKAGE, KeyVault, keyMcpServersForBot, migrateConfigKeys } from "./key-vault.ts";
import { trelloCallback } from "./routes/key-connectors.ts";

const internal = (id: string) => ({ id, internal: true });
const client = (id: string) => ({ id, internal: false });
const dir = () => mkdtempSync(join(tmpdir(), "key-vault-"));

describe("KeyVault", () => {
  it("keeps several accounts per app, each with its own bots, and replaces the same account in place", () => {
    const vault = new KeyVault(dir());
    const first = vault.addAccount("figma", { token: "f1" }, "member@example.com");
    vault.addAccount("figma", { token: "f2" }, "admin@example.com");
    vault.setAccountBots("figma", first, ["design"]);
    expect(vault.addAccount("figma", { token: "f3" }, "member@example.com")).toBe(first);
    expect(vault.accountsForBot("figma", internal("design")).map((entry) => entry.fields.token)).toEqual(["f3", "f2"]);
    expect(vault.accountsForBot("figma", internal("social")).map((entry) => entry.fields.token)).toEqual(["f2"]);
    vault.removeAccount("figma", first);
    expect(vault.list().apps.find((app) => app.app === "figma")!.accounts.map((entry) => entry.label)).toEqual(["admin@example.com"]);
  });

  it("never lists or writes a key in the clear", () => {
    const data = dir();
    const vault = new KeyVault(data);
    vault.addAccount("manychat", { apiKey: "manychat-secret-key" }, "Zorg");
    vault.setTrelloKey("0123456789abcdef0123456789abcdef");
    expect(JSON.stringify(vault.list())).not.toContain("manychat-secret-key");
    expect(readFileSync(join(data, "key-connectors.json.enc")).toString("latin1")).not.toContain("manychat-secret-key");
    expect(new KeyVault(data).list().apps.find((app) => app.app === "manychat")!.accounts[0]!.label).toBe("Zorg");
  });

  it("gives each bot one server per allowed account, Figma read-only and without telemetry", () => {
    const vault = new KeyVault(dir());
    vault.addAccount("figma", { token: "tok" }, "member@example.com");
    vault.addAccount("trello", { token: "t1" }, "avery");
    expect(keyMcpServersForBot(vault, internal("design")).trello).toBeUndefined();
    vault.setTrelloKey("0123456789abcdef0123456789abcdef");
    const servers = keyMcpServersForBot(vault, internal("design"));
    expect(servers.figma!.args).toEqual(["-y", FIGMA_MCP_PACKAGE, "--stdio", "--skip-image-downloads"]);
    expect(servers.figma!.env).toMatchObject({ FIGMA_API_KEY: "tok", FRAMELINK_TELEMETRY: "off", DO_NOT_TRACK: "1" });
    expect(servers.trello!.env).toMatchObject({ TRELLO_API_KEY: "0123456789abcdef0123456789abcdef", TRELLO_TOKEN: "t1" });
    vault.addAccount("trello", { token: "t2" }, "zorg content");
    expect(Object.keys(keyMcpServersForBot(vault, internal("design"))).filter((name) => name.startsWith("trello"))).toEqual(["trello-avery", "trello-zorg-content"]);
  });

  it("never hands a key without its own list of bots to a client's bot", () => {
    const vault = new KeyVault(dir());
    vault.setTrelloKey("0123456789abcdef0123456789abcdef");
    const figma = vault.addAccount("figma", { token: "f1" }, "member@example.com");
    vault.addAccount("trello", { token: "t1" }, "zorg");
    vault.addAccount("manychat", { apiKey: "m1" }, "zorg");
    expect(keyMcpServersForBot(vault, client("evergreen"))).toEqual({});
    expect(Object.keys(keyMcpServersForBot(vault, internal("gerentedeoperacao"))).sort()).toEqual(["figma", "manychat", "trello"]);
    vault.setAccountBots("figma", figma, ["evergreen"]);
    expect(Object.keys(keyMcpServersForBot(vault, client("evergreen")))).toEqual(["figma"]);
  });

  it("moves keys saved in config.json into the vault once", () => {
    const vault = new KeyVault(dir());
    const servers = { manychat: { command: "node", env: { MANYCHAT_API_KEY: "k" } }, notion: { url: "https://mcp.notion.com/mcp" } };
    expect(migrateConfigKeys(servers, vault)).toEqual({ notion: { url: "https://mcp.notion.com/mcp" } });
    expect(vault.accountsForBot("manychat", internal("any"))[0]!.fields.apiKey).toBe("k");
    expect(migrateConfigKeys({ notion: servers.notion }, vault)).toBeNull();
  });
});

describe("trelloCallback", () => {
  const ok = (async () => new Response(JSON.stringify({ username: "avery" }), { status: 200 })) as typeof fetch;

  it("refuses a token that comes without a state Nordus issued", async () => {
    const vault = new KeyVault(dir());
    vault.setTrelloKey("0123456789abcdef0123456789abcdef");
    const answer = await trelloCallback(vault, "POST", async () => ({ state: "forged", token: "t" }), ok);
    expect(answer.status).toBe(400);
    expect(vault.list().apps.find((app) => app.app === "trello")!.accounts).toHaveLength(0);
  });

  it("serves the page that reads the token from the fragment", async () => {
    const answer = await trelloCallback(new KeyVault(dir()), "GET", async () => null);
    expect(answer.type).toBe("html");
    expect(answer.body).toContain("location.hash");
  });
});
