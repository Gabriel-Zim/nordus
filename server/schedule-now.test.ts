import { describe, expect, it, vi } from "vitest";

import {
  clientMentioned, itemsMentioned, readScheduleNow, resultSentence, ScheduleNow, scheduleNowPrefilter, type RunResult,
} from "./schedule-now.ts";

const choice = (choice: string, pTop = 0.95, margin = 0.9) => ({ type: "choice" as const, choice, pTop, margin, probabilities: {} });
const reading = (ordem: ReturnType<typeof choice>, cliente: ReturnType<typeof choice>) =>
  ({ ok: true as const, provider: "clef" as const, answers: { ordem, cliente }, latencyMs: 5 });

/** A fake CLEF that answers each phrase the way the real one should. */
function fakeClef(table: Record<string, [string, string]>) {
  const ask = vi.fn(async (_seam: string, state: { mensagem_da_pessoa: string }) => {
    const [ordem, cliente] = table[state.mensagem_da_pessoa] ?? ["incerto", "nenhum"];
    return reading(choice(ordem), choice(cliente));
  });
  return { ask } as unknown as Parameters<typeof readScheduleNow>[0] & { ask: typeof ask };
}

const PHRASES: Record<string, [string, string]> = {
  "esse aqui é da EVERGREEN, pode já agendar": ["sim", "evergreen"],
  "já pode agendar": ["sim", "nenhum"],
  "não, já pode agendar": ["sim", "nenhum"],
  "agenda os da Fabrikam": ["sim", "fabrikam"],
  "quando você vai agendar?": ["nao", "nenhum"],
  "não agenda ainda": ["nao", "nenhum"],
};

describe("filtro por palavras", () => {
  it("deixa passar só o que fala de agendar", () => {
    expect(scheduleNowPrefilter("já pode agendar")).toBe(true);
    expect(scheduleNowPrefilter("libera os da Fabrikam")).toBe(true);
    expect(scheduleNowPrefilter("bom dia, como estão as coisas?")).toBe(false);
  });
  it("acha o cliente e os itens citados", () => {
    expect(clientMentioned("esse aqui é da EVERGREEN")).toBe("evergreen");
    expect(clientMentioned("EVERGREEN e Fabrikam")).toBeNull();
    expect(itemsMentioned("agenda os posts 12 e 15")).toEqual(["12", "15"]);
    expect(itemsMentioned("agenda tudo")).toEqual([]);
  });
});

function build(clef: ReturnType<typeof fakeClef>, run: (c: string, a: string[]) => Promise<RunResult>) {
  const lines: string[] = [];
  const runner = vi.fn(run);
  const scheduler = new ScheduleNow({ decider: clef, settings: () => undefined, run: runner, say: (_t, text) => { lines.push(text); } });
  const send = (text: string, extra: Partial<Parameters<ScheduleNow["handle"]>[0]> = {}) =>
    scheduler.handle({ botId: "b1", threadId: "t1", text, admin: true, recent: [], ...extra });
  return { send, runner, lines };
}

describe("ordem de agendar no chat", () => {
  it.each([
    ["esse aqui é da EVERGREEN, pode já agendar", "evergreen"],
    ["agenda os da Fabrikam", "fabrikam"],
  ])("dispara na hora: %s", async (text, client) => {
    const { send, runner, lines } = build(fakeClef(PHRASES), async () => ({ ok: true, stdout: JSON.stringify({ agendados: 2 }) }));
    const out = await send(text);
    expect(out.dispatched).toBe(true);
    await out.done;
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]![0]).toBe("portal-agendar-agora");
    expect(runner.mock.calls[0]![1]).toEqual([client]);
    expect(lines.at(-1)).toMatch(/^Agendei 2 posts d[ao] /);
  });

  it("usa o cliente do robô quando a frase não diz", async () => {
    const { send, runner } = build(fakeClef(PHRASES), async () => ({ ok: true, stdout: "" }));
    const out = await send("já pode agendar", { botClient: "evergreen" });
    await out.done;
    expect(runner.mock.calls[0]![1]).toEqual(["evergreen"]);
  });

  it("usa o cliente da última mensagem, e sem cliente nenhum não dispara", async () => {
    const a = build(fakeClef(PHRASES), async () => ({ ok: true, stdout: "" }));
    const out = await a.send("não, já pode agendar", { recent: ["os posts da Lumon ficaram prontos"] });
    await out.done;
    expect(a.runner.mock.calls[0]![1]).toEqual(["lumon"]);
    const b = build(fakeClef(PHRASES), async () => ({ ok: true, stdout: "" }));
    expect((await b.send("já pode agendar")).dispatched).toBe(false);
    expect(b.runner).not.toHaveBeenCalled();
  });

  it.each(["quando você vai agendar?", "não agenda ainda"])("não dispara em: %s", async (text) => {
    const { send, runner, lines } = build(fakeClef(PHRASES), async () => ({ ok: true, stdout: "" }));
    expect((await send(text, { botClient: "evergreen" })).dispatched).toBe(false);
    expect(runner).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("quem não é administrador nunca dispara, nem chama o modelo", async () => {
    const clef = fakeClef(PHRASES);
    const { send, runner } = build(clef, async () => ({ ok: true, stdout: "" }));
    expect((await send("esse aqui é da EVERGREEN, pode já agendar", { admin: false })).dispatched).toBe(false);
    expect(runner).not.toHaveBeenCalled();
    expect(clef.ask).not.toHaveBeenCalled();
  });

  it("sem palavra de agendar não chama o modelo", async () => {
    const clef = fakeClef(PHRASES);
    const { send } = build(clef, async () => ({ ok: true, stdout: "" }));
    await send("bom dia");
    expect(clef.ask).not.toHaveBeenCalled();
  });

  it("modelo fora do ar ou em dúvida deixa para o robô", async () => {
    const down = { ask: vi.fn().mockResolvedValue({ ok: false, reason: "timeout" }) } as unknown as ReturnType<typeof fakeClef>;
    expect((await build(down, async () => ({ ok: true, stdout: "" })).send("já pode agendar", { botClient: "evergreen" })).dispatched).toBe(false);
    const unsure = { ask: vi.fn().mockResolvedValue(reading(choice("sim", 0.6, 0.2), choice("evergreen"))) } as unknown as ReturnType<typeof fakeClef>;
    expect((await build(unsure, async () => ({ ok: true, stdout: "" })).send("já pode agendar")).dispatched).toBe(false);
  });

  it("a mesma mensagem chama o comando uma vez só", async () => {
    const { send, runner } = build(fakeClef(PHRASES), async () => ({ ok: true, stdout: "" }));
    const first = await send("agenda os da Fabrikam", { sendId: "s1" });
    const again = await send("agenda os da Fabrikam", { sendId: "s1" });
    await first.done;
    expect(again.dispatched).toBe(false);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("passa os itens citados ao comando", async () => {
    const { send, runner } = build(fakeClef({ "agenda os posts 12 e 15 da EVERGREEN": ["sim", "evergreen"] }), async () => ({ ok: true, stdout: "" }));
    await (await send("agenda os posts 12 e 15 da EVERGREEN")).done;
    expect(runner.mock.calls[0]![1]).toEqual(["evergreen", "12", "15"]);
  });

  it("diz na conversa o que deu errado, em palavras simples", async () => {
    const { send, lines } = build(fakeClef(PHRASES), async () => ({
      ok: true, stdout: JSON.stringify({ agendados: 0, falhas: [{ item: "7", motivo: "falta a capa" }] }),
    }));
    await (await send("esse aqui é da EVERGREEN, pode já agendar")).done;
    expect(lines.at(-1)).toBe("Não consegui agendar o post 7 da EVERGREEN: falta a capa.");
  });

  it("o comando que falha vira uma frase, não um erro", async () => {
    const { send, lines } = build(fakeClef(PHRASES), async () => { throw new Error("boom"); });
    await (await send("agenda os da Fabrikam")).done;
    expect(lines.at(-1)).toBe("Não consegui agendar os posts da FABRIKAM agora.");
  });

  it("o nome do comando vem do config.json", async () => {
    const runner = vi.fn(async (_c: string, _a: string[], _t: number) => ({ ok: true, stdout: "" }));
    const scheduler = new ScheduleNow({ decider: fakeClef(PHRASES), settings: () => ({ command: "/opt/bin/outro" }), run: runner, say: () => {} });
    await (await scheduler.handle({ botId: "b", threadId: "t", text: "agenda os da Fabrikam", admin: true, recent: [] })).done;
    expect(runner.mock.calls[0]![0]).toBe("/opt/bin/outro");
  });
});

describe("frase do resultado", () => {
  it("conta os posts agendados", () => {
    expect(resultSentence("evergreen", { ok: true, stdout: '{"agendados":[1,2]}' }, [])).toBe("Agendei 2 posts da EVERGREEN no Metricool.");
    expect(resultSentence("evergreen", { ok: true, stdout: '{"agendados":0}' }, [])).toContain("Não havia posts");
  });
});
