import { describe, expect, it } from "vitest";

import type { BotRecord, Store } from "../store.ts";
import { createRoomAccess } from "./room-access.ts";

// Only a thread opened as a parallel room job answers to its room; a work
// thread a room conversation opened for anything else does not.
describe("laneRoomThread", () => {
  const tasks: Record<string, { openedBy?: Record<string, unknown> }> = {
    lane: { openedBy: { botId: "lead", name: "Lead", kind: "work", threadId: "room-thread", roomLane: true, at: 1 } },
    work: { openedBy: { botId: "lead", name: "Lead", kind: "work", threadId: "room-thread", at: 1 } },
  };
  const store = {
    taskByThread: (_botId: string, threadId: string) => tasks[threadId],
    groupByThread: (threadId: string) => threadId === "room-thread" ? { id: "room" } : undefined,
  } as unknown as Store;
  const { laneRoomThread } = createRoomAccess({ store });

  it("names the room thread of a parallel room job only", () => {
    expect(laneRoomThread({ botId: "e1", threadId: "lane" })).toBe("room-thread");
    expect(laneRoomThread({ botId: "e1", threadId: "work" })).toBeUndefined();
    expect(laneRoomThread({ botId: "e1", threadId: "lane", groupId: "room" })).toBeUndefined();
  });
});

// coordinate_bots checks the handoff again here: a bot opened to the sender's team (openTo) must pass the same way.
describe("roomHandoffProblem com openTo", () => {
  const bots: Record<string, Record<string, unknown>> = {
    social: { id: "social", name: "SOCIAL", section: "ZORG" },
    diretor: { id: "diretor", name: "Diretor de Arte", section: "QG DE DESIGN", openTo: ["ZORG"] },
    designer: { id: "designer", name: "Designer", section: "QG DE DESIGN" },
    assistentefinanceiro: { id: "assistentefinanceiro", name: "AssistenteFinanceiro", section: "FINANCEIRO" },
    portal: { id: "portal", name: "Portal", section: "ZORG", hidden: true },
  };
  const store = {
    bot: (id: string) => bots[id],
    group: () => undefined,
    groupByThread: () => undefined,
    taskByThread: (botId: string, threadId: string) => threadId === `${botId}-thread` ? { threadId } : undefined,
  } as unknown as Store;
  const { roomHandoffProblem } = createRoomAccess({ store });
  const node = (botId: string) => ({ botId, threadId: `${botId}-thread` });

  it("deixa o pedido do ZORG chegar ao Diretor e a resposta voltar", () => {
    expect(roomHandoffProblem(node("diretor"), node("social"))).toBeUndefined();
  });
  it("um robô oculto de rotina pode avisar outro robô da conversa que ainda existe", () => {
    expect(roomHandoffProblem(node("social"), node("portal"))).toBeUndefined();
  });
  it("falar é livre: o resto do QG, o caminho de volta e outro time passam", () => {
    expect(roomHandoffProblem(node("designer"), node("social"))).toBeUndefined();
    expect(roomHandoffProblem(node("social"), node("diretor"))).toBeUndefined();
    expect(roomHandoffProblem(node("diretor"), node("assistentefinanceiro"))).toBeUndefined();
  });
  it("a lista peers de quem pede não barra mais a conversa", () => {
    bots.social = { ...bots.social, peers: ["designer"] };
    try {
      expect(roomHandoffProblem(node("diretor"), node("social"))).toBeUndefined();
    } finally {
      bots.social = { id: "social", name: "SOCIAL", section: "ZORG" };
    }
  });
});
// A hand-off by id has no roster in front of it: the recipient must still be visible to exactly the people the sender is.
describe("roomHandoffProblem com audiência", () => {
  const ada = { people: ["ada@example.test"] };
  const bots: Record<string, Record<string, unknown>> = {
    balcao: { id: "balcao", name: "Balcao", section: "Ops" },
    recepcao: { id: "recepcao", name: "Recepcao", section: "Pessoas" },
    folha: { id: "folha", name: "Folha", section: "Pessoas", visibility: ada },
    beneficios: { id: "beneficios", name: "Beneficios", section: "Ops", visibility: ada },
    diretoria: { id: "diretoria", name: "Diretoria", section: "Pessoas", visibility: "admins" },
    aberta: { id: "aberta", name: "Aberta", section: "Pessoas", visibility: "everyone" },
  };
  const store = {
    bot: (id: string) => bots[id],
    group: () => undefined,
    groupByThread: () => undefined,
    taskByThread: (botId: string, threadId: string) => threadId === `${botId}-thread` ? { threadId } : undefined,
  } as unknown as Store;
  const { roomHandoffProblem } = createRoomAccess({ store });
  const node = (botId: string) => ({ botId, threadId: `${botId}-thread` });
  const REFUSED = "The recipient is not an allowed peer of the sender";

  it("deixa passar quem as mesmas pessoas veem, de qualquer time", () => {
    expect(roomHandoffProblem(node("recepcao"), node("balcao"))).toBeUndefined();
    expect(roomHandoffProblem(node("aberta"), node("balcao"))).toBeUndefined();
    expect(roomHandoffProblem(node("beneficios"), node("folha"))).toBeUndefined();
  });
  it("recusa o pedido e a leitura da resposta entre audiências diferentes, nos dois sentidos", () => {
    expect(roomHandoffProblem(node("folha"), node("balcao"))).toBe(REFUSED);
    expect(roomHandoffProblem(node("balcao"), node("folha"))).toBe(REFUSED);
    expect(roomHandoffProblem(node("diretoria"), node("folha"))).toBe(REFUSED);
    expect(roomHandoffProblem(node("diretoria"), node("balcao"))).toBe(REFUSED);
  });
  it("alargar a audiência do destino para todos não o torna colega de quem é restrito", () => {
    expect(roomHandoffProblem(node("aberta"), node("folha"))).toBe(REFUSED);
  });
});
describe("roomTalks", () => {
  const bots = {
    insider: { id: "insider", name: "Insider", section: "Build" },
    stranger: { id: "stranger", name: "Stranger", section: "Elsewhere" },
  } as unknown as Record<string, BotRecord>;
  const store = {
    bot: (id: string) => bots[id],
    messagesFor: () => [],
  } as unknown as Store;
  const { roomTalks } = createRoomAccess({ store });
  const room = (over: Record<string, unknown> = {}) => ({
    id: "room", threadId: "room-thread", dm: false, memberIds: ["insider"], name: "Room", ...over,
  }) as never;

  it("returns one discriminated problem per rule", () => {
    expect(roomTalks(bots.insider!, room())).toEqual({ ok: true });
    expect(roomTalks(bots.insider!, room({ dm: true, threadId: "dm-thread" }))).toEqual({ ok: false, problem: "dm" });
    expect(roomTalks(bots.stranger!, room({ memberIds: ["insider"] }))).toEqual({ ok: false, problem: "not-member" });
    expect(roomTalks(bots.insider!, room({ memberIds: ["insider", "stranger"] })))
      .toEqual({ ok: false, problem: "outsider", name: "Stranger" });
    expect(roomTalks(bots.insider!, room({ setupCompletedAt: null, setupSkippedAt: null })))
      .toEqual({ ok: false, problem: "setup" });
    expect(roomTalks(bots.insider!, room({ setupCompletedAt: 1 }))).toEqual({ ok: true });
  });
});

