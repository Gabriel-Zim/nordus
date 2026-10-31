import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile.ts";
import type { AppConfig } from "../config.ts";
import type { Decider } from "../decider/index.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createDeciderRoutes } from "./decider.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(choose: Decider["choose"]) {
  const asked: unknown[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const routes = [createDeciderRoutes({
    decider: { testKey: async () => ({ ok: false, reason: "disabled" }), choose: (async (...args: Parameters<Decider["choose"]>) => {
      asked.push(args[1]);
      signals.push(args[3]?.signal);
      return choose(...args);
    }) as Decider["choose"] },
    models: { load: async () => ({ models: [] }) } as never,
    config: () => ({}) as AppConfig,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["client"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const suggest = async (body: unknown, signal?: AbortSignal) => {
    const res = await fetch(`${base}/api/bot-tag-suggestions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    return { status: res.status, body: await res.json() as { tags?: string[] } };
  };
  return { suggest, asked, signals };
}

const socialMedia = async () => ({
  ok: true, provider: "jev", latencyMs: 90,
  answers: { type: "choice", choice: "socialmedia", pTop: 0.8, margin: 0.7, probabilities: { socialmedia: 0.8, copywriter: 0.1 } },
}) as never;

describe("tag suggestions route", () => {
  it("answers Jev's catalog tags from the bot's name, title and description, never its instructions", async () => {
    const { suggest, asked } = await serve(socialMedia);
    expect(await suggest({ name: "Lu", title: "Posts do Instagram", soul: "Nunca diga o nome do cliente." }))
      .toEqual({ status: 200, body: { tags: ["Social Media", "Copywriter"] } });
    expect(asked).toEqual([{ bot: { name: "Lu", title: "Posts do Instagram" } }]);
  });

  it("answers an empty list when Jev is off", async () => {
    const { suggest } = await serve(async () => ({ ok: false, reason: "disabled" }));
    expect(await suggest({ title: "Financeiro" })).toEqual({ status: 200, body: { tags: [] } });
  });

  it("answers a profile filled to its limits", async () => {
    const { suggest } = await serve(socialMedia);
    const filled = (limit: number) => "ç".repeat(limit);
    expect((await suggest({
      name: filled(BOT_PROFILE_LIMITS.name), title: filled(BOT_PROFILE_LIMITS.title), description: filled(BOT_PROFILE_LIMITS.description),
    })).status).toBe(200);
  });

  it("stops waiting on Jev when the app stops waiting on the answer", async () => {
    const { suggest, signals } = await serve((...args) => new Promise((resolve) => {
      args[3]?.signal?.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" }), { once: true });
    }));
    const app = new AbortController();
    const answer = suggest({ title: "Posts do Instagram" }, app.signal).catch(() => "gave up");
    await expect.poll(() => signals.length).toBe(1);
    expect(signals[0]?.aborted).toBe(false);
    app.abort();
    await expect(answer).resolves.toBe("gave up");
    await expect.poll(() => signals[0]?.aborted).toBe(true);
  });

  it("keeps a recent answer for the same bot text, and asks again for new text or after an empty answer", async () => {
    const { suggest, asked } = await serve(socialMedia);
    const lu = { name: "Lu", title: "Posts do Instagram" };
    expect((await suggest(lu)).body.tags).toEqual(["Social Media", "Copywriter"]);
    expect((await suggest(lu)).body.tags).toEqual(["Social Media", "Copywriter"]);
    expect(asked).toHaveLength(1);
    await suggest({ ...lu, description: "Reels também" });
    expect(asked).toHaveLength(2);

    const off = await serve(async () => ({ ok: false, reason: "timeout" }));
    await off.suggest(lu);
    await off.suggest(lu);
    expect(off.asked).toHaveLength(2);
  });
});
