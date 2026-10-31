import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => ({ rows: [] as Array<{ id: string; kind: "bot"; ownerId: string; threadId: string; status: string; payload: Record<string, unknown> }> }));
vi.mock("./message-db.ts", () => ({
  chatFollowups: () => saved.rows.filter((row) => row.status === "pending"),
  saveChatFollowup: (row: { id: string; kind: "bot"; ownerId: string; threadId: string; payload: Record<string, unknown> }) => { saved.rows.push({ ...row, status: "pending", payload: { ...row.payload } }); },
  settleChatFollowups: (ids: string[]) => { saved.rows = saved.rows.filter((row) => !ids.includes(row.id)); },
  rankChatFollowups: (ranks: Array<[string, number]>) => {
    for (const [id, rank] of ranks) { const row = saved.rows.find((candidate) => candidate.id === id); if (row) row.payload.rank = rank; }
  },
}));

const { botQueue, reorderBotQueue, queueSteeredMessage, cancelSteeredMessage, botQueueItemThread, restoreSteeredMessages } = await import("./steer-queue.ts");

describe("a bot's work queue", () => {
  beforeEach(() => { saved.rows = []; restoreSteeredMessages(); });

  it("lists the waiting work in drain order, with who asked and no prompt", () => {
    queueSteeredMessage("designerdeia", "room-a", "faz a capa", { prompt: "SECRET PROMPT", peerAsk: { botId: "d", name: "Diretor" } });
    queueSteeredMessage("social", "room-b", "outra coisa");
    queueSteeredMessage("designerdeia", "dm", "revisa o texto", { trigger: { kind: "routine", label: "Bom dia" } });
    const list = botQueue("designerdeia");
    expect(list.map((item) => item.text)).toEqual(["faz a capa", "revisa o texto"]);
    expect(list[0]!.from).toEqual({ kind: "bot", name: "Diretor" });
    expect(list[1]!.from).toEqual({ kind: "routine", name: "Bom dia" });
    expect(JSON.stringify(list)).not.toContain("SECRET");
  });

  it("drains in the dragged order and leaves other bots in place", () => {
    const a = queueSteeredMessage("designerdeia", "room-a", "a").id;
    queueSteeredMessage("social", "room-b", "b");
    const c = queueSteeredMessage("designerdeia", "dm", "c").id;
    const d = queueSteeredMessage("designerdeia", "dm", "d").id;
    expect(reorderBotQueue("designerdeia", [d, c, a])).toBe(true);
    expect(botQueue("designerdeia").map((item) => item.text)).toEqual(["d", "c", "a"]);
    expect(botQueue("social").map((item) => item.text)).toEqual(["b"]);
    expect(reorderBotQueue("designerdeia", [d, c])).toBe(false);
  });

  it("keeps the dragged order across a restart", () => {
    const a = queueSteeredMessage("designerdeia", "room-a", "a").id;
    const c = queueSteeredMessage("designerdeia", "dm", "c").id;
    reorderBotQueue("designerdeia", [c, a]);
    queueSteeredMessage("designerdeia", "room-b", "late");
    restoreSteeredMessages();
    expect(botQueue("designerdeia").map((item) => item.text)).toEqual(["c", "a", "late"]);
  });

  it("takes one item out wherever it waits", () => {
    const a = queueSteeredMessage("designerdeia", "room-a", "a").id;
    expect(botQueueItemThread("designerdeia", a)).toBe("room-a");
    expect(cancelSteeredMessage("designerdeia", a)).toBe(true);
    expect(botQueue("designerdeia")).toEqual([]);
  });
});
