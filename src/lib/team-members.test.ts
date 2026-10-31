import { describe, expect, it } from "vitest";
import type { Bot } from "@/state/store";
import { teamLeadFor } from "../../shared/team-lead";
import { appUnreadCount, botForShortcut, botWait, ledMemberIds, listedBots, memberNeedingPerson, membersOf } from "./team-members";

const policy = { allow: [], ask: [] };
const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", color: "green",
  notifications: true, unread: false, messages: [], modelSelection: { instanceId: "test", model: "m" }, ...extra,
});

const designergrafico = bot("designergrafico", { section: "QG DE DESIGN", teamLead: policy });
const revisor = bot("revisor", { section: "QG DE DESIGN" });
const designer = bot("designer", { section: "QG DE DESIGN" });
const solo = bot("solo");
const outro = bot("outro", { section: "Financeiro" });

describe("the members a team leader answers for", () => {
  it("hides the members of a team with one leader, and keeps the leader and bots outside it", () => {
    const bots = [designergrafico, revisor, designer, solo, outro];
    expect([...ledMemberIds(bots)].sort()).toEqual(["designer", "revisor"]);
    expect(listedBots(bots).map((entry) => entry.id)).toEqual(["designergrafico", "solo", "outro"]);
  });

  it("lists a leader's members in list order, and none for a bot that leads nobody", () => {
    const bots = [designer, designergrafico, solo, revisor];
    expect(membersOf(bots, designergrafico).map((entry) => entry.id)).toEqual(["designer", "revisor"]);
    expect(membersOf(bots, solo)).toEqual([]);
    expect(membersOf(bots, revisor)).toEqual([]);
  });

  it("hides nobody on a team with two leaders", () => {
    const second = bot("segunda", { section: "QG DE DESIGN", teamLead: policy });
    const bots = [designergrafico, second, revisor];
    expect(ledMemberIds(bots).size).toBe(0);
    expect(listedBots(bots)).toHaveLength(3);
    expect(membersOf(bots, designergrafico)).toEqual([]);
  });

  it("follows teamLeadFor on trimmed sections, an empty section, two leaders and an archived leader", () => {
    const bots = [
      bot("a", { section: " QG ", teamLead: policy }), bot("b", { section: "QG" }), bot("c", { section: "QG  " }),
      bot("d", { section: "  ", teamLead: policy }), bot("e", { section: "" }), bot("f"),
      bot("g", { section: "Dupla", teamLead: policy }), bot("h", { section: "Dupla", teamLead: policy }), bot("i", { section: "Dupla" }),
      bot("j", { section: "Arquivo", teamLead: policy, hidden: true }), bot("k", { section: "Arquivo" }),
      bot("l", { section: "Viva", teamLead: policy }), bot("m", { section: "Viva", teamLead: policy, hidden: true }), bot("n", { section: "Viva" }),
    ];
    const expected = bots.filter((entry) => !entry.hidden && teamLeadFor(bots, entry)).map((entry) => entry.id);
    expect(expected).toEqual(["b", "c", "n"]);
    expect([...ledMemberIds(bots)].sort()).toEqual(expected);
    expect(membersOf(bots, bots[0]!).map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(membersOf(bots, bots[11]!).map((entry) => entry.id)).toEqual(["n"]);
  });

  it("hides a pinned member and a Chief too, and lists them under the leader", () => {
    const pinned = bot("fixo", { section: "QG DE DESIGN", pinned: true });
    const chief = bot("chefe", { section: "QG DE DESIGN", chiefOfStaff: true });
    const bots = [designergrafico, pinned, chief, revisor];
    expect(listedBots(bots).map((entry) => entry.id)).toEqual(["designergrafico"]);
    expect(membersOf(bots, designergrafico).map((entry) => entry.id)).toEqual(["fixo", "chefe", "revisor"]);
  });

  it("keeps a member out of the list while it waits for the person, and hands the wait to its leader", () => {
    const waitingTask = { threadId: "revisor-thread", title: "Conversa", createdAt: 1, activity: "waiting-on-you" as const };
    for (const needing of [
      bot("revisor", { section: "QG DE DESIGN", activity: "waiting-on-you" }),
      bot("revisor", { section: "QG DE DESIGN", tasks: [waitingTask] }),
    ]) {
      expect(listedBots([designergrafico, needing, designer]).map((entry) => entry.id)).toEqual(["designergrafico"]);
      expect(memberNeedingPerson([designergrafico, needing, designer], designergrafico)?.member.id).toBe("revisor");
    }
    const resolved = bot("revisor", { section: "QG DE DESIGN", activity: "working", tasks: [{ ...waitingTask, activity: "working" }] });
    expect(memberNeedingPerson([designergrafico, resolved, designer], designergrafico)).toBeUndefined();
  });

  it("points the leader at the conversation where the member waits, and never at one only unread", () => {
    const unreadOnly = bot("designer", { section: "QG DE DESIGN", tasks: [{ threadId: "designer-extra", title: "Nova", createdAt: 1, unread: true }] });
    const waiting = bot("revisor", { section: "QG DE DESIGN", tasks: [
      { threadId: "revisor-thread", title: "Conversa", createdAt: 1 },
      { threadId: "revisor-pergunta", title: "Pergunta", createdAt: 2, activity: "waiting-on-you" },
    ] });
    expect(memberNeedingPerson([designergrafico, unreadOnly, waiting], designergrafico)).toEqual({ member: waiting, threadId: "revisor-pergunta" });
    expect(memberNeedingPerson([designergrafico, unreadOnly], designergrafico)).toBeUndefined();
    expect(memberNeedingPerson([designergrafico, waiting], designergrafico, "revisor")).toBeUndefined();
    expect(memberNeedingPerson([designergrafico, waiting, solo], solo)).toBeUndefined();
  });

  it("lets the leader's own wait come first, but not a routine run of the leader", () => {
    const waiting = bot("revisor", { section: "QG DE DESIGN", activity: "waiting-on-you", tasks: [{ threadId: "revisor-thread", title: "Conversa", createdAt: 1, activity: "waiting-on-you" }] });
    const leaderWaits = { ...designergrafico, activity: "waiting-on-you" as const, tasks: [{ threadId: "designergrafico-thread", title: "Conversa", createdAt: 1, activity: "waiting-on-you" as const }] };
    const leaderRoutine = { ...designergrafico, activity: "waiting-on-you" as const, tasks: [{ threadId: "designergrafico-run", title: "Rotina", createdAt: 1, activity: "waiting-on-you" as const, routineRunId: "run" }] };
    expect(memberNeedingPerson([leaderWaits, waiting], leaderWaits)).toBeUndefined();
    expect(memberNeedingPerson([leaderRoutine, waiting], leaderRoutine)?.member.id).toBe("revisor");
  });

  it("keeps the open member in the list, and hides it again once another bot is open", () => {
    expect(listedBots([designergrafico, revisor, designer], "revisor").map((entry) => entry.id)).toEqual(["designergrafico", "revisor"]);
    expect(listedBots([designergrafico, revisor, designer], "designergrafico").map((entry) => entry.id)).toEqual(["designergrafico"]);
  });

  it("gives its leader nothing for a member's routine run that waits", () => {
    const routineWait = { threadId: "run-thread", title: "Rotina", createdAt: 1, activity: "waiting-on-you" as const, routineRunId: "run" };
    const member = bot("revisor", { section: "QG DE DESIGN", activity: "waiting-on-you", tasks: [routineWait] });
    expect(listedBots([designergrafico, member]).map((entry) => entry.id)).toEqual(["designergrafico"]);
    expect(memberNeedingPerson([designergrafico, member], designergrafico)).toBeUndefined();
  });

  it("hands its leader a member that waits outside any conversation", () => {
    const member = bot("revisor", { section: "QG DE DESIGN", activity: "waiting-on-you", tasks: [{ threadId: "revisor-thread", title: "Conversa", createdAt: 1 }] });
    expect(listedBots([designergrafico, member]).map((entry) => entry.id)).toEqual(["designergrafico"]);
    expect(memberNeedingPerson([designergrafico, member], designergrafico)).toEqual({ member, threadId: "revisor-thread" });
  });

  it("ignores an archived leader and an archived member", () => {
    expect(listedBots([{ ...designergrafico, hidden: true }, revisor]).map((entry) => entry.id)).toEqual(["revisor"]);
    expect(membersOf([designergrafico, { ...revisor, hidden: true }], designergrafico)).toEqual([]);
  });
});

describe("what a leader's row shows while its team works", () => {
  const working = (id: string, doing: string, extra: Partial<Bot> = {}) => bot(id, { name: id === "designer" ? "Designer" : id, section: "QG DE DESIGN", busy: true,
    tasks: [{ threadId: `${id}-carrossel`, title: "Carrossel", createdAt: 1, busy: true, activity: "working", doing }], ...extra });

  it("is the working member and its step when the leader is idle", () => {
    expect(botWait([designergrafico, working("designer", "Analisando o briefing do carrossel")], designergrafico).teamWork).toBe("Designer: analisando o briefing do carrossel");
  });

  it("is there even while the leader works itself, so each surface picks the leader's own work first", () => {
    const busyLeader = { ...designergrafico, busy: true };
    expect(botWait([busyLeader, working("designer", "Analisando")], busyLeader).teamWork).toBe("Designer: analisando");
  });

  it("is nothing for a bot that leads nobody", () => {
    expect(botWait([designergrafico, working("designer", "Analisando"), solo], solo).teamWork).toBeUndefined();
  });

  it("never reads a member that waits for the person as working, even with its wait still busy", () => {
    const waitingBusy = working("designer", "Analisando", { tasks: [{ threadId: "designer-pergunta", title: "Pergunta", createdAt: 1, busy: true, activity: "waiting-on-you", doing: "Analisando" }] });
    expect(botWait([designergrafico, waitingBusy], designergrafico, "designer").teamWork).toBeUndefined();
  });

  it("says where the member works for the hover, and shows the most recent of several with how many more", () => {
    const designer = working("designer", "Analisando o briefing do carrossel");
    designer.tasks = [{ ...designer.tasks![0]!, title: "Evergreen Capital · Carrossel Dólar e Patrimônio ·", turnStartedAt: 1_000 }];
    const revisor = bot("revisor", { name: "Revisor", section: "QG DE DESIGN", busy: true,
      tasks: [{ threadId: "revisor-lamina", title: "Lumon · Reels", createdAt: 1, busy: true, activity: "working", doing: "Revisando a lâmina 2", turnStartedAt: 2_000 }] });
    expect(botWait([designergrafico, designer], designergrafico)).toMatchObject({
      teamWork: "Designer: analisando o briefing do carrossel",
      teamWorkWhere: "Designer · Evergreen Capital · Carrossel Dólar e Patrimônio: analisando o briefing do carrossel",
    });
    expect(botWait([designergrafico, designer, revisor], designergrafico)).toMatchObject({ teamWork: "Revisor: revisando a lâmina 2", teamWorkWhere: "Revisor · Lumon · Reels: revisando a lâmina 2", teamWorkOthers: 1 });
  });

  it("says where by the leader's task a delegated member works on, never by the server's label", () => {
    const leader = { ...designergrafico, tasks: [{ threadId: "designergrafico-evergreen", title: "EVERGREEN · Carrossel Dólar", createdAt: 1 }] };
    const designer = working("designer", "Analisando o briefing");
    designer.tasks = [{ ...designer.tasks![0]!, title: "@DESIGNERGRAFICO · work", openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", threadId: "designergrafico-evergreen", at: 1, kind: "work" } }];
    expect(botWait([leader, designer], leader).teamWorkWhere).toBe("Designer · EVERGREEN · Carrossel Dólar: analisando o briefing");
  });

  it("works for any team leader, by who leads, not by name", () => {
    const mark = bot("mark", { name: "MARK", section: "Pesquisa", teamLead: { allow: [], ask: [] } });
    const analista = bot("analista", { name: "Analista", section: "Pesquisa", busy: true,
      tasks: [{ threadId: "analista-t", title: "Mercado", createdAt: 1, busy: true, activity: "working", doing: "Lendo os relatórios" }] });
    expect(botWait([designergrafico, mark, analista], mark).teamWork).toBe("Analista: lendo os relatórios");
    expect(botWait([designergrafico, mark, analista], designergrafico).teamWork).toBeUndefined();
  });

  it("gives way to a member that waits for the person", () => {
    const waiting = bot("revisor", { section: "QG DE DESIGN", tasks: [{ threadId: "revisor-pergunta", title: "Pergunta", createdAt: 1, activity: "waiting-on-you" }] });
    const result = botWait([designergrafico, working("designer", "Analisando"), waiting], designergrafico);
    expect(result.waiting).toBe(true);
    expect(result.teamWork).toBeUndefined();
  });
});

describe("what a row waits on", () => {
  it("is the leader's own side conversation when it waits there, even with the leader's activity idle", () => {
    const leader = { ...designergrafico, activity: "idle" as const, tasks: [
      { threadId: "designergrafico-thread", title: "Conversa", createdAt: 1 },
      { threadId: "designergrafico-pedido", title: "Pedido", createdAt: 2, activity: "waiting-on-you" as const },
    ] };
    expect(botWait([leader, revisor], leader)).toEqual({ waiting: true, waitingBot: leader, waitingThreadId: "designergrafico-pedido" });
  });

  it("is the member's conversation when only the member waits, and nothing for a calm bot", () => {
    const member = bot("revisor", { section: "QG DE DESIGN", tasks: [{ threadId: "revisor-pergunta", title: "Pergunta", createdAt: 1, activity: "waiting-on-you" }] });
    expect(botWait([designergrafico, member], designergrafico)).toEqual({ waiting: true, waitingBot: member, waitingThreadId: "revisor-pergunta" });
    expect(botWait([designergrafico, member, solo], solo)).toEqual({ waiting: false, waitingBot: solo, waitingThreadId: undefined });
  });
});

describe("the bot keyboard shortcuts", () => {
  const bots = [designergrafico, revisor, solo, outro];

  it("numbers only the person's list, whatever conversation is open", () => {
    expect(botForShortcut(bots, "revisor", "2")?.id).toBe("solo");
    expect(botForShortcut(bots, "designergrafico", "2")?.id).toBe("solo");
  });

  it("steps to the next and previous bot from an open member", () => {
    expect(botForShortcut(bots, "revisor", "]")?.id).toBe("solo");
    expect(botForShortcut(bots, "revisor", "[")?.id).toBe("designergrafico");
  });
});

describe("the app badge", () => {
  it("counts what the person can reach: the leader, a bot without a team, rooms and a member that waits, never a member only unread", () => {
    const waiting = { ...revisor, unread: true, tasks: [{ threadId: "revisor-thread", title: "Conversa", createdAt: 1, unread: true, activity: "waiting-on-you" as const }] };
    const unreadOnly = { ...designer, unread: true, tasks: [{ threadId: "designer-thread", title: "Conversa", createdAt: 1, unread: true }] };
    const bots = [{ ...designergrafico, unread: true }, waiting, unreadOnly, { ...solo, unread: true }, { ...outro, unread: false }];
    expect(appUnreadCount(bots, [{ unread: true }, { unread: false }])).toBe(4);
  });
});
