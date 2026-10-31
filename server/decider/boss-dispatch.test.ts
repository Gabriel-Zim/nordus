import { describe, expect, it } from "vitest";

import { BOSS_OPTION, bossDispatchRequest, decideBossDispatch } from "./boss-dispatch.ts";

const input = {
  boss: { name: "Diretor", title: "Boss" },
  team: [{ id: "designerdeia", name: "DESIGNERDEIA", title: "Designer" }, { id: "social", name: "Social", title: "Pautas e agenda" }],
  message: "Faz a capa do post de sexta",
};
const answering = (choice: string, pTop: number) => ({ choose: async () => ({ ok: true as const, provider: "jev" as const, answers: { type: "choice" as const, choice, pTop, margin: pTop, probabilities: { [choice]: pTop } } }) });

describe("boss dispatch", () => {
  it("offers the Boss and every teammate by role", () => {
    const { question } = bossDispatchRequest(input);
    expect(Object.keys(question.options)).toEqual([BOSS_OPTION, "designerdeia", "social"]);
    expect(question.options.designerdeia).toContain("Designer");
  });

  it("hands over only a confident pick of a teammate", async () => {
    expect(await decideBossDispatch(answering("designerdeia", 0.9) as never, input)).toEqual({ botId: "designerdeia", probability: 0.9 });
    expect(await decideBossDispatch(answering("designerdeia", 0.5) as never, input)).toBeNull();
    expect(await decideBossDispatch(answering(BOSS_OPTION, 0.95) as never, input)).toBeNull();
    expect(await decideBossDispatch(answering("stranger", 0.95) as never, input)).toBeNull();
    expect(await decideBossDispatch({ choose: async () => ({ ok: false as const, reason: "timeout" as const }) } as never, input)).toBeNull();
  });
});
