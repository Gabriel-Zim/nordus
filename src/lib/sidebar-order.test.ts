import { describe, expect, it } from "vitest";
import type { AttentionThread } from "@/components/SidebarBotActivity";
import type { Bot, Group, Message, Task } from "@/state/store";
import { auxiliaryConversation, sidebarFlatItems } from "./sidebar-order";

const main = (id: string, orderAt: number, extra: Partial<Task> = {}): Task =>
  ({ threadId: `${id}-thread`, title: "Conversa", createdAt: 1, updatedAt: orderAt, lastThreadOrderAt: orderAt, ...extra }) as Task;
const bot = (id: string, orderAt: number, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", color: "green", notifications: true, unread: false,
  messages: [], modelSelection: { instanceId: "test", model: "m" }, tasks: [main(id, orderAt)], ...extra,
}) as Bot;
const order = (bots: Bot[], groups: Group[] = [], needsYou: AttentionThread[] = []) =>
  sidebarFlatItems(bots, groups, needsYou).map((item) => item.kind === "bot" ? item.bot.id : item.group.id);

describe("sidebar list order", () => {
  it("keeps a bot in place while it only works: steps, routines, requests from colleagues", () => {
    const designergrafico = bot("designergrafico", 2_000);
    const fabrikam = bot("fabrikam", 1_000);
    const busy: Bot = {
      ...fabrikam,
      activity: "working",
      messages: [{ id: "step", role: "bot", kind: "activity", text: "Escrevendo o briefing", at: 9_000 } as Message],
      tasks: [
        main("fabrikam", 1_000, { updatedAt: 9_000, activity: "working" }),
        { threadId: "rotina", title: "Rotina", createdAt: 8_000, updatedAt: 8_500, lastThreadOrderAt: 8_500, routineRunId: "run-1" } as Task,
        { threadId: "colega", title: "Pedido da DesignerGrafico", createdAt: 7_000, updatedAt: 7_500, lastThreadOrderAt: 7_500,
          openedBy: { botId: "gerentedeoperacao", name: "GerenteDeOperacao", kind: "work", at: 1 } } as Task,
        { threadId: "velha", title: "Arquivada", createdAt: 6_000, updatedAt: 6_500, lastThreadOrderAt: 6_500, archivedAt: 6_600 } as Task,
        { threadId: "gatilho", title: "E-mail novo · Oct 17, 12:15 AM", createdAt: 9_500, lastThreadOrderAt: 9_600 } as Task,
        { threadId: "updates", title: "Updates", createdAt: 9_700 } as Task,
      ],
    };
    expect(order([designergrafico, fabrikam])).toEqual(["designergrafico", "fabrikam"]);
    expect(order([designergrafico, busy])).toEqual(["designergrafico", "fabrikam"]);
  });

  it("moves a bot up when a new message lands in a conversation the person reads", () => {
    const designergrafico = bot("designergrafico", 2_000);
    const fabrikam = bot("fabrikam", 1_000, { tasks: [main("fabrikam", 1_000), main("cliente", 3_000, { threadId: "cliente" })] });
    expect(order([designergrafico, fabrikam])).toEqual(["fabrikam", "designergrafico"]);
  });

  it("moves a bot up when a run lights its unread dot", () => {
    const designergrafico = bot("designergrafico", 2_000);
    const fabrikam = bot("fabrikam", 1_000, { tasks: [
      main("fabrikam", 1_000, { attentionAt: 3_000 }),
      { threadId: "rotina", title: "Rotina", createdAt: 500, lastThreadOrderAt: 9_000, routineRunId: "run-1" } as Task,
    ] });
    expect(order([designergrafico, fabrikam])).toEqual(["fabrikam", "designergrafico"]);
  });

  it("moves a bot up while it waits on the person, even from a colleague's request", () => {
    const designergrafico = bot("designergrafico", 2_000);
    const waitingOnYou = bot("fabrikam", 1_000, { activity: "waiting-on-you" });
    expect(order([designergrafico, waitingOnYou])).toEqual(["fabrikam", "designergrafico"]);
    const asked = { kind: "bot", botId: "assistentefinanceiro", task: { activity: "waiting-on-you" } } as unknown as AttentionThread;
    expect(order([designergrafico, bot("assistentefinanceiro", 500)], [], [asked])).toEqual(["assistentefinanceiro", "designergrafico"]);
  });

  it("keeps a bot near the top after the person answers its request, even in a colleague's conversation", () => {
    const answered = bot("designergrafico", 1_000, {
      activity: "working",
      tasks: [
        main("designergrafico", 1_000),
        { threadId: "pedido-do-gerentedeoperacao", title: "Capa", createdAt: 2_000, lastThreadOrderAt: 8_000, attentionAt: 4_000,
          openedBy: { botId: "gerentedeoperacao", name: "GerenteDeOperacao", kind: "work", at: 1 } } as Task,
      ],
    });
    expect(order([bot("fabrikam", 3_000), answered, bot("assistentefinanceiro", 5_000)])).toEqual(["assistentefinanceiro", "designergrafico", "fabrikam"]);
  });

  it("orders rooms by the same stamp", () => {
    const room = { id: "sala", threadId: "sala-thread", name: "Sala", memberIds: [], unread: false, messages: [],
      tasks: [
        { threadId: "sala-thread", title: "Sala", createdAt: 1, updatedAt: 9_000, lastThreadOrderAt: 1_500 },
        { threadId: "meta", title: "Meta da semana · Oct 17, 9:00 AM", createdAt: 8_000, lastThreadOrderAt: 8_500 },
      ] } as unknown as Group;
    expect(order([bot("designergrafico", 2_000), bot("fabrikam", 1_000)], [room])).toEqual(["designergrafico", "sala", "fabrikam"]);
  });
});

describe("auxiliary conversations", () => {
  it("are a run's own conversation and an automation's results chat, never a person's named one", () => {
    expect(auxiliaryConversation("Resumo · Oct 17, 12:15 AM")).toBe(true);
    expect(auxiliaryConversation("Resumo · Resultados")).toBe(true);
    expect(auxiliaryConversation("Resumo · Results")).toBe(true);
    expect(auxiliaryConversation("Vigia")).toBe(false);
    expect(auxiliaryConversation("Resultados do mês")).toBe(false);
  });

  it("never move the bot up the list with their lines", () => {
    const quiet = bot("quiet", 10);
    const results = bot("results", 5, { tasks: [main("results", 5), { ...main("results", 50), threadId: "r", title: "Resumo · Resultados" }] });
    expect(order([quiet, results])).toEqual(["quiet", "results"]);
  });
});
