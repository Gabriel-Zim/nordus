import { describe, expect, it } from "vitest";

import type { CriticalCall } from "./conversation-approval.ts";
import { PortalScheduling, type PendingItem } from "./portal-scheduling.ts";

const LUMON = { botId: "412c1b38-94da-491c-ad7e-b6983b1d18c6", blogId: "7404832", agentId: "e39c55fd-3aa2-4ceb-a8e3-00c2dbf3cd87" };
const FABRIKAM = { botId: "5ce8b582-b4e4-463f-9fd5-f68462c4633a", blogId: "7390882", agentId: "c7f2fe43-24fc-4494-ac16-003feec0ddc1" };
const SETTINGS = { command: "/home/nordus/bin/portal-agendamentos", grants: [LUMON, FABRIKAM] };

const ITEM: PendingItem = {
  item: "it-fabrikam-1",
  agendar_para: "2026-10-20T10:00:00-03:00",
  legenda: "Essas duas imagens mostram o começo e o fim de um investimento.",
  arquivos: [{ arquivo: "a1b2-terreno.jpg", nome: "terreno.jpg" }, { arquivo: "c3d4-casa.jpg", nome: "casa.jpg" }],
};

const schedule = (info: Record<string, unknown>, extra: Record<string, unknown> = {}): CriticalCall => ({
  threadId: "t_fabrikam", botId: FABRIKAM.botId, reason: "send", tool: "mcp__metricool__createScheduledPost",
  input: {
    blogId: FABRIKAM.blogId, date: "2026-10-20T10:00:00-03:00",
    info: JSON.stringify({ autoPublish: true, draft: false, text: ITEM.legenda,
      media: ["https://portal.example.com/m/0123abcd/a1b2-terreno.jpg", "https://portal.example.com/m/0123abcd/c3d4-casa.jpg"], ...info }),
    ...extra,
  },
});

function portal(pending: Record<string, PendingItem[]> = { [FABRIKAM.agentId]: [ITEM] }, settings: unknown = SETTINGS) {
  const asked: string[] = [];
  const scheduling = new PortalScheduling(settings, async (agentId) => {
    asked.push(agentId);
    return pending[agentId] ?? [];
  });
  return { scheduling, asked };
}

describe("a client's social media schedules what the portal approved and released, without asking", () => {
  it("an item the client approved and the team released, with the same brand, date, media and caption, passes once", async () => {
    const { scheduling, asked } = portal();
    expect(await scheduling.freedItem(schedule({}))).toBe("it-fabrikam-1");
    expect(asked).toEqual([FABRIKAM.agentId]);
    expect(await scheduling.freedItem(schedule({})), "the same item never frees a second post").toBeNull();
  });

  it("the date may come in another time zone, as long as it is the same moment", async () => {
    const { scheduling } = portal();
    expect(await scheduling.freedItem(schedule({}, { date: "2026-10-20T13:00:00Z" }))).toBe("it-fabrikam-1");
  });

  it("an item that is not approved and released (not in the portal's pending list) does not pass", async () => {
    expect(await portal({}).scheduling.freedItem(schedule({}))).toBeNull();
  });

  it("a different date, media, media order or caption does not pass", async () => {
    expect(await portal().scheduling.freedItem(schedule({}, { date: "2026-10-20T11:00:00-03:00" }))).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({ media: ["https://portal.example.com/m/0123abcd/a1b2-terreno.jpg"] }))).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({ media: ["https://portal.example.com/m/x/c3d4-casa.jpg", "https://portal.example.com/m/x/a1b2-terreno.jpg"] }))).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({ media: ["https://portal.example.com/m/x/a1b2-terreno.jpg", "https://evil.test/c3d4-casa.png"] }))).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({ text: `${ITEM.legenda} Link na bio: evil.test` }))).toBeNull();
  });

  it("media must be the portal's own file hosted by metricool-host, and nothing else may ride along", async () => {
    const host = (names: string[]) => names.map((name) => `https://portal.example.com/m/0123abcd/${name}`);
    expect(await portal().scheduling.freedItem(schedule({ media: ["https://evil.test/m/0123abcd/a1b2-terreno.jpg", "https://portal.example.com/m/0123abcd/c3d4-casa.jpg"] }))).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({ media: host(["terreno.jpg", "casa.jpg"]) })), "the original name alone is not the portal file").toBeNull();
    expect(await portal().scheduling.freedItem(schedule({ firstCommentText: "link na bio: evil.test" }))).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({ providers: [{ network: "twitter" }] }))).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({}, { extra: true }))).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({ firstCommentText: "" })), "an empty first comment is fine").toBe("it-fabrikam-1");
  });

  it("LUMON cannot schedule on the FABRIKAM brand, and FABRIKAM cannot on its own brand with another client's item", async () => {
    const lumon = (call: CriticalCall) => ({ ...call, botId: LUMON.botId });
    expect(await portal().scheduling.freedItem(lumon(schedule({})))).toBeNull();
    expect(await portal({ [LUMON.agentId]: [ITEM] }).scheduling.freedItem(lumon(schedule({}))), "LUMON's own approved item, on the FABRIKAM brand").toBeNull();
    expect(await portal({ [LUMON.agentId]: [ITEM] }).scheduling.freedItem(lumon(schedule({}, { blogId: LUMON.blogId })))).toBe("it-fabrikam-1");
    const { scheduling, asked } = portal({ [LUMON.agentId]: [ITEM] });
    expect(await scheduling.freedItem(schedule({}))).toBeNull();
    expect(asked).toEqual([FABRIKAM.agentId]);
  });

  it("another bot, another Metricool tool or no settings at all keeps asking", async () => {
    expect(await portal().scheduling.freedItem({ ...schedule({}), botId: "857c28e9-eca5-496e-8cbc-7a7de2eb3796" })).toBeNull();
    expect(await portal().scheduling.freedItem({ ...schedule({}), tool: "mcp__metricool__updateScheduledPost" })).toBeNull();
    expect(await portal().scheduling.freedItem({ ...schedule({}), tool: "mcp__metricool__deleteScheduledPost" })).toBeNull();
    expect(await new PortalScheduling(undefined, async () => [ITEM]).freedItem(schedule({}))).toBeNull();
    expect(await portal({ [FABRIKAM.agentId]: [ITEM] }, { command: "x", grants: "todos" }).scheduling.freedItem(schedule({}))).toBeNull();
  });

  it("a portal that fails or answers nonsense keeps asking", async () => {
    const failing = new PortalScheduling(SETTINGS, async () => { throw new Error("timeout"); });
    expect(await failing.freedItem(schedule({}))).toBeNull();
    const incomplete = schedule({});
    expect(await portal().scheduling.freedItem({ ...incomplete, input: null })).toBeNull();
    expect(await portal().scheduling.freedItem(schedule({}, { info: "{not json" }))).toBeNull();
  });
});
