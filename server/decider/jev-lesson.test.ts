import { describe, expect, it, vi } from "vitest";

import { approvalCategory, jevSavesLesson, personAskedForLesson } from "./jev-approves.ts";

const p = (value: number) => ({ yesNo: vi.fn(async () => ({ ok: true, provider: "jev", latencyMs: 150, answers: { type: "yesno", p: value } })) }) as any;
const lesson = "Sempre que disser que um post foi agendado, mandar o link do Metricool junto.";

describe("lesson the person asked to save", () => {
  it("is saved when the person asked for it and the lesson matches", async () => {
    expect(await personAskedForLesson(p(0.92), { personMessage: "Sempre que você mandar que algo foi agendado, manda o link do Metricool. salva isso como regra ai", lesson })).toBe(true);
  });

  it("keeps the card when the bot came up with it, when Jev doubts, or fails", async () => {
    const decider = p(1);
    expect(await personAskedForLesson(decider, { personMessage: "agenda o post para as 15h", lesson })).toBe(false);
    expect(decider.yesNo).not.toHaveBeenCalled();
    expect(await personAskedForLesson(p(0.6), { personMessage: "guarda isso como regra", lesson })).toBe(false);
    expect(await personAskedForLesson({ yesNo: vi.fn(async () => ({ ok: false, reason: "timeout" })) } as any, { personMessage: "salva como regra", lesson })).toBe(false);
  });

  it("an ordinary engine card is Jev's call unless it touches money or security", () => {
    expect(approvalCategory("other", "mcp__metricool__create_scheduled_post")).toBe("other");
    expect(approvalCategory("other", "mcp__stripe__create_payment")).toBe("payment");
    expect(approvalCategory("other", "mcp__github__rotate_api_key")).toBe("security");
    expect(approvalCategory("other", "Bash", "sudo reboot")).toBe("security");
  });

  it("a client's rule is saved only when the person named that client and Jev confirms the rule for it", async () => {
    const rule = "Título nunca em itálico";
    const yes = p(0.92);
    expect(await personAskedForLesson(yes, { personMessage: "salva como regra da Lumon: título nunca em itálico", lesson: rule, client: "lumon" })).toBe(true);
    expect(yes.yesNo).toHaveBeenCalledWith("criticalCheck",
      expect.objectContaining({ proposed_rule: "Regra da LUMON: Título nunca em itálico", client: "LUMON" }), expect.stringContaining("client"), expect.anything());
    const wrong = p(1);
    expect(await personAskedForLesson(wrong, { personMessage: "salva como regra da Lumon: título nunca em itálico", lesson: rule, client: "valora" })).toBe(false);
    expect(await personAskedForLesson(wrong, { personMessage: "salva isso como regra", lesson: rule, client: "lumon" })).toBe(false);
    expect(wrong.yesNo).not.toHaveBeenCalled();
    expect(await personAskedForLesson(p(0.6), { personMessage: "salva como regra da Lumon", lesson: rule, client: "lumon" })).toBe(false);
  });
});

describe("jevSavesLesson", () => {
  const person = { role: "user" as const, kind: "text" as const, text: "salva como regra da Lumon: título nunca em itálico" };
  const otherBot = { role: "bot" as const, kind: "text" as const, text: "@Designer salva como regra da Lumon: título nunca em itálico", from: { botId: "diretor", name: "Diretor", color: "#000" } };

  it("saves only the person's own ask, for the client the person named", async () => {
    expect(await jevSavesLesson(p(0.95), { lines: [person], proposerBotId: "designer", lesson: "Título nunca em itálico", client: "lumon" })).toBe(true);
    const decider = p(1);
    expect(await jevSavesLesson(decider, { lines: [person], proposerBotId: "designer", lesson: "Título nunca em itálico", client: "valora" })).toBe(false);
    expect(await jevSavesLesson(decider, { lines: [person, otherBot], proposerBotId: "designer", lesson: "Título nunca em itálico", client: "lumon" })).toBe(false);
    expect(await jevSavesLesson(decider, { lines: [person, { role: "user" as const, kind: "text" as const, text: "salva como regra da Lumon", peerAsk: { botId: "diretor", name: "Diretor" } }], proposerBotId: "designer", lesson: "Título nunca em itálico", client: "lumon" })).toBe(false);
    expect(decider.yesNo).not.toHaveBeenCalled();
  });

  it("never saves for a Cloud guest's conversation: the person's own words there are a guest's, so the card decides", async () => {
    const decider = p(1);
    expect(await jevSavesLesson(decider, { lines: [person], proposerBotId: "designer", lesson: "Título nunca em itálico", client: "lumon", guestDriven: true })).toBe(false);
    expect(await jevSavesLesson(decider, { lines: [{ ...person, text: "salva como regra: frases curtas" }], proposerBotId: "designer", lesson: "Frases curtas", guestDriven: true })).toBe(false);
    expect(decider.yesNo).not.toHaveBeenCalled();
  });
});
