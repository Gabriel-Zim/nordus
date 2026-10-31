import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  BrainContext, BrainJournal, brainLaunch, brainProject, formatContext, readSecondBrain, secondBrainForBot, writeSecondBrainSettings,
} from "./second-brain.ts";

const dir = () => mkdtempSync(join(tmpdir(), "brain-"));

describe("second brain access", () => {
  it("reaches only the listed bots, never a client-facing one", () => {
    const data = dir();
    writeFileSync(join(data, "second-brain.json"), JSON.stringify({ command: "/usr/bin/ssh", args: ["-T", "host"], bots: ["boss", "support"], clientFacing: ["support"] }));
    const config = readSecondBrain(data);
    expect(secondBrainForBot(config, "boss")).toEqual({ "second-brain": { command: "/usr/bin/ssh", args: ["-T", "host"], env: {}, enabled: true } });
    expect(secondBrainForBot(config, "social")).toEqual({});
    expect(secondBrainForBot(config, "support")).toEqual({});
  });

  it("is off without a valid file, and falls back to the config.json entry for the server's own calls", () => {
    const data = dir();
    expect(secondBrainForBot(readSecondBrain(data), "boss")).toEqual({});
    expect(brainLaunch(null, { "second-brain": { command: "/usr/bin/ssh", args: ["x"], enabled: true } })).toEqual({ command: "/usr/bin/ssh", args: ["x"], env: {} });
    expect(brainLaunch(null, { "second-brain": { command: "/usr/bin/ssh", enabled: false } })).toBeNull();
    writeFileSync(join(data, "second-brain.json"), "{ not json");
    expect(readSecondBrain(data)).toBeNull();
  });

  it("keeps the connection when saving the switches", () => {
    const data = dir();
    writeFileSync(join(data, "second-brain.json"), JSON.stringify({ command: "/usr/bin/ssh", bots: ["boss"] }));
    const saved = writeSecondBrainSettings(data, { record: false, clientFacing: ["support"] });
    expect(saved).toMatchObject({ command: "/usr/bin/ssh", bots: ["boss"], record: false, consult: true, clientFacing: ["support"] });
    expect(readSecondBrain(data)).toMatchObject({ command: "/usr/bin/ssh", record: false });
  });
});

describe("journal", () => {
  const turn = (over: Partial<Parameters<BrainJournal["note"]>[0]> = {}) => ({
    botId: "bot-aaaaaaaa", botName: "Diretor", threadId: "thread-bbbbbbbb", roomName: "Cliente Fabrikam", toolCalls: 2, reply: "Montei o roteiro. Mandei para o Social revisar. Fim.", at: 0, ...over,
  });

  it("logs real work once per conversation, after a quiet spell, and skips chat", async () => {
    let now = 0;
    const call = vi.fn(async () => ({ registered: true }));
    const journal = new BrainJournal({ enabled: () => true, call, now: () => now, machine: "lab" });
    journal.note(turn({ toolCalls: 0, at: 0 }));
    journal.note(turn({ at: 0 }));
    journal.note(turn({ at: 60_000, toolCalls: 3 }));
    now = 120_000;
    expect(await journal.flush()).toBe(0);
    now = 60_000 + 3 * 60_000;
    expect(await journal.flush()).toBe(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("registrar_atividade", expect.objectContaining({
      project: "cliente-fabrikam", event: "progresso", capture: "hook", machine: "lab",
      summary: "Diretor trabalhou na sala Cliente Fabrikam (5 ações em 2 turnos). Montei o roteiro. Mandei para o Social revisar.",
    }));
  });

  it("keeps an entry when the write fails and logs nothing when switched off", async () => {
    const failing = vi.fn(async () => { throw new Error("down"); });
    const journal = new BrainJournal({ enabled: () => true, call: failing });
    journal.note(turn());
    expect(await journal.flush(true)).toBe(0);
    const ok = vi.fn(async () => ({}));
    Object.assign((journal as unknown as { deps: object }).deps, { call: ok });
    expect(await journal.flush(true)).toBe(1);
    const off = new BrainJournal({ enabled: () => false, call: ok });
    off.note(turn());
    expect(await off.flush(true)).toBe(0);
  });
});

describe("room context", () => {
  const events = { recent_events: [
    { occurred: "2026-10-16T20:00:00+00:00", actor: "nordus", project: "fabrikam-hq", summary: "Carrossel da Fabrikam aprovado." },
    { occurred: "2026-10-16T21:00:00+00:00", actor: "nordus", project: "lumon", summary: "Render da Lumon entregue." },
  ] };
  const docs: Record<string, string> = { "clientes/fabrikam/BRIEFING.md": "# Fabrikam\nTom sóbrio, fotos reais.", "clientes/lumon/BRIEFING.md": "# Lumon\nRender intocável." };
  const brain = () => vi.fn(async (name: string, args: Record<string, unknown>) => name === "consultar_diario" ? events : name === "ler_documento" ? { content: docs[String(args.path)] } : { results: Object.keys(docs).map((path) => ({ path })) });

  it("FABRIKAM HQ never gets anything from LUMON, and the other way round", async () => {
    const call = brain();
    const context = new BrainContext({ call });
    const fabrikam = await context.forRoom("FABRIKAM HQ", ["clientes/fabrikam/BRIEFING.md"]);
    const lumon = await context.forRoom("LUMON", ["clientes/lumon/BRIEFING.md"]);
    expect(fabrikam).toContain("Carrossel da Fabrikam aprovado.");
    expect(fabrikam).toContain("Tom sóbrio");
    expect(fabrikam).not.toMatch(/lumon/i);
    expect(lumon).toContain("Render da Lumon entregue.");
    expect(lumon).toContain("Render intocável");
    expect(lumon).not.toMatch(/fabrikam/i);
    expect(call.mock.calls.some(([name]) => name === "buscar_contexto")).toBe(false);
  });

  it("each production HQ room reads only its own client", async () => {
    const files: Record<string, string> = {
      "empresas/zorg-content/clientes/fabrikam-invest.md": "Fabrikam Invest: tom sóbrio.",
      "empresas/zorg-content/clientes/lumon.md": "Lumon: render intocável.",
      "empresas/zorg-content/clientes/evergreen-capital.md": "EVERGREEN: câmbio como oportunidade.",
      "fabrikam/AGENTS.original.md": "Fabrikam de informação, não é cliente.",
    };
    const call = vi.fn(async (name: string, args: Record<string, unknown>) => name === "ler_documento" ? { content: files[String(args.path)] } : { recent_events: [] });
    const context = new BrainContext({ call });
    const rooms: Array<[string, string[], string]> = [
      ["FABRIKAM HQ", ["empresas/zorg-content/clientes/fabrikam-invest.md"], "Fabrikam Invest"],
      ["LUMON HQ", ["empresas/zorg-content/clientes/lumon.md"], "Lumon"],
      ["EVERGREEN HQ", ["empresas/zorg-content/clientes/evergreen-capital.md"], "EVERGREEN"],
    ];
    for (const [room, paths, own] of rooms) {
      const text = await context.forRoom(room, paths);
      expect(text).toContain(own);
      for (const [, , other] of rooms.filter(([name]) => name !== room)) expect(text).not.toContain(other);
      expect(text).not.toContain("Fabrikam de informação");
    }
    expect(await context.forRoom("@AVERYMERCER.AI HQ")).toBe("");
  });

  it("gives a room without mapped documents only its own journal", async () => {
    const call = brain();
    const text = await new BrainContext({ call }).forRoom("FABRIKAM HQ");
    expect(text).toContain("Carrossel da Fabrikam aprovado.");
    expect(text).not.toContain("Documento");
    expect(call.mock.calls.every(([name]) => name === "consultar_diario")).toBe(true);
    expect(formatContext("Sala", "sala", { recent_events: [] }, [])).toBe("");
  });

  it("caches a room for a few minutes", async () => {
    let now = 0;
    const call = brain();
    const context = new BrainContext({ call, now: () => now });
    await context.forRoom("FABRIKAM HQ", ["clientes/fabrikam/BRIEFING.md"]);
    await context.forRoom("FABRIKAM HQ", ["clientes/fabrikam/BRIEFING.md"]);
    expect(call).toHaveBeenCalledTimes(2);
    now = 6 * 60_000;
    await context.forRoom("FABRIKAM HQ", ["clientes/fabrikam/BRIEFING.md"]);
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("names projects from rooms", () => {
    expect(brainProject("Fabrikam Imóveis")).toBe("fabrikam-imoveis");
    expect(brainProject(null)).toBe("zorg-operacao");
  });
});

describe("second brain rules", () => {
  it("come with the server only", async () => {
    const { customMcpPrompt } = await import("./system-prompt.ts");
    expect(customMcpPrompt(["second-brain"])).toContain("BRAIN_MAPA.md");
    expect(customMcpPrompt(["linear"])).not.toContain("BRAIN_MAPA");
  });
});
