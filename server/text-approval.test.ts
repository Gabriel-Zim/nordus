import { describe, expect, it } from "vitest";
import { askByText, askNextOpen, askText, MIN_SEEN_MS, personConversation, textAnswer, textAskable, type TextAskStore } from "./text-approval.ts";
import type { Message } from "./store.ts";
import type { OptionCardData } from "../shared/wire.ts";

const ADMIN = { name: "Avery", id: "g", admin: true as const };
const GERENTEDEOPERACAO = { botId: "gerentedeoperacao", name: "GerenteDeOperacao", color: "blue" };

function fixture() {
  const threads = new Map<string, Message[]>([["main", []], ["task", []], ["peer", []], ["room", []], ["run", []]]);
  let clock = 1_000;
  let next = 0;
  const tasks: Record<string, { threadId: string; openedBy?: { botId: string; name: string; at: number; threadId: string }; routineRunId?: string }> = {
    main: { threadId: "main" },
    task: { threadId: "task", openedBy: { botId: "gerentedeoperacao", name: "GerenteDeOperacao", at: 1, threadId: "main" } },
    peer: { threadId: "peer", openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", at: 1, threadId: "designergrafico-main" } },
    run: { threadId: "run", routineRunId: "r1" },
  };
  const store = {
    botByThread: (threadId: string) => (threadId === "room" ? null : { id: "gerentedeoperacao", name: "GerenteDeOperacao" }),
    taskByThread: (_botId: string, threadId: string) => tasks[threadId],
    groupByThread: (threadId: string) => (threadId === "room" ? { id: "room" } : undefined),
    activePath: (threadId: string) => threads.get(threadId) ?? [],
    messagesFor: (threadId: string) => threads.get(threadId) ?? [],
    appendMessage: (threadId: string, message: Omit<Message, "id" | "at">) => {
      const row = { ...message, id: `m${++next}`, at: clock } as Message;
      threads.get(threadId)!.push(row);
      return row;
    },
    patchMessage: (threadId: string, messageId: string, patch: Partial<Message>) => {
      const row = threads.get(threadId)!.find((message) => message.id === messageId);
      if (row) Object.assign(row, patch);
      return row ?? null;
    },
  } as unknown as TextAskStore;
  const card = (threadId: string, data: Partial<OptionCardData> = {}) => store.appendMessage(threadId, {
    role: "bot", kind: "options",
    card: { title: "Approval needed", subtitle: "rm build", options: ["Allow", "Deny"], requestId: `r${next + 1}`, tool: "Bash", intent: "apagar a pasta build", ...data },
  });
  const later = (ms = MIN_SEEN_MS) => { clock += ms; };
  return { store, threads, card, later, now: () => clock };
}

describe("a yes-or-no card asked in words", () => {
  it("asks in the person's conversation, hides the card and takes an admin's typed yes", () => {
    const { store, threads, card, later, now } = fixture();
    const message = card("main");
    const line = askByText(store, "main", message, GERENTEDEOPERACAO);
    expect(line?.text).toBe("Quero apagar a pasta build. Posso seguir?");
    expect(line?.from).toEqual(GERENTEDEOPERACAO);
    expect(threads.get("main")![0]!.card!.byText).toBe(true);
    later();
    expect(textAnswer(store, "main", { text: "sim", sender: ADMIN }, now())).toEqual({ requestId: message.card!.requestId, reply: "yes" });
    expect(textAnswer(store, "main", { text: "não, espera", sender: ADMIN }, now())?.reply).toBe("no");
    expect(textAnswer(store, "main", { text: "pode, mas troca o nome", sender: ADMIN }, now())?.reply).toBe("unclear");
  });

  it("never takes a bot's words, a member's line, a relayed or queued line, or a line typed as the question appeared", () => {
    const { store, card, later, now } = fixture();
    askByText(store, "main", card("main"), GERENTEDEOPERACAO);
    expect(textAnswer(store, "main", { text: "sim", sender: ADMIN }, now())).toBeUndefined();
    later();
    expect(textAnswer(store, "main", { text: "sim", sender: ADMIN, peerAsk: { botId: "designergrafico", name: "DESIGNERGRAFICO" } }, now())).toBeUndefined();
    expect(textAnswer(store, "main", { text: "sim", sender: { name: "Ana", id: "a" } }, now())).toBeUndefined();
    expect(textAnswer(store, "main", { text: "sim", sender: ADMIN, relayed: true }, now())).toBeUndefined();
    expect(textAnswer(store, "main", { text: "sim", sender: ADMIN, queued: true }, now())).toBeUndefined();
    expect(textAnswer(store, "main", { text: "sim" }, now())).toBeUndefined();
  });

  it("answers nothing once the bot asked something else, or the card was settled", () => {
    const { store, threads, card, later, now } = fixture();
    const message = card("main");
    askByText(store, "main", message, GERENTEDEOPERACAO);
    later();
    store.appendMessage("main", { role: "bot", kind: "text", text: "Antes: qual pasta?" });
    expect(textAnswer(store, "main", { text: "sim", sender: ADMIN }, now())).toBeUndefined();
    threads.get("main")!.pop();
    store.patchMessage("main", message.id, { card: { ...message.card!, answered: "allow" } });
    expect(textAnswer(store, "main", { text: "sim", sender: ADMIN }, now())).toBeUndefined();
  });

  it("asks again for the card still waiting after another one is answered", () => {
    const { store, card, later, now } = fixture();
    const first = card("main");
    askByText(store, "main", first, GERENTEDEOPERACAO);
    const second = card("main", { intent: "publicar o site" });
    askByText(store, "main", second, GERENTEDEOPERACAO);
    later();
    expect(textAnswer(store, "main", { text: "sim", sender: ADMIN }, now())?.requestId).toBe(second.card!.requestId);
    store.patchMessage("main", second.id, { card: { ...second.card!, answered: "allow" } });
    expect(askNextOpen(store, "main", second.card!.requestId!)?.text).toBe("Quero apagar a pasta build. Posso seguir?");
    later();
    expect(textAnswer(store, "main", { text: "pode", sender: ADMIN }, now())?.requestId).toBe(first.card!.requestId);
  });

  it("keeps the card in rooms, routine runs and conversations another bot opened", () => {
    const { store, card, threads } = fixture();
    for (const threadId of ["room", "run", "peer"]) {
      expect(askByText(store, threadId, card(threadId), GERENTEDEOPERACAO)).toBeUndefined();
      expect(threads.get(threadId)!.at(-1)!.card!.byText).toBeUndefined();
    }
    expect(personConversation(store, "main")).toBe(true);
    expect(personConversation(store, "task")).toBe(true);
  });

  it("keeps the card for questions, quota offers and skills, which a yes alone cannot answer", () => {
    const base = { title: "x", subtitle: "", requestId: "r", options: ["Allow", "Deny"] };
    expect(textAskable(base)).toBe(true);
    expect(textAskable({ ...base, options: ["Claude", "Codex", "Agora não"] })).toBe(false);
    expect(textAskable({ ...base, skillRequest: { botId: "b", name: "s", action: "create" } } as OptionCardData)).toBe(false);
    expect(textAskable({ ...base, questionRequest: { version: 1, questions: [] } } as unknown as OptionCardData)).toBe(false);
    expect(textAskable({ ...base, answered: "allow" })).toBe(false);
    expect(textAskable({ ...base, requestId: undefined })).toBe(false);
  });

  it("says what the answer decides, in Portuguese and without a dash", () => {
    const card = { title: "Send on your behalf?", subtitle: "E-mail para ana@x.com — orçamento", options: ["Allow", "Deny"], requestId: "r" };
    expect(askText({ ...card, outboundRequest: { tool: "send", app: "gmail" } })).toBe("Vou enviar em seu nome: E-mail para ana@x.com, orçamento. Posso mandar?");
    expect(askText({ ...card, relayFor: { botId: "s", name: "EDITORDEVIDEO", threadId: "t" }, intent: "publicar o vídeo" })).toBe("EDITORDEVIDEO precisa do seu ok para publicar o vídeo. Libero?");
    expect(askText({ ...card, lessonRequest: { lesson: "Logo sempre sem caixa" } })).toBe('Quer que eu guarde isto como regra: "Logo sempre sem caixa"?');
    expect(askText({ title: "Nova rotina", subtitle: "Todo dia às 9h", options: ["Confirm", "Cancel"], requestId: "r" })).toBe("Nova rotina: Todo dia às 9h. Posso seguir?");
  });
});

describe("a permission card still without its plain title", () => {
  it("names the action and what it acts on", () => {
    expect(askText({ title: "Approval needed", subtitle: "Bash: rm -rf build", options: ["Allow", "Deny"], requestId: "r", tool: "Bash" }, "apagar"))
      .toBe("Preciso do seu ok para apagar: Bash: rm -rf build. Posso seguir?");
  });
});
