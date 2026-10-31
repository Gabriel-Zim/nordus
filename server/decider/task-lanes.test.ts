import { describe, expect, it, vi } from "vitest";

import { decideTaskLane, laneResult, laneTitle, laneWork, TASK_LANES_INSTRUCTIONS } from "./task-lanes.ts";

const picked = (choice: string, pTop: number) => ({ choose: vi.fn(async () => ({ ok: true, provider: "jev", latencyMs: 200, answers: { type: "choice", choice, pTop, margin: 0.5, probabilities: { [choice]: pTop } } })) }) as any;

describe("task lanes", () => {
  it("asks Jev under its own switch with the current work and the new message", async () => {
    const decider = picked("parallel", 0.9);
    await expect(decideTaskLane(decider, { bot: "DESIGNERDEIA", currentWork: "Arte do carrossel da Fabrikam", message: "Me passa a legenda do post da Lumon" }))
      .resolves.toEqual({ choice: "parallel", probability: 0.9 });
    const [seam, state, question] = decider.choose.mock.calls[0]!;
    expect(seam).toBe("taskLanes");
    expect(state).toMatchObject({ current_work: "Arte do carrossel da Fabrikam", new_message: "Me passa a legenda do post da Lumon" });
    expect(Object.keys(question.options)).toEqual(["continue", "queue", "parallel"]);
    expect(question.instructions).toBe(TASK_LANES_INSTRUCTIONS);
  });

  it("unsure or failing keeps today's behavior", async () => {
    expect(await decideTaskLane(picked("parallel", 0.5), { bot: "x", currentWork: "y", message: "z" })).toBeNull();
    expect(await decideTaskLane({ choose: vi.fn(async () => ({ ok: false, reason: "timeout" })) } as any, { bot: "x", currentWork: "y", message: "z" })).toBeNull();
  });

  it("titles and brings the answer home in one message", () => {
    expect(laneTitle("Me passa a legenda do post da Lumon")).toBe("Me passa a legenda do post da Lumon");
    expect(laneResult("Legenda", "Aqui está.")).toBe('Sobre "Legenda":\n\nAqui está.');
    expect(laneResult("Legenda", "")).toContain('Terminei "Legenda"');
    // The line ran hidden: the person is never sent to a conversation they cannot see.
    expect(laneResult("Legenda", "")).not.toMatch(/conversa/i);
  });
});

describe("laneWork", () => {
  it("is the person's last ask and the bot's latest real line after it, never a quick note", () => {
    const path = [
      { role: "user", kind: "text", at: 1, text: "roda os testes" },
      { role: "bot", kind: "text", at: 2, text: "Rodando agora." },
      { role: "bot", kind: "text", at: 3, text: "Ainda estou rodando todos os testes, há 21 min.", quickAck: true },
    ];
    expect(laneWork(path)).toEqual({ ask: "roda os testes", update: "Rodando agora." });
    expect(laneWork(path.slice(0, 1))).toEqual({ ask: "roda os testes", update: undefined });
  });
});
