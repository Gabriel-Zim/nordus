import { describe, expect, it } from "vitest";

import { isTeamHandoff, taskPlace, teammateWork, type TeamBot } from "./team-work.ts";

const designergrafico: TeamBot = { id: "designergrafico", name: "DESIGNERGRAFICO", section: "QG de DESIGN", threadId: "designergrafico-main", tasks: [{ threadId: "designergrafico-main" }] };
const designer = (tasks: TeamBot["tasks"]): TeamBot => ({ id: "designer", name: "Designer", section: "QG de DESIGN", threadId: "designer-main", tasks });
const gerador = (tasks: TeamBot["tasks"]): TeamBot => ({ id: "gerador", name: "Gerador de Imagem", section: "QG de DESIGN", threadId: "gerador-main", tasks });
const assistentefinanceiro = (tasks: TeamBot["tasks"]): TeamBot => ({ id: "assistentefinanceiro", name: "AssistenteFinanceiro", section: "FINANCEIRO", threadId: "assistentefinanceiro-main", tasks });
const fromDesignerGrafico = { botId: "designergrafico", threadId: "designergrafico-main" };

describe("what a bot's teammates are doing on what it asked", () => {
  it("lists a teammate working on its request, with the plain line", () => {
    const bots = [designergrafico, designer([
      { threadId: "d-work", busy: true, activity: "working", doing: "Diagramando a lâmina 3 da Lumon", turnStartedAt: 5, openedBy: fromDesignerGrafico },
      { threadId: "designer-main", busy: true, activity: "working", doing: "Arrumando a pasta" },
    ])];
    expect(teammateWork(designergrafico, bots)).toEqual([
      { botId: "designer", name: "Designer", threadId: "d-work", doing: "Diagramando a lâmina 3 da Lumon", startedAt: 5 },
    ]);
  });

  it("never shows another team's bot, even one it reached", () => {
    const bots = [designergrafico, assistentefinanceiro([{ threadId: "k-work", busy: true, activity: "working", doing: "Somando as notas", openedBy: fromDesignerGrafico }])];
    expect(teammateWork(designergrafico, bots)).toEqual([]);
  });

  it("follows the request down the team, but stops at the team's edge", () => {
    const bots = [
      designergrafico,
      designer([{ threadId: "d-work", busy: false, activity: "idle", openedBy: fromDesignerGrafico }]),
      gerador([{ threadId: "g-work", busy: true, activity: "working", doing: "Gerando a foto da capa", openedBy: { botId: "designer", threadId: "d-work" } }]),
      assistentefinanceiro([{ threadId: "k-work", busy: true, activity: "working", openedBy: { botId: "designer", threadId: "d-work" } }]),
    ];
    expect(teammateWork(designergrafico, bots).map(work => work.name)).toEqual(["Gerador de Imagem"]);
  });

  it("only counts work running for this conversation, and not a teammate waiting on the person", () => {
    const bots = [designergrafico, designer([
      { threadId: "d-other", busy: true, activity: "working", openedBy: { botId: "designergrafico", threadId: "designergrafico-other" } },
      { threadId: "d-ask", busy: true, activity: "waiting-on-you", openedBy: fromDesignerGrafico },
      { threadId: "d-done", busy: false, activity: "idle", openedBy: fromDesignerGrafico },
    ])];
    expect(teammateWork(designergrafico, bots)).toEqual([]);
  });

  it("shows nothing between bots without a team: they are not a team", () => {
    const lumon: TeamBot = { id: "lumon", name: "LUMON", threadId: "lumon-main" };
    const evergreen: TeamBot = { id: "evergreen", name: "EVERGREEN", section: "  ", threadId: "evergreen-main", tasks: [
      { threadId: "e-work", busy: true, activity: "working", doing: "Montando a tabela", openedBy: { botId: "lumon", threadId: "lumon-main" } }] };
    const fabrikam: TeamBot = { id: "fabrikam", name: "FABRIKAM", threadId: "fabrikam-main", tasks: [
      { threadId: "f-work", busy: true, activity: "working", openedBy: { botId: "evergreen", threadId: "e-work" } }] };
    expect(teammateWork(lumon, [lumon, evergreen, fabrikam])).toEqual([]);
    expect(teammateWork(designergrafico, [designergrafico, { ...evergreen, tasks: [{ threadId: "e-work", busy: true, activity: "working", openedBy: fromDesignerGrafico }] }])).toEqual([]);
  });

  it("does not take a task with no opener conversation as work of this conversation", () => {
    const bots = [designergrafico, designer([{ threadId: "d-legacy", busy: true, activity: "working", openedBy: { botId: "designergrafico" } }])];
    expect(teammateWork(designergrafico, bots)).toEqual([]);
  });
});

describe("a handoff pill between teammates", () => {
  const bots = [designergrafico, designer([]), assistentefinanceiro([])];
  const pill = (name: string, botId = "designer") =>
    ({ kind: "activity", tool: { name, ok: true }, threadRef: { botId, threadId: "t", title: "@DESIGNERGRAFICO · work" } });

  it("is the sending and replying between teammates", () => {
    expect(isTeamHandoff(pill("Sent to Designer"), designergrafico, bots)).toBe(true);
    expect(isTeamHandoff(pill("Designer replied"), designergrafico, bots)).toBe(true);
    expect(isTeamHandoff(pill("Designer was cut off by a restart; resuming"), designergrafico, bots)).toBe(true);
  });

  it("is not what needs the person, a failure, another team or the bot's own thread", () => {
    expect(isTeamHandoff(pill("Designer needs your input: qual fonte?"), designergrafico, bots)).toBe(false);
    expect(isTeamHandoff(pill("Designer needs your input: o cliente já replied"), designergrafico, bots)).toBe(false);
    expect(isTeamHandoff(pill("Designer — failed: the client replied"), designergrafico, bots)).toBe(false);
    expect(isTeamHandoff(pill("Designer — failed: no access"), designergrafico, bots)).toBe(false);
    expect(isTeamHandoff(pill("Result withheld: secret"), designergrafico, bots)).toBe(false);
    expect(isTeamHandoff(pill("Sent to AssistenteFinanceiro", "assistentefinanceiro"), designergrafico, bots)).toBe(false);
    expect(isTeamHandoff(pill("Opened thread Lumon", "designergrafico"), designergrafico, bots)).toBe(false);
    expect(isTeamHandoff({ kind: "activity", tool: { name: "Sent to Designer", ok: true } }, designergrafico, bots)).toBe(false);
  });

  it("is never a pill between bots without a team", () => {
    const lumon: TeamBot = { id: "lumon", name: "LUMON", threadId: "lumon-main" };
    const evergreen: TeamBot = { id: "evergreen", name: "EVERGREEN", section: "", threadId: "evergreen-main" };
    expect(isTeamHandoff(pill("Sent to EVERGREEN", "evergreen"), lumon, [lumon, evergreen])).toBe(false);
    expect(isTeamHandoff(pill("EVERGREEN replied", "evergreen"), lumon, [lumon, evergreen])).toBe(false);
  });
});

describe("where a teammate works", () => {
  const designergrafico: TeamBot = { id: "designergrafico", name: "DESIGNERGRAFICO", section: "QG", threadId: "designergrafico-main",
    tasks: [{ threadId: "designergrafico-evergreen", title: "Evergreen Capital · Carrossel Dólar ·" }] };

  it("is the task the person named, without a trailing separator", () => {
    expect(taskPlace({ threadId: "t", title: "Evergreen Capital · Carrossel Dólar ·" })).toBe("Evergreen Capital · Carrossel Dólar");
  });

  it("is the leader's task a delegated conversation came from, never the label the server gave it", () => {
    const delegated = { threadId: "d", title: "@DESIGNERGRAFICO · work", openedBy: { botId: "designergrafico", threadId: "designergrafico-evergreen", kind: "work" } };
    expect(taskPlace(delegated, [designergrafico])).toBe("Evergreen Capital · Carrossel Dólar");
    expect(taskPlace(delegated)).toBeUndefined();
  });

  it("is nothing for an untitled conversation", () => {
    for (const title of ["Nova conversa", "New task", "New thread", "@DESIGNERGRAFICO · work"]) expect(taskPlace({ threadId: "t", title })).toBeUndefined();
  });
});
