import { describe, expect, it } from "vitest";
import type { Bot, Group, Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { botPreview, botRailCard, groupPreview, lastPreviewable, roomRailCard } from "./sidebar-preview";

const bot = { id: "plum", name: "Plum", busy: false, activity: "idle" } as unknown as Bot;
const said = (text: string): Message => ({ id: "m1", at: 1, role: "bot", kind: "text", text }) as Message;
const routine = (status: "failed" | "completed", summary?: string): Message => ({
  id: "m2",
  at: 2,
  role: "bot",
  kind: "routine.run",
  text: `Routine “Relatório” ${status}`,
  routineRun: { runId: "r", routineId: "x", routineName: "Relatório", scheduledFor: 1, status, ...(summary ? { summary } : {}) },
}) as Message;

describe("sidebar preview while waiting on teammates", () => {
  const waiting = { ...bot, waitingForTeammates: true } as unknown as Bot;
  it("says who, and falls back to the generic words", () => {
    expect(botPreview({ ...waiting, waitingOn: [{ botId: "c", name: "EstrategistaDeConteudo", threadId: "t" }] } as Bot, [], [], false)).toBe("Waiting on EstrategistaDeConteudo…");
    expect(botPreview({ ...waiting, waitingOn: [{ botId: "c", name: "EstrategistaDeConteudo", threadId: "t" }, { botId: "n", name: "Pesquisador", threadId: "u" }] } as Bot, [], [], false)).toBe("Waiting on EstrategistaDeConteudo and 1 more…");
    expect(botPreview(waiting, [], [], false)).toBe(t("sidebar.preview.waitingOnTeammate"));
  });
});

describe("sidebar preview for routines", () => {
  it("skips a failed routine card and keeps the conversation's last words", () => {
    expect(botPreview(bot, [said("Pronto, mandei o resumo."), routine("failed")], [], false)).toBe("Pronto, mandei o resumo.");
  });

  it("shows what a finished routine found, not the English status line", () => {
    expect(botPreview(bot, [routine("completed", "Três clientes sem resposta hoje.")], [], false)).toBe("Três clientes sem resposta hoje.");
  });
});

describe("the avatar rail's hover card data", () => {
  const signals = { waiting: false, working: false, unread: false };
  const nodes = (rows: Message[]) => rows;

  it("describes a bot with its last words and an idle state", () => {
    const card = botRailCard(bot, nodes([said("Pronto, mandei o resumo.")]), [], false, signals);
    expect(card).toEqual({ kind: "bot", name: "Plum", preview: "Pronto, mandei o resumo.", state: "idle", unread: false });
  });

  it("keeps a waiting bot's last words and puts the wait in the state", () => {
    const waiting = { ...bot, activity: "waiting-on-you" } as unknown as Bot;
    const card = botRailCard(waiting, nodes([said("Posso apagar a pasta?")]), [], false, { ...signals, waiting: true, unread: true });
    expect(card.state).toBe("waiting");
    expect(card.unread).toBe(true);
    expect(card.preview).toBe("Posso apagar a pasta?");
  });

  it("keeps a working bot's last words and puts the work in the state", () => {
    const busy = { ...bot, busy: true } as unknown as Bot;
    const card = botRailCard(busy, nodes([said("Começando.")]), [], false, { ...signals, working: true });
    expect(card.state).toBe("working");
    expect(card.preview).toBe("Começando.");
  });

  it("carries the step a working bot is on into its card", () => {
    const busy = { ...bot, busy: true } as unknown as Bot;
    const card = botRailCard(busy, nodes([said("Começando.")]), [], false, { ...signals, working: true, step: "Revisando a lâmina 2" });
    expect(card).toMatchObject({ state: "working", step: "Revisando a lâmina 2", preview: "Começando." });
  });

  it("leaves the card without a step when none is known", () => {
    expect(botRailCard(bot, [], [], false, { ...signals, working: true, step: null })).not.toHaveProperty("step");
  });

  it("lets waiting win when a bot both works and waits", () => {
    expect(botRailCard(bot, [], [], false, { ...signals, waiting: true, working: true }).state).toBe("waiting");
  });

  it("describes a room by its name and the last speaker", () => {
    const plum = { ...bot, id: "plum", name: "Plum" } as unknown as Bot;
    const room = { id: "g", name: "Equipe", memberIds: ["plum"], messages: [{ id: "m", at: 1, role: "bot", kind: "text", text: "Fechado.", from: { botId: "plum", name: "Plum" } }] } as unknown as Group;
    const card = roomRailCard(room, [plum], [], false, { ...signals, unread: true });
    expect(card).toEqual({ kind: "room", name: "Equipe", preview: "Plum: Fechado.", state: "idle", unread: true });
  });

  it("shows a working room's last message instead of the team status line", () => {
    const room = { id: "g", name: "Equipe", memberIds: [], working: true, busyBotId: "plum", messages: [{ id: "m", at: 1, role: "user", kind: "text", text: "Oi" }] } as unknown as Group;
    const card = roomRailCard(room, [], [], false, { ...signals, working: true });
    expect(card.state).toBe("working");
    expect(card.preview).toBe(t("sidebar.preview.you", { text: "Oi" }));
  });
});

// Upstream: screen frames never stand in for the conversation.
describe("screen frames in previews", () => {
  let at = 0;
  const message = (fields: Partial<Message>): Message => ({ id: `m${++at}`, at, role: "bot", kind: "text", ...fields }) as Message;
  const screen = () => message({ kind: "screen", png: "frame", mime: "image/jpeg" });
  const ada = { id: "ada", name: "Ada", messages: [], busy: false } as unknown as Bot;
  it("shows a bot's reply, not the screen frame its computer turn ended with", () => {
    const visible = [message({ role: "user", text: "Paint a sunset" }), message({ text: "I painted a sunset in JS Paint." }), screen()];
    expect(botPreview(ada, visible, [], false)).toBe("I painted a sunset in JS Paint.");
    expect(botPreview(ada, [...visible, message({ kind: "digest", text: "[digest]" }), screen()], [], false)).toBe("I painted a sunset in JS Paint.");
  });

  it("shows nothing for a conversation that holds only screen frames", () => {
    expect(botPreview(ada, [screen(), screen()], [], false)).toBe("");
    expect(lastPreviewable([screen(), message({ kind: "compaction" })])).toBeUndefined();
  });

  it("skips screen frames in a group chat's preview too", () => {
    const group = { id: "g", name: "Room", messages: [message({ text: "Done.", from: { botId: "ada", name: "Ada", color: "green" } }), screen()] } as unknown as Group;
    expect(groupPreview(group, [ada], [], false)).toBe("Ada: Done.");
  });
});

describe("sidebar preview for a missing model", () => {
  it("names the problem in the person's language instead of the provider's sentence", () => {
    const provider = "There's an issue with the selected model (claude-sonnet-5). It may not exist or you may not have access to it. Run --model to pick a different model.";
    expect(botPreview(bot, [said(provider)], [], false)).toBe(t("error.plain.modelUnavailableShort"));
  });

  it("leaves a normal message that quotes the sentence alone", () => {
    const quoted = "O erro dizia: There's an issue with the selected model (claude-sonnet-5).";
    expect(botPreview(bot, [said(quoted)], [], false)).toBe(quoted);
  });
});
