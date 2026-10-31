import { describe, expect, it, vi } from "vitest";
import type { SendIdentity } from "./directory.ts";
import { createBoardSender, newSendId, spendReason, type SenderDeps } from "./send.ts";

const identity: SendIdentity = { sender: { name: "Nina", email: "nina@zorg.com", notOwner: true }, trigger: { kind: "user", email: "nina@zorg.com" }, personPresent: true };
const adminIdentity: SendIdentity = { sender: { name: "Rafael", id: "p_r", email: "rafael@zorg.com", admin: true }, trigger: { kind: "user", email: "rafael@zorg.com" }, personPresent: true };

function sender(overrides: Partial<SenderDeps> = {}) {
  const deps: SenderDeps = {
    botThread: (botId) => (botId === "dev" ? "th-dev" : undefined),
    roomThreadOwned: (groupId, threadId) => groupId === "g1" && threadId === "th-g1",
    acceptDirectSend: vi.fn(async () => ({ threadId: "th-dev" })),
    roomWorking: () => false,
    roomQueued: () => false,
    shouldQueue: (working) => working,
    queueRoom: vi.fn(),
    startRoom: vi.fn(),
    applyRoomHolds: vi.fn(),
    spendBlock: () => null,
    ...overrides,
  };
  return { deps, board: createBoardSender(deps) };
}

describe("sending to an agent directly", () => {
  it("hands the message to the normal send as a relayed line, with the person's name, trigger and presence", async () => {
    const { deps, board } = sender();
    expect(await board.toBot({ botId: "dev", text: "Tarefa #1: x", sendId: "task-abc", identity })).toEqual({ status: "sent", threadId: "th-dev" });
    expect(deps.acceptDirectSend).toHaveBeenCalledWith({
      botId: "dev", threadId: "th-dev", text: "Tarefa #1: x", sendId: "task-abc", sender: identity.sender, trigger: identity.trigger, personPresent: true, relayed: true,
    });
  });

  it("never lets a card carry the administrator flag, so no approval can read it as the admin's own word", async () => {
    const { deps, board } = sender();
    await board.toBot({ botId: "dev", text: "Tarefa #1: x", sendId: "task-abc", identity: adminIdentity });
    const sent = vi.mocked(deps.acceptDirectSend).mock.calls[0]![0];
    expect(sent.sender).toEqual({ name: "Rafael", id: "p_r", email: "rafael@zorg.com" });
    expect(sent.sender).not.toHaveProperty("admin");
    expect(sent.relayed).toBe(true);
  });

  it("says queued when the agent was busy, and skipped when the agent is gone", async () => {
    const queued = sender({ acceptDirectSend: async () => ({ queued: true, threadId: "th-dev" }) });
    expect(await queued.board.toBot({ botId: "dev", text: "x", sendId: "task-abc", identity })).toEqual({ status: "queued", threadId: "th-dev" });
    const gone = sender();
    expect(await gone.board.toBot({ botId: "ghost", text: "x", sendId: "task-abc", identity })).toEqual({ status: "skipped", reason: "O agente não existe mais." });
    expect(gone.deps.acceptDirectSend).not.toHaveBeenCalled();
  });

  it("does not even try when a spending limit is reached, and says which one", async () => {
    const total = sender({ spendBlock: () => ({ code: "spend_cap" }) });
    expect(await total.board.toBot({ botId: "dev", text: "x", sendId: "task-abc", identity })).toEqual({ status: "skipped", reason: "o limite de gasto do mês foi atingido." });
    const own = sender({ spendBlock: () => ({ code: "bot_spend_cap", botName: "Dev" }) });
    expect(await own.board.toBot({ botId: "dev", text: "x", sendId: "task-abc", identity })).toEqual({ status: "skipped", reason: "Dev chegou ao limite de gasto do mês." });
    expect(total.deps.acceptDirectSend).not.toHaveBeenCalled();
    expect(own.deps.acceptDirectSend).not.toHaveBeenCalled();
  });

  it("turns a refusal into a short reason instead of failing the card", async () => {
    const body = sender({ acceptDirectSend: async () => { throw Object.assign(new Error("refused"), { body: { error: "Esse agente está pausado." } }); } });
    expect(await body.board.toBot({ botId: "dev", text: "x", sendId: "task-abc", identity })).toEqual({ status: "skipped", reason: "Esse agente está pausado." });
    const plain = sender({ acceptDirectSend: async () => { throw new Error("x".repeat(500)); } });
    const outcome = await plain.board.toBot({ botId: "dev", text: "x", sendId: "task-abc", identity });
    expect(outcome.status === "skipped" && outcome.reason.length).toBe(300);
    const empty = sender({ acceptDirectSend: async () => { throw new Error(""); } });
    expect(await empty.board.toBot({ botId: "dev", text: "x", sendId: "task-abc", identity })).toEqual({ status: "skipped", reason: "O envio foi recusado." });
  });
});

describe("sending to a room", () => {
  const input = { groupId: "g1", threadId: "th-g1", text: "@Dev Passo 1", sendId: "mission-abc", identity };

  it("starts the room's turn when the room is idle, after applying what the room holds", async () => {
    const { deps, board } = sender();
    expect(await board.toRoom(input)).toEqual({ status: "sent", threadId: "th-g1" });
    expect(deps.applyRoomHolds).toHaveBeenCalledWith("g1", "@Dev Passo 1");
    expect(deps.startRoom).toHaveBeenCalledWith("g1", "@Dev Passo 1", { sendId: "mission-abc", sender: identity.sender, trigger: identity.trigger, threadId: "th-g1", via: "api" });
    expect(deps.queueRoom).not.toHaveBeenCalled();
  });

  it("posts into a room as an API line without the administrator flag, whether it starts now or waits", async () => {
    const idle = sender();
    await idle.board.toRoom({ ...input, identity: adminIdentity });
    const started = vi.mocked(idle.deps.startRoom).mock.calls[0]![2];
    expect(started).toMatchObject({ via: "api", sender: { name: "Rafael", id: "p_r", email: "rafael@zorg.com" } });
    expect(started.sender).not.toHaveProperty("admin");
    const busy = sender({ roomWorking: () => true });
    await busy.board.toRoom({ ...input, identity: adminIdentity });
    const queued = vi.mocked(busy.deps.queueRoom).mock.calls[0]![3];
    expect(queued).toMatchObject({ via: "api" });
    expect(queued.sender).not.toHaveProperty("admin");
  });

  it("queues behind the turn already running", async () => {
    const { deps, board } = sender({ roomWorking: () => true });
    expect(await board.toRoom(input)).toEqual({ status: "queued", threadId: "th-g1" });
    expect(deps.queueRoom).toHaveBeenCalledWith("g1", "th-g1", "@Dev Passo 1", { sendId: "mission-abc", sender: identity.sender, trigger: identity.trigger, via: "api" });
    expect(deps.startRoom).not.toHaveBeenCalled();
  });

  it("skips a room that is gone, a spending limit, and a refusal", async () => {
    expect(await sender().board.toRoom({ ...input, groupId: "g2" })).toEqual({ status: "skipped", reason: "A sala não existe mais." });
    expect(await sender({ spendBlock: () => ({ code: "spend_cap" }) }).board.toRoom(input)).toMatchObject({ status: "skipped" });
    const refused = sender({ startRoom: () => { throw Object.assign(new Error("closed"), { body: { error: "A sala está arquivada." } }); } });
    expect(await refused.board.toRoom(input)).toEqual({ status: "skipped", reason: "A sala está arquivada." });
  });

  it("knows a room is busy while its turn runs or while that very message still waits in the queue", () => {
    expect(sender({ roomWorking: () => true }).board.roomBusy("g1", "th-g1")).toBe(true);
    const waiting = sender({ roomQueued: (_group, _thread, id) => id === "mission-abc" });
    expect(waiting.board.roomBusy("g1", "th-g1", "mission-abc")).toBe(true);
    expect(waiting.board.roomBusy("g1", "th-g1", "mission-other")).toBe(false);
    expect(waiting.board.roomBusy("g1", "th-g1")).toBe(false);
  });
});

describe("the ids it sends with", () => {
  it("are accepted by the send route's id rule, and differ every time", () => {
    const a = newSendId("task");
    const b = newSendId("mission");
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    expect(b).toMatch(/^mission-[a-f0-9]+$/);
    expect(a).not.toBe(newSendId("task"));
    expect(spendReason({ code: "anything" })).toBe("o limite de gasto do mês foi atingido.");
  });
});
