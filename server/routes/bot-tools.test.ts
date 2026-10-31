import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { BotRecord } from "../store.ts";
import { createBotToolRoutes } from "./bot-tools.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function listedServers(bot: Partial<BotRecord>, internal: boolean, explicit: string[] = []): Promise<string[]> {
  const record = { id: "bot-1", modelSelection: { instanceId: "claude", model: "m" }, ...bot } as BotRecord;
  const routes = [createBotToolRoutes({ bot: () => record, internalBot: () => internal, mcpServerNames: () => ["trello", "notes", ...explicit], explicitMcpServerNames: () => explicit })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const body = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots/bot-1/tools`)).json() as { servers: Array<{ id: string }> };
  return body.servers.map((row) => row.id);
}

it("lists the servers a bot actually mounts: all for an internal bot without a list, none for a client's", async () => {
  expect(await listedServers({}, true)).toEqual(["trello", "notes"]);
  expect(await listedServers({}, false)).toEqual([]);
  expect(await listedServers({ mcpServers: ["notes"] }, false)).toEqual(["notes"]);
});

it("leaves an explicit server out of a bot without a list and shows it to a bot that names it", async () => {
  expect(await listedServers({}, true, ["trafego"])).toEqual(["trello", "notes"]);
  expect(await listedServers({ mcpServers: ["trafego", "notes"] }, true, ["trafego"])).toEqual(["notes", "trafego"]);
});
