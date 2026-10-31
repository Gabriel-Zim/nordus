import { describe, expect, it } from "vitest";
import { startOfDayIn, describeOpsSnapshot, describeOpsWatch, opsAttention, opsWatchDecision, type OpsSnapshot } from "./ops-snapshot.ts";

const now = Date.UTC(2026, 9, 16, 21, 0);
const empty: OpsSnapshot = { at: now, failedRoutines: [], waitingApprovals: [], stuckWork: [], incidents: [], proposals: [], costToday: [] };
const failed = { key: "routine:r1", botName: "Financeiro", title: "Relatório diário", at: now - 60_000, detail: "O modelo não respondeu" };

describe("ops snapshot", () => {
  it("stays asleep when nothing needs attention", () => {
    expect(opsWatchDecision(opsAttention(empty), new Set(), 0)).toEqual({ wake: false, fresh: [], reason: "nothing-new" });
  });

  it("wakes for something new and not again for the same thing", () => {
    const snapshot = { ...empty, failedRoutines: [failed] };
    expect(opsWatchDecision(opsAttention(snapshot), new Set(), 0)).toMatchObject({ wake: true, reason: "news", fresh: [failed] });
    expect(opsWatchDecision(opsAttention(snapshot), new Set([failed.key]), 1).wake).toBe(false);
  });

  it("keeps quiet after three warnings in a day", () => {
    const snapshot = { ...empty, failedRoutines: [failed] };
    expect(opsWatchDecision(opsAttention(snapshot), new Set(), 3)).toMatchObject({ wake: false, reason: "daily-limit" });
  });

  it("counts the day from midnight in São Paulo", () => {
    // 21:00 UTC is 18:00 in São Paulo; its day started at 03:00 UTC.
    expect(startOfDayIn(now)).toBe(Date.UTC(2026, 9, 16, 3, 0));
    expect(startOfDayIn(Date.UTC(2026, 9, 17, 1, 0))).toBe(Date.UTC(2026, 9, 16, 3, 0));
  });

  it("words the day in Portuguese without dashes", () => {
    const text = describeOpsSnapshot({
      ...empty,
      failedRoutines: [failed],
      proposals: [{ key: "card:1", botName: "DESIGNERDEIA", title: "Nova regra: logo sem caixa", at: now - 3 * 60 * 60_000 }],
      costToday: [{ botName: "Diretor", usd: 1.5, turns: 4 }],
    });
    expect(text).toContain("Rotinas que falharam nas últimas 24 horas:");
    expect(text).toContain("Relatório diário (Financeiro");
    expect(text).toContain("DESIGNERDEIA: Nova regra: logo sem caixa (há 3 horas)");
    expect(text).toContain("Diretor US$ 1,50 em 4 turnos");
    expect(text).toContain("Trabalho entre bots parado há mais de 1 hora: nada.");
    expect(text).not.toMatch(/[—–]/);
    expect(describeOpsWatch(empty, [failed])).toMatch(/^Novidades desde o último aviso:\n- Financeiro: Relatório diário/);
  });
});
