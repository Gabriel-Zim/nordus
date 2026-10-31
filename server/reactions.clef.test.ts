import { describe, expect, it, vi } from "vitest";

import type { OptionCardData } from "../shared/wire.ts";
import { assistedCardReply } from "./reactions.ts";

const question = (patch: Partial<OptionCardData>): OptionCardData => ({ title: "Question", subtitle: "Quando publico?", options: [], requestId: "q1", requestType: "question", ...patch });
const approval: OptionCardData = { title: "Run a command", subtitle: "rm -rf build", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash" };

describe("assistedCardReply", () => {
  it("lets the rule answer first and never asks the model then", async () => {
    const read = vi.fn();
    expect(await assistedCardReply(question({ options: ["Yes", "Later"] }), "yes", read)).toEqual({ behavior: "answer", message: "Yes" });
    expect(await assistedCardReply(approval, "yes", read)).toEqual({ behavior: "allow" });
    expect(read).not.toHaveBeenCalled();
  });

  it("an approval card stays allow or deny by the reaction alone", async () => {
    const read = vi.fn().mockResolvedValue("Allow");
    expect(await assistedCardReply({ ...approval, options: ["Run it", "Skip"] }, "no", read)).toEqual({ behavior: "deny" });
    expect(read).not.toHaveBeenCalled();
  });

  it("answers a plain options card with the option the model names", async () => {
    const read = vi.fn().mockResolvedValue("Publicar hoje");
    const card = question({ options: ["Publicar hoje", "Deixar para amanhã"] });
    expect(await assistedCardReply(card, "yes", read)).toEqual({ behavior: "answer", message: "Publicar hoje" });
    expect(read).toHaveBeenCalledWith({ question: "Quando publico?", options: ["Publicar hoje", "Deixar para amanhã"], answer: "yes" });
  });

  it("answers a single question in the card's own format", async () => {
    const card = question({ questionRequest: { version: 1, questions: [{ question: "Which subject?", options: [{ label: "Q3 update" }, { label: "Weekly notes" }] }] } });
    const reply = await assistedCardReply(card, "yes", vi.fn().mockResolvedValue("Q3 update"));
    expect(reply).toEqual({ behavior: "answer", message: "The user answered your questions.\n\nQ: Which subject?\nA: Q3 update" });
  });

  it("is null when the model has nothing, names something not offered, throws, or the card has several questions", async () => {
    const card = question({ options: ["Publicar hoje", "Deixar para amanhã"] });
    expect(await assistedCardReply(card, "yes", vi.fn().mockResolvedValue(null))).toBeNull();
    expect(await assistedCardReply(card, "yes", vi.fn().mockResolvedValue("Apagar tudo"))).toBeNull();
    expect(await assistedCardReply(card, "yes", vi.fn().mockRejectedValue(new Error("down")))).toBeNull();
    expect(await assistedCardReply(card, "yes", undefined)).toBeNull();
    const two = question({ questionRequest: { version: 1, questions: [{ question: "A?", options: [{ label: "x" }, { label: "y" }] }, { question: "B?", options: [{ label: "z" }, { label: "w" }] }] } });
    const read = vi.fn().mockResolvedValue("x");
    expect(await assistedCardReply(two, "yes", read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
