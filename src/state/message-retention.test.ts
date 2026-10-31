import { describe, expect, it } from "vitest";

import { OFFSCREEN_HARD_CAP, OFFSCREEN_TAIL, retainOffscreenMessages } from "./message-retention";
import { initialState, retainingReducer, type AppState, type Bot, type Message } from "./store";

const REPLY = "Feito. ".repeat(60);

function bot(index: number, messages: Message[] = []): Bot {
  return {
    id: `bot-${index}`, threadId: `thread-${index}`, name: `Robô ${index}`, title: "", description: "",
    notifications: true, color: "green", unread: false, busy: false, activity: "idle",
    modelSelection: { instanceId: "default", model: "default-model" }, approvalMode: "ask", alwaysAllow: [],
    messages, activeLeafId: messages.at(-1)?.id ?? null,
  };
}

function turn(botIndex: number, turnIndex: number): Message[] {
  const at = turnIndex * 10;
  return [
    { id: `b${botIndex}-u${turnIndex}`, role: "user", kind: "text", text: `Pedido ${turnIndex}`, at },
    { id: `b${botIndex}-t${turnIndex}`, role: "bot", kind: "activity", text: "Lendo arquivos", at: at + 1, tool: { name: "Read", ok: true } },
    {
      id: `b${botIndex}-c${turnIndex}`, role: "bot", kind: "options", at: at + 2,
      card: { title: "Posso continuar?", subtitle: "", options: ["Sim", "Não"], answered: "Sim", answeredAt: at + 3 },
    },
    { id: `b${botIndex}-r${turnIndex}`, role: "bot", kind: "text", text: REPLY, at: at + 4 },
  ];
}

const add = (state: AppState, threadId: string, message: Message) => retainingReducer(state, { type: "messageAdded", threadId, message });

/** Every message arrives the way the live feed delivers it: one messageAdded at a time. */
function workDay(bots: number, turns: number): AppState {
  let state: AppState = { ...initialState, bots: Array.from({ length: bots }, (_, index) => bot(index)), selectedId: "bot-0" };
  for (let turnIndex = 0; turnIndex < turns; turnIndex += 1) {
    for (let botIndex = 0; botIndex < bots; botIndex += 1) {
      for (const message of turn(botIndex, turnIndex)) {
        state = add(state, `thread-${botIndex}`, message);
      }
    }
  }
  return state;
}

describe("conversations off screen", () => {
  it("stay under 1 MiB with 30 bots working 40 turns each, while the open one keeps everything", () => {
    const state = workDay(30, 40);
    const bytes = new TextEncoder().encode(JSON.stringify(state.bots)).byteLength;
    expect(bytes).toBeLessThan(1024 * 1024);
    expect(state.bots[0]!.messages).toHaveLength(160);
    expect(state.bots[1]!.messages).toHaveLength(OFFSCREEN_TAIL);
    expect(state.bots[1]!.messages.at(-1)!.id).toBe("b1-r39");
    expect(state.bots[1]!.hasMore).toBe(true);
  });

  it("never cut a question the person has not answered, even past the hard cap", () => {
    const ask: Message = { id: "ask", role: "bot", kind: "options", at: 1, card: { title: "Posso enviar?", subtitle: "", options: ["Sim", "Não"] } };
    let state: AppState = { ...initialState, bots: [bot(0), bot(1, [ask])], selectedId: "bot-0" };
    for (let turnIndex = 1; turnIndex <= 80; turnIndex += 1) {
      for (const message of turn(1, turnIndex)) state = add(state, "thread-1", message);
    }
    expect(state.bots[1]!.messages[0]!.id).toBe("ask");
    expect(state.bots[1]!.messages).toHaveLength(321);
  });

  it("hold an approval chip only within the hard cap, and let an expired card go", () => {
    const chip: Message = { id: "chip", role: "bot", kind: "activity", text: "Esperando Ana decidir", at: 1, tool: { name: "send_email", awaitingApproval: true } };
    const expired: Message = { id: "old-ask", role: "bot", kind: "options", at: 2, card: { title: "Posso?", subtitle: "", options: ["Sim"], expired: true } };
    let state: AppState = { ...initialState, bots: [bot(0), bot(1, [chip, expired])], selectedId: "bot-0" };
    for (let step = 0; step < 1000; step += 1) {
      state = add(state, "thread-1", { id: `m-${step}`, role: "bot", kind: "text", text: "ok", at: 3 + step });
    }
    expect(state.bots[1]!.messages.length).toBeLessThanOrEqual(OFFSCREEN_HARD_CAP);
    expect(state.bots[1]!.messages.some((message) => message.id === "chip" || message.id === "old-ask")).toBe(false);
  });

  it("let an answered card go like any other message", () => {
    const answered: Message = { id: "ask", role: "bot", kind: "options", at: 1, card: { title: "Posso enviar?", subtitle: "", options: ["Sim"], answered: "Sim" } };
    let state: AppState = { ...initialState, bots: [bot(0), bot(1, [answered])], selectedId: "bot-0" };
    for (let turnIndex = 1; turnIndex <= 20; turnIndex += 1) {
      for (const message of turn(1, turnIndex)) state = add(state, "thread-1", message);
    }
    expect(state.bots[1]!.messages.some((message) => message.id === "ask")).toBe(false);
  });

  it("keep a long turn whole from the person's request, up to the hard cap", () => {
    let state: AppState = { ...initialState, bots: [bot(0), bot(1)], selectedId: "bot-0" };
    state = add(state, "thread-1", { id: "pedido", role: "user", kind: "text", text: "Revise tudo", at: 1 });
    for (let step = 0; step < 120; step += 1) {
      state = add(state, "thread-1", { id: `passo-${step}`, role: "bot", kind: "activity", text: "Lendo", at: 2 + step, tool: { name: "Read", ok: true } });
    }
    expect(state.bots[1]!.messages[0]!.id).toBe("pedido");
    for (let step = 120; step < 260; step += 1) {
      state = add(state, "thread-1", { id: `passo-${step}`, role: "bot", kind: "activity", text: "Lendo", at: 2 + step, tool: { name: "Read", ok: true } });
    }
    expect(state.bots[1]!.messages.length).toBeLessThanOrEqual(OFFSCREEN_HARD_CAP);
  });

  it("hand back the same state when nothing needs trimming", () => {
    const state: AppState = { ...initialState, bots: [bot(0), bot(1, turn(1, 0))], selectedId: "bot-0" };
    expect(retainOffscreenMessages(state)).toBe(state);
    expect(retainingReducer(state, { type: "notice", notice: null }).bots).toBe(state.bots);
  });

  it("page the dropped history back from the server when the conversation opens", () => {
    let state = workDay(2, 40);
    const tailStart = state.bots[1]!.messages[0]!.id;
    state = retainingReducer(state, { type: "select", id: "bot-1" });
    state = retainingReducer(state, { type: "loadOlderMessages", threadId: "thread-1" });
    const older = Array.from({ length: 120 }, (_, index) => turn(1, Math.floor(index / 4))[index % 4]!);
    state = retainingReducer(state, { type: "olderMessages", threadId: "thread-1", generation: 0, messages: older, hasMore: false });
    expect(state.bots[1]!.messages).toHaveLength(160);
    expect(state.bots[1]!.messages[120]!.id).toBe(tailStart);
    expect(state.bots[0]!.messages).toHaveLength(OFFSCREEN_TAIL);
  });
});
