import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const store = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { bots: [] as Bot[] };
});
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { bots: store.bots, groups: [], config: {} }, dispatch: () => {} }),
}));
const { currentWork, WorkingNow } = await import("./WorkingNow");

const OWN_OPENING = "[Thread you opened yourself from #DesignerGrafico, preciso de um carrossel. The request below is your own words, not the person's: do the work here and end with a clear result they can read.]\n\nPedido do QG";
const designergrafico: Pick<Bot, "id" | "tasks" | "threadId"> = {
  id: "designergrafico", threadId: "task",
  tasks: [{ threadId: "task", title: "Lumon · Carrossel", createdAt: 1, openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", at: 1 } }],
};

describe("currentWork", () => {
  it("reads a task the bot opened on itself as its own task, not a request from itself", () => {
    const opening: Message = { id: "o1", role: "user", kind: "text", at: 1, text: OWN_OPENING, peerAsk: { botId: "designergrafico", name: "DESIGNERGRAFICO" } };
    expect(currentWork([opening], designergrafico, "en")).toMatchObject({ askedBy: { kind: "task", name: "Lumon · Carrossel" }, request: "Pedido do QG" });
  });

  it("still names a teammate who asked", () => {
    const asked: Message = { id: "a1", role: "user", kind: "text", at: 1, text: "Check it", peerAsk: { botId: "lia", name: "LIA" } };
    expect(currentWork([asked], designergrafico, "en").askedBy).toEqual({ kind: "bot", name: "LIA" });
  });
});

const NOW = Date.now();
const leader = (patch: Partial<Bot> = {}) => ({
  id: "designergrafico", name: "DESIGNERGRAFICO", section: "QG de DESIGN", teamLead: { allow: [], ask: [] }, threadId: "designergrafico-main",
  tasks: [{ threadId: "designergrafico-main", title: "DESIGNERGRAFICO", createdAt: 1 }], messages: [], ...patch,
}) as unknown as Bot;
const member = (id: string, name: string, task: Partial<NonNullable<Bot["tasks"]>[number]>) => ({
  id, name, section: "QG de DESIGN", threadId: `${id}-main`,
  tasks: [{ threadId: `${id}-task`, title: "Evergreen Capital · Carrossel Dólar e Patrimônio ·", createdAt: 1, ...task }], messages: [],
}) as unknown as Bot;
const designerAtWork = member("designer", "Designer", {
  busy: true, activity: "working", doing: "Analisando o briefing do carrossel", turnStartedAt: NOW - 3 * 60_000,
});

function agora(bot: Bot, bots: Bot[]): string {
  store.bots = bots;
  return renderToStaticMarkup(createElement(WorkingNow, { bot, messages: [], onStop: () => {} }));
}

describe("WorkingNow for a team's leader", () => {
  it("shows an idle leader what each working member is doing and for how long, in the member's own task", () => {
    const designergrafico = leader();
    const html = agora(designergrafico, [designergrafico, designerAtWork]);
    expect(html).toContain("Designer · Evergreen Capital · Carrossel Dólar e Patrimônio: analisando o briefing do carrossel");
    expect(html).toContain("3 min ago");
  });

  it("leaves out a member that is idle", () => {
    const designergrafico = leader();
    const html = agora(designergrafico, [designergrafico, designerAtWork, member("redator", "Redator", { busy: false })]);
    expect(html).toContain("Designer");
    expect(html).not.toContain("Redator");
  });

  it("lists a member that works with none of its conversations marked", () => {
    const designergrafico = leader();
    const busyOnly = { ...member("revisor", "Revisor", { busy: false }), busy: true } as Bot;
    expect(agora(designergrafico, [designergrafico, busyOnly])).toContain("Revisor");
  });

  it("gives no time when the turn's start is unknown, rather than the last message's", () => {
    const designergrafico = leader();
    const noStart = member("designer", "Designer", { busy: true, activity: "working", doing: "Analisando o briefing do carrossel", updatedAt: NOW - 3 * 60_000 });
    const html = agora(designergrafico, [designergrafico, noStart]);
    expect(html).toContain("Designer · Evergreen Capital · Carrossel Dólar e Patrimônio: analisando o briefing do carrossel");
    expect(html).not.toContain("ago");
  });

  it("shows nothing for a bot that leads nobody", () => {
    const designergrafico = leader({ teamLead: undefined });
    expect(agora(designergrafico, [designergrafico, designerAtWork])).toBe("");
  });
});
