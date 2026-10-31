import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { foldPoint } from "./compaction-summary.ts";
import { DATA_DIR } from "./config.ts";
import type { ReplayEntry } from "./context-rebuild.ts";
import { captureTurnsFrom, flushBeforeCompaction, memoryFlushThreshold, MemoryFlushes } from "./memory-flush.ts";
import { createMemoryUpkeep, type UpkeepBot } from "./memory-upkeep.ts";
import { closeMessageDb } from "./message-db.ts";
import { workspaceDir, WORKSPACES_DIR } from "./workspace.ts";

const BOT: UpkeepBot = { id: "bot-flush-test", name: "Scout", memoryUpkeep: true };

const history: ReplayEntry[] = [
  { id: "u1", role: "user", text: "O cliente Fabrikam fecha o mês sempre no dia 25, anota isso." },
  { id: "a1", role: "assistant", text: "Anotado." },
  { id: "u2", role: "user", text: "Agora faz o carrossel de terça." },
  { id: "a2", role: "assistant", text: "Feito, segue o rascunho." },
  { id: "u3", role: "user", text: "Ajusta a cor do título." },
  { id: "a3", role: "assistant", text: "Ajustado." },
  { id: "u4", role: "user", text: "Manda a versão final." },
];

describe("memory before compaction", () => {
  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    rmSync(WORKSPACES_DIR, { recursive: true, force: true });
  });

  it("starts at 70% of the window, never after the compaction point", () => {
    expect(memoryFlushThreshold(200_000, 160_000)).toBe(140_000);
    expect(memoryFlushThreshold(200_000, 100_000)).toBe(100_000);
  });

  it("captures only the part about to be folded, as person and reply pairs", () => {
    const fold = foldPoint(history)!;
    const turns = captureTurnsFrom(fold.folded);
    expect(turns).toEqual([
      { person: "O cliente Fabrikam fecha o mês sempre no dia 25, anota isso.", bot: "Anotado.", owner: false },
      { person: "Agora faz o carrossel de terça.", bot: "Feito, segue o rascunho.", owner: false },
    ]);
  });

  it("puts a fact said in the folded part into MEMORY.md before the summary", async () => {
    const prompts: string[] = [];
    const upkeep = createMemoryUpkeep({
      bots: () => [BOT], bot: (id) => (id === BOT.id ? BOT : undefined),
      engine: () => ({
        generateText: async (prompt) => {
          prompts.push(prompt);
          if (prompt.includes("dia 25")) return JSON.stringify([{ text: "Fabrikam closes the month on the 25th", kind: "fact", confidence: 0.95 }]);
          return '{"moves": []}';
        },
      }),
      busy: () => false, addToAboutMe: () => 0, sourceLabel: () => 'chat "Fabrikam"', quietMs: () => 60_000, tidyHour: () => 3,
    });
    const outcome = await flushBeforeCompaction(captureTurnsFrom(foldPoint(history)!.folded), (turns) => upkeep.capture({ botId: BOT.id, threadId: "t1", turns: [...turns] }));
    expect(outcome).toBe("captured");
    expect(readFileSync(join(workspaceDir(BOT.id), "MEMORY.md"), "utf8")).toContain("Fabrikam closes the month on the 25th");
    expect(prompts.some((prompt) => prompt.includes("Manda a versão final"))).toBe(false);
  });

  it("runs once per compaction, and a slow capture never holds the compaction past the timeout", async () => {
    const flushes = new MemoryFlushes();
    expect(flushes.due("t1", "start")).toBe(true);
    flushes.mark("t1", "start");
    expect(flushes.due("t1", "start")).toBe(false);
    expect(flushes.due("t1", "compaction-1")).toBe(true);
    expect(await flushBeforeCompaction([{ person: "x", bot: "y" }], () => new Promise(() => {}), 20)).toBe("timeout");
    expect(await flushBeforeCompaction([{ person: "x", bot: "y" }], () => Promise.reject(new Error("down")))).toBe("failed");
    expect(await flushBeforeCompaction([], () => Promise.resolve())).toBe("empty");
  });
});
