import { describe, expect, it, vi } from "vitest";

import type { Decider } from "./index.ts";
import {
  NO_SKILL_OPTION, OWNER_NONE_OPTION, actionReallyCritical, chooseOwner, modelForBotTurn, modelForSize, modelRank, sizesTurns, notifyPriority, pickSkill, sizeTurn, suggestBotTags, triageInbox,
} from "./nordus-uses.ts";
import type { DeciderResult } from "./types.ts";

type Asker = Pick<Decider, "choose" | "score" | "yesNo">;
const choice = (choice: string, pTop: number): DeciderResult<any> =>
  ({ ok: true, provider: "jev", latencyMs: 200, answers: { type: "choice", choice, pTop, margin: pTop - 0.1, probabilities: { [choice]: pTop } } });
const failed: DeciderResult<any> = { ok: false, provider: "jev", reason: "timeout" };
function asker(over: Partial<Record<keyof Asker, (...args: any[]) => Promise<DeciderResult<any>>>>): Asker & Record<keyof Asker, ReturnType<typeof vi.fn>> {
  return {
    choose: vi.fn(over.choose ?? (async () => failed)),
    score: vi.fn(over.score ?? (async () => failed)),
    yesNo: vi.fn(over.yesNo ?? (async () => failed)),
  } as any;
}

const TEAM = [
  { id: "designerdeia", name: "DESIGNERDEIA", title: "Capas e carrosséis" },
  { id: "fin", name: "Financeiro", title: "Contas e cobranças" },
];

describe("right-size the model", () => {
  const catalog = { default: "claude-opus-5-5", options: [
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  ] };

  it("ranks models by name", () => {
    expect([modelRank("claude-haiku-5-5"), modelRank("claude-sonnet-5"), modelRank("claude-opus-5-5")]).toEqual([0, 1, 2]);
  });

  it("light goes to Haiku, normal to Sonnet, heavy keeps the bot's own", () => {
    expect(modelForSize(catalog, "claude-opus-5-5", "light")).toBe("claude-haiku-5-5");
    expect(modelForSize(catalog, "claude-opus-5-5", "light", { pinnedSessionModel: true })).toBeNull();
    expect(modelForSize(catalog, "claude-opus-5-5", "normal")).toBe("claude-sonnet-5-5");
    expect(modelForSize(catalog, "claude-opus-5-5", "heavy")).toBeNull();
  });

  it("never goes above the bot's own model", () => {
    expect(modelForSize(catalog, "claude-sonnet-5", "heavy")).toBeNull();
    expect(modelForSize(catalog, "claude-sonnet-5", "normal")).toBeNull();
    expect(modelForSize(catalog, "claude-haiku-5-5", "heavy")).toBeNull();
    expect(modelForSize(catalog, "claude-sonnet-5", "light")).toBe("claude-haiku-5-5");
  });

  it("never picks Fable, which sits above Opus, even when the catalog lists it first", () => {
    const real = { default: "claude-sonnet-5", options: [
      { id: "claude-fable-5-1", label: "Fable 5.1" }, { id: "claude-fable-5", label: "Fable 5" },
      { id: "claude-opus-5-5", label: "Opus 5.5" }, { id: "claude-opus-5", label: "Opus 5" },
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5" }, { id: "claude-sonnet-5", label: "Sonnet 5" },
      { id: "claude-haiku-5-5", label: "Haiku 5.5" }, { id: "claude-haiku-4-5", label: "Haiku 4.5" },
    ] };
    expect(modelRank("claude-fable-5-1")).toBe(3);
    expect(modelForSize(real, "claude-opus-5-5", "normal")).toBe("claude-sonnet-5-5");
    expect(modelForSize(real, "claude-opus-5-5", "light")).toBe("claude-haiku-5-5");
    expect(modelForSize(real, "claude-opus-5-5", "heavy")).toBeNull();
    expect(modelForSize(real, "claude-fable-5-1", "heavy")).toBeNull();
    expect(modelForSize(real, "claude-fable-5-1", "normal")).toBe("claude-sonnet-5-5");
  });

  it("stays with the same provider", () => {
    const mixed = { default: "x", options: [{ id: "gpt-5-mini", label: "mini" }, { id: "claude-opus-5-5", label: "Opus" }] };
    expect(modelForSize(mixed, "claude-opus-5-5", "light")).toBeNull();
  });

  it("reads Jev's level, and keeps the bot's model when unsure", async () => {
    const scored = (level: number, p: number) => async () => ({ ok: true, provider: "jev", latencyMs: 150, answers: { type: "score", score: level, level, probabilities: [0, 1, 2].map((i) => (i === level ? p : (1 - p) / 2)) } }) as DeciderResult<any>;
    expect(await sizeTurn(asker({ score: scored(0, 0.9) }), { text: "obrigado!" })).toBe("light");
    expect(await sizeTurn(asker({ score: scored(2, 0.8) }), { text: "monta a estratégia do trimestre" })).toBe("heavy");
    expect(await sizeTurn(asker({ score: scored(1, 0.4) }), { text: "hmm" })).toBeNull();
  });
});

describe("notifications", () => {
  it("urgent, normal or noise; unsure is null", async () => {
    expect(await notifyPriority(asker({ choose: async () => choice("urgent", 0.8) }), { kind: "turn", title: "Cliente esperando" })).toBe("urgent");
    expect(await notifyPriority(asker({ choose: async () => choice("noise", 0.5) }), { kind: "turn", title: "ok" })).toBeNull();
  });
});

describe("critical actions", () => {
  it("spending, deleting and sending always ask, without a call", async () => {
    const decider = asker({ yesNo: async () => ({ ok: true, provider: "jev", latencyMs: 1, answers: { type: "yesno", p: 0.01 } }) });
    for (const group of ["spend", "delete", "send"]) expect(await actionReallyCritical(decider, { group, tool: "x", summary: "y" })).toBe(true);
    expect(decider.yesNo).not.toHaveBeenCalled();
  });

  it("a config or deploy action passes only when Jev is sure it is not critical", async () => {
    const p = (value: number) => asker({ yesNo: async () => ({ ok: true, provider: "jev", latencyMs: 1, answers: { type: "yesno", p: value } }) });
    expect(await actionReallyCritical(p(0.05), { group: "config", tool: "Bash", summary: "systemctl restart my-dev-server" })).toBe(false);
    expect(await actionReallyCritical(p(0.4), { group: "config", tool: "Bash", summary: "sudo ufw disable" })).toBe(true);
    expect(await actionReallyCritical(asker({}), { group: "deploy", tool: "Bash", summary: "git push" })).toBe(true);
  });
});

describe("skills", () => {
  it("names a skill that fits, or none", async () => {
    const skills = [{ name: "carrossel", description: "Monta carrossel" }, { name: "edit-falando", description: "Edita vídeo" }];
    expect(await pickSkill(asker({ choose: async () => choice("carrossel", 0.8) }), { text: "faz um carrossel", skills })).toBe("carrossel");
    expect(await pickSkill(asker({ choose: async () => choice(NO_SKILL_OPTION, 0.9) }), { text: "oi", skills })).toBeNull();
    expect(await pickSkill(asker({}), { text: "oi", skills: [] })).toBeNull();
  });
});

describe("inbox triage", () => {
  const item = { from: "cliente@lumon.com", subject: "Fatura de outubro", text: "Podem reenviar a fatura?" };
  it("sorts newsletters and spam with one call", async () => {
    const decider = asker({ choose: async () => choice("newsletter", 0.9) });
    await expect(triageInbox(decider, { item, bots: TEAM })).resolves.toEqual({ category: "newsletter", probability: 0.9 });
    expect(decider.choose).toHaveBeenCalledTimes(1);
  });

  it("a bot's job names the bot", async () => {
    const decider = asker({ choose: vi.fn().mockResolvedValueOnce(choice("bot", 0.8)).mockResolvedValueOnce(choice("fin", 0.85)) as any });
    await expect(triageInbox(decider, { item, bots: TEAM })).resolves.toEqual({ category: "bot", botId: "fin", probability: 0.8 });
    expect(decider.choose.mock.calls[0]![0]).toBe("emailTriage");
    expect(decider.choose.mock.calls[1]![0]).toBe("emailTriage");
  });

  it("a portal request is asked under the portal switch", async () => {
    const decider = asker({ choose: async () => choice("important", 0.9) });
    await triageInbox(decider, { item: { ...item, source: "portal" }, bots: TEAM });
    expect(decider.choose.mock.calls[0]![0]).toBe("portalRouting");
  });

  it("no clear owner is null", async () => {
    expect(await chooseOwner(asker({ choose: async () => choice(OWNER_NONE_OPTION, 0.9) }), "emailTriage", { members: TEAM, text: "x", instructions: "?" })).toBeNull();
  });

  it("unsure says so; a failure is null", async () => {
    await expect(triageInbox(asker({ choose: async () => choice("important", 0.4) }), { item, bots: TEAM })).resolves.toEqual({ category: "unsure", probability: 0.4 });
    await expect(triageInbox(asker({}), { item, bots: TEAM })).resolves.toBeNull();
  });
});

describe("the bot's tag", () => {
  const ranked = (probabilities: Record<string, number>): DeciderResult<any> => {
    const [choice, pTop] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]!;
    return { ok: true, provider: "jev", latencyMs: 200, answers: { type: "choice", choice, pTop, margin: 0.1, probabilities } };
  };
  const designer = { name: "DesignerGrafico", title: "Diretora de arte", description: "Cria capas e carrosséis da marca." };

  it("offers the likeliest catalog tags, at most three, the first one first", async () => {
    const jev = asker({ choose: async () => ranked({ diretordearte: 0.5, designer: 0.2, designergrafico: 0.12, branding: 0.09, financeiro: 0.01 }) });
    expect(await suggestBotTags(jev, designer)).toEqual(["Diretor de Arte", "Designer", "Designer Gráfico"]);
    const [seam, state, question] = jev.choose.mock.calls[0]!;
    expect(seam).toBe("tagSuggest");
    expect(state).toEqual({ bot: { name: "DesignerGrafico", title: "Diretora de arte", description: "Cria capas e carrosséis da marca." } });
    expect(question.options.desenvolvedorfrontend).toBe("Desenvolvedor Front-end (Tecnologia)");
  });

  it("leaves out the weak runners-up", async () => {
    const jev = asker({ choose: async () => ranked({ financeiro: 0.7, cobranca: 0.05 }) });
    expect(await suggestBotTags(jev, { title: "Contas e cobranças" })).toEqual(["Financeiro"]);
  });

  it("suggests nothing when Jev is unsure or failing", async () => {
    expect(await suggestBotTags(asker({ choose: async () => ranked({ designer: 0.1, financeiro: 0.09 }) }), designer)).toEqual([]);
    expect(await suggestBotTags(asker({}), designer)).toEqual([]);
    expect(await suggestBotTags(asker({ choose: async () => { throw new Error("down"); } }), designer)).toEqual([]);
  });

  it("asks nothing while the bot has only a name, however long", async () => {
    const idle = asker({ choose: async () => ranked({ designer: 0.9 }) });
    expect(await suggestBotTags(idle, { name: "Pixel" })).toEqual([]);
    expect(await suggestBotTags(idle, { name: "Scout", title: "  ", description: "\n" })).toEqual([]);
    expect(idle.choose).not.toHaveBeenCalled();
    expect(await suggestBotTags(idle, { name: "Pixel", description: "Arte das capas" })).toEqual(["Designer"]);
  });

  it("never offers a key outside the catalog", async () => {
    expect(await suggestBotTags(asker({ choose: async () => ranked({ astronauta: 0.9 }) }), designer)).toEqual([]);
  });
});

describe("simple requests of the Boss and fixed-model bots go to Sonnet", () => {
  const catalog = { default: "claude-opus-5-5", options: [
    { id: "claude-opus-5-5", label: "Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  ] };
  const gerentedeoperacao = { id: "gerentedeoperacao", name: "Gerente De Operacao", chiefOfStaff: true };
  const fixed = { id: "fix", name: "Fixo", modelFixed: true };
  const editordevideo = { id: "editordevideo", name: "EDITORDEVIDEO", modelFixed: true };
  const plain = { id: "plain", name: "Comum" };
  const OPUS = "claude-opus-5-5";

  it("the Boss: light goes to Sonnet (not Haiku), normal and heavy keep Opus", () => {
    expect(modelForBotTurn(gerentedeoperacao, undefined, catalog, OPUS, "light")).toBe("claude-sonnet-5-5");
    expect(modelForBotTurn(gerentedeoperacao, undefined, catalog, OPUS, "normal")).toBeNull();
    expect(modelForBotTurn(gerentedeoperacao, undefined, catalog, OPUS, "heavy")).toBeNull();
  });

  it("a fixed-model bot: light goes to Sonnet, the rest keeps its model", () => {
    expect(modelForBotTurn(fixed, undefined, catalog, OPUS, "light")).toBe("claude-sonnet-5-5");
    expect(modelForBotTurn(fixed, undefined, catalog, OPUS, "normal")).toBeNull();
  });

  it("EDITORDEVIDEO is excluded by default, by name or by id, and the list is configurable", () => {
    expect(modelForBotTurn(editordevideo, undefined, catalog, OPUS, "light")).toBeNull();
    expect(sizesTurns(editordevideo, undefined)).toBe(false);
    expect(modelForBotTurn({ ...fixed, name: "Outro" }, { simpleToSonnetExclude: ["FIX"] }, catalog, OPUS, "light")).toBeNull();
    expect(modelForBotTurn(editordevideo, { simpleToSonnetExclude: ["outro"] }, catalog, OPUS, "light")).toBe("claude-sonnet-5-5");
  });

  it("an engine that pins the session model keeps it", () => {
    expect(modelForBotTurn(gerentedeoperacao, undefined, catalog, OPUS, "light", { pinnedSessionModel: true })).toBeNull();
  });

  it("a non-Claude bot keeps its model", () => {
    const gpt = { default: "gpt-5.5", options: [{ id: "gpt-5.5", label: "GPT 5.5" }, { id: "gpt-5.5-mini", label: "mini" }] };
    expect(modelForBotTurn(gerentedeoperacao, undefined, gpt, "gpt-5.5", "light")).toBeNull();
    expect(modelForBotTurn(fixed, undefined, gpt, "gpt-5.5", "light")).toBeNull();
  });

  it("a Boss already on Sonnet stays there", () => {
    expect(modelForBotTurn(gerentedeoperacao, undefined, catalog, "claude-sonnet-5", "light")).toBeNull();
  });

  it("the switch off brings back the old behaviour: fixed bots are not sized at all", () => {
    const off = { simpleToSonnetForFixed: false };
    expect(sizesTurns(gerentedeoperacao, off)).toBe(false);
    expect(modelForBotTurn(gerentedeoperacao, off, catalog, OPUS, "light")).toBeNull();
    expect(modelForBotTurn(fixed, off, catalog, OPUS, "light")).toBeNull();
  });

  it("an ordinary bot is sized as before, whatever the new settings say", () => {
    for (const settings of [undefined, { simpleToSonnetForFixed: false }, { simpleToSonnetExclude: ["comum"] }]) {
      expect(sizesTurns(plain, settings)).toBe(true);
      expect(modelForBotTurn(plain, settings, catalog, OPUS, "light")).toBe("claude-haiku-5-5");
      expect(modelForBotTurn(plain, settings, catalog, OPUS, "normal")).toBe("claude-sonnet-5-5");
      expect(modelForBotTurn(plain, settings, catalog, OPUS, "heavy")).toBeNull();
    }
  });
});
