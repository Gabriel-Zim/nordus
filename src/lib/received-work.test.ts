import { describe, expect, it } from "vitest";
import type { Message, Task } from "@/state/store";
import { newestRounds, placeReceived, receivedRounds, receivedTasks } from "./received-work";

const DESIGNERGRAFICO = { id: "designergrafico", name: "DESIGNERGRAFICO" };
const FROM = { botId: "lumon", name: "LUMON", color: "blue" as const };

const ask = (id: string, at: number, text: string): Message =>
  ({ id, role: "bot", kind: "text", at, from: FROM, roomRequest: { id: `r-${id}`, phase: "request" }, text: `@DESIGNERGRAFICO ${text}` });
const reply = (id: string, at: number, text = "Pronto."): Message => ({ id, role: "bot", kind: "text", at, text, turnId: "t", turnTerminal: true, turnSucceeded: true });
const midTurn = (id: string, at: number, text = "Segundo nome: Café da Vizinha."): Message => ({ id, role: "bot", kind: "text", at, text, turnId: "t", streamId: "s" });
const step = (id: string, at: number): Message => ({ id, role: "bot", kind: "activity", at, tool: { name: "Read", ok: true } });

const task = (extra: Partial<Task> = {}): Task => ({
  threadId: "work", title: "@LUMON · work", createdAt: 1, openedBy: { botId: "lumon", name: "LUMON", threadId: "lumon-main", kind: "work", at: 1 },
  ...extra,
});

describe("receivedTasks", () => {
  const bot = (tasks: Task[], threadId = "main") => ({ id: "designergrafico", threadId, tasks });

  it("keeps what other bots opened and leaves out the bot's own tasks, room lanes, archived ones and the open thread", () => {
    const found = receivedTasks(bot([
      task({ threadId: "from-lumon" }),
      task({ threadId: "own", openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", at: 1 } }),
      task({ threadId: "lane", openedBy: { botId: "lumon", name: "LUMON", roomLane: true, at: 1 } }),
      task({ threadId: "old", archivedAt: 5 }),
      task({ threadId: "open" }),
      { threadId: "mine", title: "Mine", createdAt: 1 },
    ], "open"));
    expect(found.map((entry) => entry.threadId)).toEqual(["from-lumon"]);
  });

  it("keeps the six most recent, oldest first", () => {
    const many = Array.from({ length: 9 }, (_, index) => task({ threadId: `t${index}`, updatedAt: 100 + index }));
    expect(receivedTasks(bot(many)).map((entry) => entry.threadId)).toEqual(["t3", "t4", "t5", "t6", "t7", "t8"]);
  });
});

describe("receivedRounds", () => {
  const latest = (extra: Partial<Task>, messages: Message[]) => receivedRounds(task(extra), messages, DESIGNERGRAFICO).at(-1)!;

  it("shows one request still being worked on with its text, without the mention of the recipient", () => {
    const rounds = receivedRounds(task({ busy: true, activity: "working" }), [ask("a1", 10, "Faz o carrossel da Lumon"), step("s1", 11)], DESIGNERGRAFICO);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.asks).toEqual([{ id: "a1", at: 10, text: "Faz o carrossel da Lumon" }]);
    expect(rounds[0]!.state).toEqual({ kind: "working" });
    expect(rounds[0]!.anchorAt).toBe(10);
  });

  it("puts two requests in a row into one round", () => {
    const rounds = receivedRounds(task({ busy: true, activity: "working" }), [ask("a1", 10, "Primeiro"), ask("a2", 12, "Segundo")], DESIGNERGRAFICO);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.asks.map((entry) => entry.text)).toEqual(["Primeiro", "Segundo"]);
    expect(rounds[0]!.anchorAt).toBe(10);
  });

  it("keeps requests with only work between them in one round", () => {
    const rounds = receivedRounds(task({ busy: true }), [ask("a1", 10, "Primeiro"), step("s1", 11), ask("a2", 12, "Segundo")], DESIGNERGRAFICO);
    expect(rounds.map((round) => round.asks.length)).toEqual([2]);
  });

  it("is returned once the bot answered and stopped working", () => {
    expect(latest({ busy: false }, [ask("a1", 10, "Pedido"), step("s1", 11), reply("r1", 20)]).state).toEqual({ kind: "returned", at: 20 });
  });

  it("returns at the moment the turn completed when the reply carries it", () => {
    const done = { ...reply("r1", 20), turnCompletedAt: 25 };
    expect(latest({ busy: false }, [ask("a1", 10, "Pedido"), done]).state).toEqual({ kind: "returned", at: 25 });
  });

  it("is not returned while the bot still works after speaking", () => {
    expect(latest({ busy: true, activity: "working" }, [ask("a1", 10, "Pedido"), midTurn("r1", 15, "Vou começar.")]).state).toEqual({ kind: "working" });
  });

  it("is not returned by texts written mid-turn once the bot stops without settling: it stopped", () => {
    expect(latest({ busy: false, activity: "idle" }, [ask("a1", 10, "Pedido"), midTurn("m1", 11), step("s1", 12), midTurn("m2", 13)]).state).toEqual({ kind: "stopped" });
  });

  it("returns when the turn settled with its last text", () => {
    expect(latest({ busy: false }, [ask("a1", 10, "Pedido"), midTurn("m1", 11), reply("r1", 20)]).state).toEqual({ kind: "returned", at: 20 });
  });

  it("returns on a settled outcome even when it emitted no text", () => {
    const digest: Message = { id: "d1", role: "bot", kind: "digest", at: 21, turnId: "t", turnSucceeded: true } as Message;
    expect(latest({ busy: false }, [ask("a1", 10, "Pedido"), midTurn("m1", 11), digest]).state).toEqual({ kind: "returned", at: 21 });
  });

  it("is stopped when the turn did not succeed", () => {
    const failed: Message = { ...reply("r1", 20, "Deu erro."), turnSucceeded: false };
    expect(latest({ busy: false }, [ask("a1", 10, "Pedido"), failed]).state).toEqual({ kind: "stopped" });
  });

  it("keeps two requests apart only when a settled turn separates them, not mid-turn texts", () => {
    expect(receivedRounds(task({ busy: true }), [ask("a1", 10, "Um"), midTurn("m1", 11), ask("a2", 12, "Dois")], DESIGNERGRAFICO)).toHaveLength(1);
    expect(receivedRounds(task({ busy: true }), [ask("a1", 10, "Um"), reply("r1", 11), ask("a2", 12, "Dois")], DESIGNERGRAFICO)).toHaveLength(2);
  });

  it("opens a new round for a request that comes after a stopped one", () => {
    const failed: Message = { ...reply("r1", 20, "Deu erro."), turnSucceeded: false };
    const rounds = receivedRounds(task({ busy: true, activity: "working" }), [ask("a1", 10, "Velho"), failed, ask("a2", 30, "Novo")], DESIGNERGRAFICO);
    expect(rounds.map((round) => round.state)).toEqual([{ kind: "stopped" }, { kind: "working" }]);
  });

  it("keeps every round of a thread reused by the sender, each at its own time, oldest first", () => {
    const rounds = receivedRounds(task({ busy: false }), [ask("a1", 10, "Frases de café"), reply("r1", 20), ask("a2", 30, "Nomes de café"), reply("r2", 40)], DESIGNERGRAFICO);
    expect(rounds.map((round) => round.asks.map((entry) => entry.text))).toEqual([["Frases de café"], ["Nomes de café"]]);
    expect(rounds.map((round) => round.anchorAt)).toEqual([10, 30]);
    expect(rounds.map((round) => round.state)).toEqual([{ kind: "returned", at: 20 }, { kind: "returned", at: 40 }]);
  });

  it("gives only the last round the live state while the bot is busy", () => {
    const rounds = receivedRounds(task({ busy: true, activity: "working" }), [ask("a1", 10, "Velho"), reply("r1", 20), ask("a2", 30, "Novo")], DESIGNERGRAFICO);
    expect(rounds.map((round) => round.state)).toEqual([{ kind: "returned", at: 20 }, { kind: "working" }]);
    expect(rounds[1]!.anchorAt).toBe(30);
  });

  it("drops a leading round that has answers but no request, since the page started in the middle", () => {
    const rounds = receivedRounds(task({ busy: false }), [reply("r0", 5, "Resposta cujo pedido ficou antes"), ask("a2", 30, "Pedido"), reply("r2", 40)], DESIGNERGRAFICO);
    expect(rounds.map((round) => round.asks.map((entry) => entry.id))).toEqual([["a2"]]);
  });

  it("reads the last answered round when no newer request exists", () => {
    const round = latest({ busy: false }, [ask("a1", 10, "Velho"), reply("r1", 20), ask("a2", 30, "Último"), reply("r2", 40)]);
    expect(round.asks.map((entry) => entry.text)).toEqual(["Último"]);
    expect(round.state).toEqual({ kind: "returned", at: 40 });
  });

  it("waits for the person when the thread asks for them", () => {
    expect(latest({ busy: true, activity: "waiting-on-you" }, [ask("a1", 10, "Pedido")]).state).toEqual({ kind: "waiting" });
  });

  it("counts a bot waiting on teammates as still working", () => {
    expect(latest({ busy: false, waitingForTeammates: true }, [ask("a1", 10, "Pedido")]).state).toEqual({ kind: "working" });
  });

  it("is queued when asked and nothing happened yet, and stopped when it ended without an answer", () => {
    expect(latest({ busy: false }, [ask("a1", 10, "Pedido")]).state).toEqual({ kind: "queued" });
    expect(latest({ busy: false }, [ask("a1", 10, "Pedido"), step("s1", 11)]).state).toEqual({ kind: "stopped" });
  });

  it("reads a request delivered as a user line with a provenance note", () => {
    const delivered: Message = {
      id: "u1", role: "user", kind: "text", at: 10, peerAsk: { botId: "lumon", name: "LUMON" },
      text: "[Message from @LUMON, another bot in this Nordus workspace] Revisa a capa",
    };
    expect(latest({ busy: true }, [delivered]).asks.map((entry) => entry.text)).toEqual(["Revisa a capa"]);
  });

  it("ignores the bot's own words and lines that are not requests", () => {
    const own: Message = { id: "o1", role: "user", kind: "text", at: 5, text: "Oi, é a pessoa" };
    expect(receivedRounds(task({ busy: true }), [own, reply("r0", 6)], DESIGNERGRAFICO)).toEqual([]);
  });
});

describe("newestRounds", () => {
  it("keeps the newest few across conversations, oldest first", () => {
    const blocks = Array.from({ length: 15 }, (_, index) => ({ anchorAt: (index * 7) % 15 }));
    const kept = newestRounds(blocks);
    expect(kept).toHaveLength(12);
    expect(kept.map((block) => block.anchorAt)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});

describe("placeReceived", () => {
  const times = [10, 20, 30];
  const open = { older: false, newer: false };

  it("goes after the last item at or before its time", () => {
    expect(placeReceived(times, [{ anchorAt: 25 }], open)).toEqual([{ block: { anchorAt: 25 }, after: 1 }]);
  });

  it("goes at the end when newer than everything", () => {
    expect(placeReceived(times, [{ anchorAt: 99 }], open)[0]!.after).toBe(2);
  });

  it("goes before the first item when older than the oldest and no older page exists", () => {
    expect(placeReceived(times, [{ anchorAt: 1 }], open)[0]!.after).toBe(-1);
  });

  it("is left out when older than the loaded page and an older page exists", () => {
    expect(placeReceived(times, [{ anchorAt: 1 }, { anchorAt: 15 }], { older: true, newer: false }).map((entry) => entry.after)).toEqual([0]);
  });

  it("is left out when newer than the last shown item while later ones are hidden", () => {
    expect(placeReceived(times, [{ anchorAt: 99 }, { anchorAt: 25 }], { older: false, newer: true }).map((entry) => entry.after)).toEqual([1]);
  });

  it("orders blocks by when they were asked", () => {
    expect(placeReceived(times, [{ anchorAt: 50 }, { anchorAt: 12 }], open).map((entry) => entry.block.anchorAt)).toEqual([12, 50]);
  });
});
