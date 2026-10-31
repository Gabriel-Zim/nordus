import { afterEach, describe, expect, it, vi } from "vitest";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { WORK_STEP_PROMPT } from "./system-prompt.ts";
import { cleanStepText, perThreadLater, WorkSteps } from "./work-steps.ts";

const step = (text: string) => cleanStepText(text)!;

describe("work steps", () => {
  it("records the tools a bot uses until it says a step of its own, then only its own steps", () => {
    const steps = new WorkSteps();
    expect(steps.tool("designer", "t1", "mcp__agents__informar_etapa")).toBe(false);
    expect(steps.tool("designer", "t1", "mcp__agents__list_bots")).toBe(false);
    expect(steps.tool("designer", "t1", "Read", 1)).toBe(true);
    expect(steps.tool("designer", "t1", "Read", 2)).toBe(false);
    expect(steps.tool("designer", "t1", "mcp__figma__get_screenshot", 3)).toBe(true);
    expect(steps.declare("designer", "t1", step("montando a lâmina 1 do carrossel de lançamento."), 4)).toBe(true);
    expect(steps.tool("designer", "t1", "mcp__zorg__gerar_imagem", 5)).toBe(false);
    expect(steps.declare("designer", "t1", step("Montando a lâmina 1 do carrossel de lançamento"), 6)).toBe(false);
    expect(steps.declare("designer", "t1", step("Montando a lâmina 2 de 5"), 7)).toBe(true);
    expect(steps.forThread("t1")).toEqual([
      { at: 1, tool: "Read" },
      { at: 3, tool: "mcp__figma__get_screenshot" },
      { at: 4, text: "Montando a lâmina 1 do carrossel de lançamento" },
      { at: 7, text: "Montando a lâmina 2 de 5" },
    ]);
  });

  it("keeps what a shell command does, never the command, and starts a step when the command changes", () => {
    const steps = new WorkSteps();
    expect(steps.tool("programador", "t1", "Bash", 1, { summary: "corepack pnpm test" })).toBe(true);
    expect(steps.tool("programador", "t1", "Bash", 2, { summary: "pnpm test" })).toBe(false);
    expect(steps.tool("programador", "t1", "Bash", 3, { input: JSON.stringify({ command: "pnpm exec tsc -p tsconfig.server.json --noEmit" }) })).toBe(true);
    expect(steps.tool("programador", "t1", "Bash", 4, { summary: "cat ~/.ssh/config" })).toBe(true);
    expect(steps.tool("programador", "t1", "Read", 5, { summary: "pnpm test" })).toBe(true);
    expect(steps.forThread("t1")).toEqual([
      { at: 1, tool: "Bash", command: "allTests" },
      { at: 3, tool: "Bash", command: "typeCheck" },
      { at: 4, tool: "Bash" },
      { at: 5, tool: "Read" },
    ]);
  });

  it("forgets a thread's steps when its turn ends, and a new speaker in a room starts clean", () => {
    const steps = new WorkSteps();
    steps.declare("designergrafico", "room", step("Dividindo o carrossel entre a equipe"), 1);
    expect(steps.forThread("room", "designer")).toEqual([]);
    steps.declare("designer", "room", step("Montando a lâmina 1"), 2);
    expect(steps.forThread("room", "designer")).toEqual([{ at: 2, text: "Montando a lâmina 1" }]);
    expect(steps.clear("room")?.botId).toBe("designer");
    expect(steps.forThread("room")).toEqual([]);
  });

  it("puts an empty list on the wire for the next speaker, so a room frame clears the last speaker's steps", () => {
    const steps = new WorkSteps();
    steps.declare("designer", "room", step("Montando a lâmina 2 de 5"), 1);
    steps.clear("room");
    const frame = JSON.parse(JSON.stringify({ busyBotId: "designergrafico", steps: steps.forThread("room", "designergrafico") }));
    expect(frame).toEqual({ busyBotId: "designergrafico", steps: [] });
  });

  it("keeps a step to one plain line, without em dash, markdown or a trailing period", () => {
    expect(cleanStepText("**Ajustando** a capa — versão 2.\n")).toBe("Ajustando a capa, versão 2");
    expect(cleanStepText("Revisando a capa ... ;")).toBe("Revisando a capa");
    expect(cleanStepText("ok")).toBeNull();
    expect(cleanStepText(" . . . ")).toBeNull();
    expect(cleanStepText(42)).toBeNull();
    const long = cleanStepText(`Montando ${"a lâmina ".repeat(30)}`)!;
    expect(long.length).toBeLessThanOrEqual(121);
    expect(long.endsWith("…")).toBe(true);
  });

  it("drops invisible and direction characters but keeps the joiner inside an emoji", () => {
    expect(cleanStepText("Ajus‮tando⁦ a capa⁩​﻿")).toBe("Ajustando a capa");
    expect(cleanStepText("Revisando com a equipe 👩‍💻")).toBe("Revisando com a equipe 👩‍💻");
  });

  it("refuses a text far past a step's size at once, and cleans the longest one it accepts fast", () => {
    const flood = `Montando ${". ".repeat(20_000)}x`;
    const started = performance.now();
    expect(cleanStepText(flood)).toBeNull();
    expect(cleanStepText(`Montando ${". ".repeat(495)}x`)).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("informar_etapa as every bot reads it", () => {
  it("shows a neutral example, naming no client of the house", () => {
    const tool = availableTools(catalogProfileFromEnv({})).find((candidate) => candidate.name === "informar_etapa")!;
    for (const text of [tool.description, WORK_STEP_PROMPT]) {
      expect(text).toContain("Montando a lâmina 2 de 5 do carrossel de lançamento");
      expect(text).not.toMatch(/Lumon|Built to Endure/);
    }
  });
});

describe("perThreadLater", () => {
  afterEach(() => vi.useRealTimers());

  it("runs once per thread for a burst, and again for the next burst", () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const later = perThreadLater(500, (threadId) => ran.push(threadId));
    later.schedule("t1");
    later.schedule("t1");
    later.schedule("t2");
    vi.advanceTimersByTime(499);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(["t1", "t2"]);
    later.schedule("t1");
    vi.advanceTimersByTime(500);
    expect(ran).toEqual(["t1", "t2", "t1"]);
  });

  it("drops a pending run once the thread was sent by other means", () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const later = perThreadLater(500, (threadId) => ran.push(threadId));
    later.schedule("t1");
    later.cancel("t1");
    vi.advanceTimersByTime(1_000);
    expect(ran).toEqual([]);
  });
});
