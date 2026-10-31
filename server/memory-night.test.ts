import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { CaptureTurn } from "./memory-capture.ts";
import { DEFAULT_NIGHT_WINDOW } from "./memory-gate.ts";
import { TIDY_MARKER } from "./memory-tidy.ts";
import { createMemoryUpkeep, type MemoryUpkeep, type UpkeepBot } from "./memory-upkeep.ts";
import { closeMessageDb } from "./message-db.ts";
import { ensureWorkspace, workspaceDir, writeMemoryFile, WORKSPACES_DIR } from "./workspace.ts";

const BOT: UpkeepBot = { id: "bot-night-test", name: "Scout" };
const WORK = "Faz a capa do carrossel do dólar com a balança de cobre torta";
const REMEMBER = "Lembra disso: o cliente só aprova capa com fundo claro";

// 13:00 UTC = 10:00 em São Paulo (fora da janela); 06:00 UTC = 03:00 em São Paulo (dentro dela)
const DAY = new Date(Date.UTC(2026, 9, 26, 13, 0));
const NIGHT = new Date(Date.UTC(2026, 9, 27, 6, 0));

describe("a consolidação de memória em lote", () => {
  let clock: Date;
  let prompts: string[];
  let transcript: Map<string, CaptureTurn>;
  let batching: boolean;
  let services: MemoryUpkeep[];

  const upkeep = () => {
    const service = createMemoryUpkeep({
      bots: () => [BOT],
      bot: (id) => (id === BOT.id ? BOT : undefined),
      engine: () => ({
        generateText: async (prompt) => {
          prompts.push(prompt);
          return prompt.includes(TIDY_MARKER) ? '{"pairs":[]}' : "[]";
        },
      }),
      busy: () => false,
      addToAboutMe: () => 0,
      sourceLabel: () => 'chat "Plans"',
      restoreTurn: (_botId, _threadId, turnId) => transcript.get(turnId) ?? null,
      quietMs: () => 60_000,
      tidyHour: () => 3,
      night: () => (batching ? DEFAULT_NIGHT_WINDOW : null),
      now: () => clock,
    });
    services.push(service);
    return service;
  };

  const say = (service: MemoryUpkeep, thread: string, person: string, bot: string, turnId: string) => {
    const turn: CaptureTurn = { person, bot, turnId };
    transcript.set(turnId, turn);
    service.noteTurn(BOT.id, thread, turn);
    service.flushThread(thread);
  };

  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    rmSync(WORKSPACES_DIR, { recursive: true, force: true });
    clock = DAY;
    prompts = [];
    transcript = new Map();
    batching = true;
    services = [];
    ensureWorkspace(BOT.id);
  });

  afterEach(() => {
    for (const service of services) service.stop();
  });

  it("não chama modelo para cortesia nem para NADA_NOVO, e não deixa nada na fila", async () => {
    const service = upkeep();
    say(service, "t1", "valeu, obrigado!", "De nada, qualquer coisa é só chamar por aqui, combinado?", "a1");
    say(service, "t2", "", "NADA_NOVO", "a2");
    await service.idle();
    expect(prompts).toEqual([]);
    expect(service.waitingForNight()).toBe(0);
  });

  it("segura a conversa de conteúdo para a madrugada, sem chamada durante o dia", async () => {
    const service = upkeep();
    say(service, "t1", WORK, "Feito, a capa está pronta para você ver aqui.", "b1");
    await service.idle();
    expect(prompts).toEqual([]);
    expect(service.waitingForNight()).toBe(1);
    expect(service.drainNight()).toBe(0);
    await service.tick();
    await service.idle();
    expect(prompts).toEqual([]);
  });

  it("na janela, lê tudo de uma conversa em uma chamada só, e conversas do mesmo robô juntas", async () => {
    const service = upkeep();
    say(service, "t1", WORK, "Feito, a capa está pronta para você ver aqui.", "c1");
    say(service, "t1", "Troca o fundo da capa para um verde mais escuro, por favor", "Troquei, olha como ficou agora.", "c2");
    say(service, "t2", "Agenda o reel no Metricool para as onze da manhã", "Agendei o reel às 11h no Metricool.", "c3");
    expect(service.waitingForNight()).toBe(2);
    clock = NIGHT;
    await service.tick();
    await service.idle();
    const captures = prompts.filter((prompt) => !prompt.includes(TIDY_MARKER));
    expect(captures).toHaveLength(1);
    expect(captures[0]).toContain("Conversation 1");
    expect(captures[0]).toContain("Conversation 2");
    expect(captures[0]).toContain("Troca o fundo da capa");
    expect(captures[0]).toContain("Agenda o reel no Metricool");
    expect(service.waitingForNight()).toBe(0);
    // a fila já esvaziou: uma segunda passada na mesma noite não lê de novo
    await service.tick();
    await service.idle();
    expect(prompts.filter((prompt) => !prompt.includes(TIDY_MARKER))).toHaveLength(1);
  });

  it("o que a pessoa pediu para lembrar é lido já, com o que a mesma conversa tinha esperando", async () => {
    const service = upkeep();
    say(service, "t1", WORK, "Feito, a capa está pronta para você ver aqui.", "d1");
    expect(service.waitingForNight()).toBe(1);
    say(service, "t1", REMEMBER, "Anotado: capa sempre com fundo claro.", "d2");
    await service.idle();
    const captures = prompts.filter((prompt) => !prompt.includes(TIDY_MARKER));
    expect(captures).toHaveLength(1);
    expect(captures[0]).toContain(REMEMBER);
    expect(captures[0]).toContain(WORK);
    expect(service.waitingForNight()).toBe(0);
  });

  it("uma conversa de outro robô sobrevive a um desligamento e é lida na noite seguinte", async () => {
    const first = upkeep();
    say(first, "t1", WORK, "Feito, a capa está pronta para você ver aqui.", "e1");
    first.stop();
    const saved = JSON.parse(readFileSync(join(DATA_DIR, "memory-capture-night.json"), "utf8")) as { entries: { turnIds: string[] }[] };
    expect(saved.entries[0]!.turnIds).toEqual(["e1"]);

    const second = upkeep();
    second.start();
    expect(second.waitingForNight()).toBe(1);
    clock = NIGHT;
    expect(second.drainNight()).toBe(1);
    await second.idle();
    expect(prompts.filter((prompt) => !prompt.includes(TIDY_MARKER))).toHaveLength(1);
    expect(existsSync(join(DATA_DIR, "memory-capture-night.json"))).toBe(false);
  });

  it("com o lote desligado, volta a consolidar logo que a conversa fica quieta", async () => {
    batching = false;
    const service = upkeep();
    say(service, "t1", WORK, "Feito, a capa está pronta para você ver aqui.", "f1");
    await service.idle();
    expect(prompts).toHaveLength(1);
    expect(service.waitingForNight()).toBe(0);
  });

  it("uma conversa que espera mais de 30 horas é lida mesmo fora da janela", async () => {
    const service = upkeep();
    say(service, "t1", WORK, "Feito, a capa está pronta para você ver aqui.", "g1");
    clock = new Date(clock.getTime() + 31 * 3600_000);
    expect(service.drainNight()).toBe(1);
    await service.idle();
    expect(prompts).toHaveLength(1);
  });

  it("limita o que uma conversa guarda para a noite, soltando primeiro as falas menores", async () => {
    const service = upkeep();
    for (let i = 0; i < 16; i++) say(service, "t1", i === 3 ? "Muda a cor do botão" : `${WORK} versão ${i}`, "Feito, a versão nova está pronta para ver.", `h${i}`);
    const saved = JSON.parse(readFileSync(join(DATA_DIR, "memory-capture-night.json"), "utf8")) as { entries: { turnIds: string[] }[] };
    expect(saved.entries[0]!.turnIds).toHaveLength(12);
    expect(saved.entries[0]!.turnIds).not.toContain("h3");
  });

  it("a arrumação noturna só roda na janela, e sem mudança nas notas não repete a checagem de contradição", async () => {
    writeMemoryFile(BOT.id, [
      "- 2026-09-02 · Office is in Pune",
      "- 2026-09-03 · Likes tea",
      "- 2026-09-05 · Has a dog",
      "- 2026-09-06 · Drives a Honda",
      "- 2026-09-07 · Plays chess",
      "",
    ].join("\n"));
    const service = upkeep();
    const checks = () => prompts.filter((prompt) => prompt.includes(TIDY_MARKER)).length;
    await service.tick();
    expect(checks()).toBe(0);
    clock = NIGHT;
    await service.tick();
    expect(checks()).toBe(1);
    // outra noite, notas iguais: nenhuma chamada
    clock = new Date(NIGHT.getTime() + 24 * 3600_000);
    await service.tick();
    expect(checks()).toBe(1);
    // uma nota nova muda o que o modelo leria: confere de novo
    writeMemoryFile(BOT.id, `${readFileSync(join(workspaceDir(BOT.id), "MEMORY.md"), "utf8")}- 2026-10-26 · Moved to Mumbai\n`);
    clock = new Date(NIGHT.getTime() + 48 * 3600_000);
    await service.tick();
    expect(checks()).toBe(2);
  });
});
