import { describe, expect, it } from "vitest";

import { composeExecutionPrompt, foreignPaths, isNothingNewReply, routineHostWarning } from "./routine-execution.ts";

describe("foreignPaths", () => {
  it("finds Windows paths on Linux and macOS, but not URLs, times or data URIs", () => {
    const text = "Read C:\\Users\\Ada\\notes.txt, then d:/exports/q3.csv and \\\\fileserver\\share\\plan.docx; see https://example.com/Users/x at 10:30 (data:/x).";
    expect(foreignPaths([text], "linux")).toEqual(["C:\\Users\\Ada\\notes.txt", "d:/exports/q3.csv", "\\\\fileserver\\share\\plan.docx"]);
    expect(foreignPaths([text], "darwin")).toEqual(["C:\\Users\\Ada\\notes.txt", "d:/exports/q3.csv", "\\\\fileserver\\share\\plan.docx"]);
    expect(foreignPaths([text], "win32")).toEqual([]);
  });

  it("finds macOS paths on Linux, and POSIX home paths on Windows", () => {
    expect(foreignPaths(["Copy /Users/ada/Desktop/report.pdf to /home/ada/out."], "linux")).toEqual(["/Users/ada/Desktop/report.pdf"]);
    expect(foreignPaths(["Copy /Users/ada/Desktop/report.pdf to /home/ada/out."], "darwin")).toEqual(["/home/ada/out"]);
    expect(foreignPaths(["Copy /Users/ada/Desktop/report.pdf to /home/ada/out."], "win32")).toEqual(["/Users/ada/Desktop/report.pdf", "/home/ada/out"]);
    expect(foreignPaths(["Open ~/Users/notes and ./home/x"], "linux")).toEqual([]);
  });

  it("names the host that runs a cloud routine as Linux whatever this computer is", () => {
    const routine = { prompt: "Total E:\\ledger.xlsx", runOn: "cloud" as const };
    expect(routineHostWarning(routine, "win32")).toContain("cannot exist on the Linux computer that runs it");
    expect(routineHostWarning({ ...routine, runOn: "nordus" }, "win32")).toBeUndefined();
  });
});

describe("composeExecutionPrompt", () => {
  it("heads scheduled and manual runs with what to do now, and leaves webhook runs to their own boundary", () => {
    expect(composeExecutionPrompt({ name: "Daily [brief]\n", trigger: "schedule", runOn: "nordus" }, "Write it", undefined))
      .toBe('[Scheduled routine "Daily brief" — do this now:]\nWrite it');
    expect(composeExecutionPrompt({ name: "Daily", trigger: "startup", runOn: "nordus" }, "Write it", undefined))
      .toBe('[Routine "Daily" — do this now:]\nWrite it');
    expect(composeExecutionPrompt({ name: "Hook", trigger: "webhook", runOn: "nordus" }, "Payload block", undefined)).toBe("Payload block");
  });
});

describe("news-only routines", () => {
  it("ask for NADA_NOVO only when the routine reports only news", () => {
    const routine = { name: "Vigia", trigger: "schedule" as const, runOn: "nordus" as const };
    const quietable = composeExecutionPrompt({ ...routine, reportOnlyNews: true }, "Olhe o portal", undefined);
    expect(quietable).toContain("Olhe o portal");
    expect(quietable).toContain("responda exatamente NADA_NOVO e mais nada");
    expect(composeExecutionPrompt(routine, "Olhe o portal", undefined)).not.toContain("NADA_NOVO");
  });

  it("treat a reply whose last line is the token as nothing new, and the token anywhere else as news", () => {
    const real = "Agora são 14:15 em Brasília. Os itens de lumon estão para 20/10, e nenhum de fabrikam ou evergreen está na lista.\n\nNADA_NOVO";
    for (const reply of [real, `${real}\n`, "Conferi o portal.\n**NADA_NOVO**", "Conferi o portal.\r\n\r\n“NADA_NOVO”!", "Nada pendente.\n`NADA_NOVO`."]) {
      expect(isNothingNewReply(reply), reply).toBe(true);
    }
    for (const reply of ["Conferi.\nNADA_NOVO\nMas o Trello caiu.", "Conferi o portal. NADA_NOVO", "Conferi.\nNADA_NOVO, mas o Trello falhou",
      "Conferi.\nnada_novo", "Conferi.\nNADA_NOVO!!"]) {
      expect(isNothingNewReply(reply), reply).toBe(false);
    }
  });

  it("treat only the bare token as nothing new", () => {
    for (const reply of ["NADA_NOVO", " NADA_NOVO\n", "`NADA_NOVO`", "```NADA_NOVO```", "NADA_NOVO.", "`NADA_NOVO`.", "NADA_NOVO!",
      "**NADA_NOVO**", "__NADA_NOVO__", '"NADA_NOVO"', "“NADA_NOVO”", "**NADA_NOVO.**", "“NADA_NOVO”!"]) {
      expect(isNothingNewReply(reply), reply).toBe(true);
    }
    for (const reply of ["NADA_NOVO, mas o Trello falhou", "Nada novo.", "NADA_NOVO\nO portal caiu.", "`NADA_NOVO", "NADA_NOVO..", "", undefined,
      "nada_novo", "**NADA_NOVO** mas o Trello caiu", '"NADA_NOVO', "NADA_NOVO!!", "**NADA_NOVO__", "O portal: “NADA_NOVO”"]) {
      expect(isNothingNewReply(reply), String(reply)).toBe(false);
    }
  });
});

describe("routine retry and pause", async () => {
  const { routinePauseBrief, routineRetryDelayMs, routineRetriesSoFar } = await import("./routine-execution.ts");
  it("waits 15 s, 1 min, then 5 min", () => {
    expect([1, 2, 3, 4].map(routineRetryDelayMs)).toEqual([15_000, 60_000, 300_000, 300_000]);
    expect(routineRetriesSoFar({ retryAt: 1 })).toBe(1);
    expect(routineRetriesSoFar({ retryAt: undefined })).toBe(0);
  });
  it("tells what failed and what to change, without dashes", () => {
    const brief = routinePauseBrief("Relatório", "workspace unauthorized (401)");
    expect(brief).toContain('A rotina "Relatório" falhou 5 vezes seguidas e foi pausada');
    expect(brief).toContain("reconectar a conta");
    expect(brief).not.toMatch(/[\u2014\u2013]/);
    expect(routinePauseBrief("X", "request timed out")).toContain("dar mais tempo");
    expect(routinePauseBrief("X", undefined)).not.toContain("último erro");
  });
});
