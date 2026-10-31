// @vitest-environment happy-dom
import { createElement, useReducer, type Dispatch } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => false,
}));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState, reducer } = await import("@/state/store");
const { t } = await import("@/lib/i18n");

const at = new Date(2026, 9, 8, 12, 27).getTime();
const PEER_BODY = "PEDIDO SIGILOSO DA EDITORDEVIDEO";

const peerLineMessage: Message = {
  id: "p1",
  role: "user",
  kind: "text",
  at,
  text: `[Message from @editordevideo, another bot in this Nordus workspace — not from your user. @editordevideo is waiting on your answer, so reply to them.]\n\n${PEER_BODY}`,
  peerAsk: { botId: "editordevideo", name: "editordevideo" },
};

const peerRequestMessage: Message = {
  id: "p2",
  role: "bot",
  kind: "text",
  at: at + 60_000,
  parentId: "p1",
  text: PEER_BODY,
  from: { botId: "editordevideo", name: "editordevideo", color: "blue" },
  roomRequest: { id: "q1", phase: "request", awaited: true },
};

const oneWayRequestMessage: Message = {
  ...peerRequestMessage,
  id: "p2b",
  at: at + 70_000,
  roomRequest: { id: "q2", phase: "request" },
};

const reply: Message = { id: "b1", role: "bot", kind: "text", at: at + 120_000, parentId: "p2", text: "Resposta do bluth" };

const linkedReply: Message = {
  id: "b2",
  role: "bot",
  kind: "text",
  at: at + 150_000,
  parentId: "p1",
  text: "RESPOSTA LIGADA A EDITORDEVIDEO",
  requestMessageId: "p1",
  turnId: "t1",
  turnTerminal: true,
};

const approvalMessage: Message = {
  id: "c1",
  role: "bot",
  kind: "options",
  at: at + 170_000,
  parentId: "b2",
  requestMessageId: "p1",
  turnId: "t1",
  card: { title: "Approval needed", subtitle: "APROVACAO VISIVEL", options: ["Permitir", "Negar"] },
};

const unattendedMessage: Message = {
  ...peerLineMessage,
  id: "p3",
  at: at + 180_000,
  peerAsk: { botId: "editordevideo", name: "editordevideo", unattended: true },
};

const incidentMessage: Message = {
  id: "p4",
  role: "user",
  kind: "text",
  at: at + 240_000,
  text: "O editordevideo caiu no meio do turno",
  peerAsk: { botId: "editordevideo", name: "editordevideo", incident: { threadId: "bluth-thread" } },
};

const bot = (messages: Message[], extra: Partial<Bot> = {}): Bot => ({
  id: "bluth",
  threadId: "bluth-thread",
  name: "bluth",
  title: "",
  description: "",
  color: "green",
  notifications: true,
  unread: false,
  busy: false,
  messages,
  activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "bluth-thread", title: "Thread", createdAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
  ...extra,
});

const instance = { instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo;
const roots: Array<{ root: Root; container: HTMLElement }> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount(profile: Bot, overrides: Partial<AppState> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  const state: AppState = {
    ...initialState,
    connected: true,
    selectedId: profile.id,
    bots: [profile],
    instances: [instance],
    ...overrides,
  };
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(ChatView, { bot: profile }) })));
  await settle();
  return container;
}

const card = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('[data-testid="peer-label"] button');
const bodyShown = (container: HTMLElement) => container.textContent?.includes(PEER_BODY) ?? false;

let liveState: AppState;
let liveDispatch: Dispatch<Action> | null = null;

function Harness({ profile, seed }: { profile: Bot; seed: AppState }) {
  const [state, dispatch] = useReducer(reducer, seed);
  liveState = state;
  liveDispatch = dispatch;
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  return createElement(BotEditorStore, { value, children: createElement(ChatView, { bot: profile }) });
}

async function mountLive(profile: Bot, overrides: Partial<AppState> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  const seed: AppState = {
    ...initialState,
    connected: true,
    selectedId: profile.id,
    bots: [profile],
    instances: [instance],
    ...overrides,
  };
  flushSync(() => root.render(createElement(Harness, { profile, seed })));
  await settle();
  return container;
}

beforeAll(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    root.unmount();
    container.remove();
  }
});

describe("a message another bot sent into this bot's chat", () => {
  it("is one quiet closed line until the person opens it", async () => {
    const container = await mount(bot([peerLineMessage]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(card(container)?.textContent).toContain(t("chat.peer.messageFrom", { name: "editordevideo" }));
    expect(card(container)?.getAttribute("aria-label")).toContain(t("chat.peer.showMessage"));
    expect(card(container)?.textContent).toContain(t("chat.peer.asked"));
    expect(bodyShown(container)).toBe(false);

    flushSync(() => card(container)?.click());
    await settle();
    expect(card(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(card(container)?.getAttribute("aria-label")).toContain(t("chat.peer.hideMessage"));
    expect(bodyShown(container)).toBe(true);
    expect(container.querySelector('[data-mid="p1"] [data-chat-bubble]')).not.toBeNull();

    flushSync(() => card(container)?.click());
    await settle();
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(bodyShown(container)).toBe(false);
  });

  it("treats a bot request the same way", async () => {
    const container = await mount(bot([peerLineMessage, peerRequestMessage, reply]));
    const cards = container.querySelectorAll<HTMLButtonElement>('[data-testid="peer-label"] button');
    expect(cards).toHaveLength(2);
    expect([...cards].every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(bodyShown(container)).toBe(false);

    flushSync(() => cards[1]!.click());
    await settle();
    expect(bodyShown(container)).toBe(true);
  });

  it("shows the approval question to the person while the card stays closed", async () => {
    const question: Message = {
      id: "q1",
      role: "bot",
      kind: "text",
      at: at + 150_000,
      parentId: "p1",
      text: "Essas são as artes.\nNEEDS INPUT: Aprova?",
      requestMessageId: "p1",
      turnId: "t1",
      turnTerminal: true,
    };
    const container = await mount(bot([peerLineMessage, question]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-peer-replies]')).toBeNull();
    expect(container.querySelector('[data-mid="q1"]')).not.toBeNull();
    expect(container.textContent).toContain("Essas são as artes.");
    expect(container.textContent).toContain("Aprova?");
  });

  it("shows a reply carrying a file while the card stays closed", async () => {
    const fileReply: Message = {
      id: "f1",
      role: "bot",
      kind: "text",
      at: at + 150_000,
      parentId: "p1",
      text: "",
      attachments: [{ kind: "image", path: "/tmp/slide.png", mime: "image/png", name: "slide.png" }],
      requestMessageId: "p1",
      turnId: "t1",
      turnTerminal: true,
    };
    const container = await mount(bot([peerLineMessage, fileReply]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-peer-replies]')).toBeNull();
    expect(container.querySelector('[data-mid="f1"]')).not.toBeNull();
    expect(container.querySelector('img[alt="slide.png"]')).not.toBeNull();
  });

  it("still shows the full bubble in the conversation between two bots", async () => {
    const view = bot([peerLineMessage], {
      threadId: "peer-thread",
      mainThreadId: "main-thread",
      tasks: [
        { threadId: "main-thread", title: "Main", createdAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" },
        { threadId: "peer-thread", title: "Peer", createdAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" },
      ],
    });
    const container = await mount(view);
    expect(bodyShown(container)).toBe(true);
    expect(container.querySelector('[data-testid="peer-label"]')).toBeNull();
  });

  it("mounts the body when a search lands on a closed line", async () => {
    const container = await mount(bot([peerLineMessage]), {
      focusMessage: { threadId: "bluth-thread", messageId: "p1", matchText: "SIGILOSO", nonce: 1, consumed: false },
    });
    expect(card(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(bodyShown(container)).toBe(true);
    expect(container.querySelector('[data-mid="p1"] [data-chat-bubble]')).not.toBeNull();
  });

  it("closes a line that opened for the focus", async () => {
    const container = await mount(bot([peerLineMessage]), {
      focusMessage: { threadId: "bluth-thread", messageId: "p1", matchText: "SIGILOSO", nonce: 1, consumed: false },
    });
    expect(bodyShown(container)).toBe(true);

    flushSync(() => card(container)?.click());
    await settle();
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(bodyShown(container)).toBe(false);
  });

  it("keeps incidents unreported and unattended lines closed", async () => {
    const incident = await mount(bot([incidentMessage]));
    expect(incident.querySelector('[data-testid="peer-label"]')).toBeNull();
    expect(incident.textContent).not.toContain("O editordevideo caiu no meio do turno");

    const unattended = await mount(bot([unattendedMessage]));
    expect(card(unattended)?.getAttribute("aria-expanded")).toBe("false");
    expect(bodyShown(unattended)).toBe(false);
  });
});

describe("the bot's own answers to a peer", () => {
  it("stay inside the closed card and come back when it opens", async () => {
    const container = await mount(bot([peerLineMessage, linkedReply]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("RESPOSTA LIGADA A EDITORDEVIDEO");
    expect(container.querySelector('[data-mid="b2"]')).toBeNull();

    flushSync(() => card(container)?.click());
    await settle();
    expect(bodyShown(container)).toBe(true);
    expect(container.textContent).toContain("RESPOSTA LIGADA A EDITORDEVIDEO");
    expect(container.querySelector('[data-mid="b2"] [data-chat-bubble]')?.textContent).toContain("RESPOSTA LIGADA A EDITORDEVIDEO");
  });

  it("keeps the answer to a one-way request outside the card", async () => {
    const started: Message = {
      id: "b10",
      role: "bot",
      kind: "text",
      at: at + 150_000,
      parentId: "p2b",
      text: "RESPOSTA AO PEDIDO DE MÃO ÚNICA",
      turnId: "t10",
      turnTerminal: true,
    };
    const container = await mount(bot([oneWayRequestMessage, started]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-peer-replies]')).toBeNull();
    expect(container.textContent).toContain("RESPOSTA AO PEDIDO DE MÃO ÚNICA");
    expect(container.querySelector('[data-mid="b10"]')).not.toBeNull();
  });

  it("groups the turn a coordinate_bots request line started", async () => {
    const started: Message = {
      id: "b5",
      role: "bot",
      kind: "text",
      at: at + 150_000,
      parentId: "p2",
      text: "RESPOSTA AO PEDIDO DO PEER",
      turnId: "t9",
      turnTerminal: true,
    };
    const container = await mount(bot([peerRequestMessage, started]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("RESPOSTA AO PEDIDO DO PEER");

    flushSync(() => card(container)?.click());
    await settle();
    expect(bodyShown(container)).toBe(true);
    expect(container.textContent).toContain("RESPOSTA AO PEDIDO DO PEER");
  });

  it("never swallow the approval card of the same turn", async () => {
    const container = await mount(bot([peerLineMessage, linkedReply, approvalMessage]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("RESPOSTA LIGADA A EDITORDEVIDEO");
    expect(container.textContent).toContain("APROVACAO VISIVEL");
  });

  it("opens when a search lands on a hidden reply", async () => {
    const container = await mount(bot([peerLineMessage, linkedReply]), {
      focusMessage: { threadId: "bluth-thread", messageId: "b2", matchText: "LIGADA", nonce: 1, consumed: false },
    });
    expect(card(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("RESPOSTA LIGADA A EDITORDEVIDEO");
  });

  it("stays open once the focus is consumed, and a new search opens it again", async () => {
    const container = await mountLive(bot([peerLineMessage, linkedReply]));
    flushSync(() => liveDispatch!({ type: "focusMessage", threadId: "bluth-thread", messageId: "b2", matchText: "LIGADA" }));
    await settle();
    expect(liveState.focusMessage?.consumed).toBe(true);
    expect(card(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("RESPOSTA LIGADA A EDITORDEVIDEO");

    flushSync(() => card(container)?.click());
    await settle();
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");

    flushSync(() => liveDispatch!({ type: "focusMessage", threadId: "bluth-thread", messageId: "p1", matchText: "SIGILOSO" }));
    await settle();
    expect(liveState.focusMessage?.consumed).toBe(true);
    expect(card(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(bodyShown(container)).toBe(true);
  });
});

describe("a line whose peer is not waiting on the answer", () => {
  const sentLine: Message = {
    id: "s1",
    role: "user",
    kind: "text",
    at: at + 300_000,
    text: "[Thread opened by @editordevideo, another bot in this Nordus workspace — Ownership is yours: continue in this thread. Results, failures and questions stay here; the sender is not waiting and will not be resumed.]\n\nTAREFA ENTREGUE PARA A PESSOA",
    peerAsk: { botId: "editordevideo", name: "editordevideo" },
  };
  const sentDelivery: Message = {
    id: "s2",
    role: "bot",
    kind: "text",
    at: at + 330_000,
    parentId: "s1",
    text: "ENTREGA FICA COM A PESSOA",
    requestMessageId: "s1",
    turnId: "t7",
    turnTerminal: true,
  };

  it("keeps the delivery in the conversation, outside the closed card", async () => {
    const container = await mount(bot([sentLine, sentDelivery]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-peer-replies]')).toBeNull();
    expect(container.textContent).toContain("ENTREGA FICA COM A PESSOA");
    expect(container.querySelector('[data-mid="s2"]')).not.toBeNull();
  });
});

describe("a delivery the harness resumed without a provenance note", () => {
  const retryLine: Message = {
    id: "r1",
    role: "user",
    kind: "text",
    at: at + 300_000,
    text: "[Retry requested by chief, your Chief of Staff, after this thread's last run stopped. Continue the request above from where it stopped and finish it.]",
    peerAsk: { botId: "chief", name: "chief" },
  };
  const retryDelivery: Message = {
    id: "r2",
    role: "bot",
    kind: "text",
    at: at + 330_000,
    text: "ENTREGA DA TAREFA RETOMADA",
    parentId: "r1",
    requestMessageId: "r1",
    turnId: "t8",
    turnTerminal: true,
  };

  it("stays in the conversation, outside the card", async () => {
    const container = await mount(bot([retryLine, retryDelivery]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-peer-replies]')).toBeNull();
    expect(container.textContent).toContain("ENTREGA DA TAREFA RETOMADA");
    expect(container.querySelector('[data-mid="r2"]')).not.toBeNull();
  });
});

describe("a thread the bot opened on itself", () => {
  const selfLine: Message = {
    id: "o1",
    role: "user",
    kind: "text",
    at: at + 300_000,
    text: "[Thread you opened yourself from #bluth. The request below is your own words, not the person's: do the work here and end with a clear result they can read.]\n\nTAREFA DO BOT PARA SI",
    peerAsk: { botId: "bluth", name: "bluth" },
  };

  const selfReply: Message = {
    id: "o2",
    role: "bot",
    kind: "text",
    at: at + 330_000,
    parentId: "o1",
    text: "RESPOSTA DO BOT PARA SI",
    requestMessageId: "o1",
    turnId: "t11",
    turnTerminal: true,
  };

  it("shows the bot's own request instead of folding it into a closed card", async () => {
    const container = await mount(bot([selfLine, selfReply]));
    expect(card(container)).toBeNull();
    expect(container.querySelector('[data-peer-replies]')).toBeNull();
    expect(container.querySelector('[data-mid="o1"]')).not.toBeNull();
    expect(container.textContent).toContain("TAREFA DO BOT PARA SI");
    expect(container.textContent).toContain("RESPOSTA DO BOT PARA SI");
    expect(container.querySelector('[data-mid="o2"]')).not.toBeNull();
  });
});

describe("the unread divider above the card that hides the first unread reply", () => {
  it("stays above the card", async () => {
    const container = await mount(bot([peerLineMessage, linkedReply]), {
      unreadDivider: { threadId: "bluth-thread", messageId: "b2" },
    });
    const divider = container.querySelector("[data-unread-divider]");
    expect(divider).not.toBeNull();
    expect(divider?.closest("[data-mid]")?.getAttribute("data-mid")).toBe("p1");
    expect(container.textContent).not.toContain("RESPOSTA LIGADA A EDITORDEVIDEO");
  });
});

const menuLabels = (container: HTMLElement, messageId: string): string[] => {
  const row = container.querySelector(`[data-mid="${messageId}"]`);
  const more = row?.querySelector<HTMLButtonElement>('[data-testid="message-actions"] button[aria-haspopup="menu"]');
  expect(more).not.toBeNull();
  flushSync(() => more!.click());
  return [...(row?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].map((item) => item.textContent ?? "");
};

describe("the actions of a reply hidden in a peer card", () => {
  const earlier: Message = { ...linkedReply, id: "b3", at: at + 130_000, text: "PRIMEIRA RESPOSTA" };
  const last: Message = { ...linkedReply, id: "b4", at: at + 160_000, parentId: "b3", text: "ULTIMA RESPOSTA" };

  it("offers regenerate only on the last bot text of the transcript", async () => {
    const container = await mount(bot([peerLineMessage, earlier, last]));
    flushSync(() => card(container)?.click());
    await settle();
    expect(menuLabels(container, "b4")).toContain(t("chat.regenerate"));
    expect(menuLabels(container, "b3")).not.toContain(t("chat.regenerate"));
  });
});

describe("a reply hidden in a peer card that is not plain text", () => {
  const cancelledReply: Message = {
    id: "b6",
    role: "bot",
    kind: "text",
    at: at + 180_000,
    parentId: "p1",
    text: "The request was cancelled by the client.",
    requestMessageId: "p1",
    turnId: "t1",
    turnTerminal: true,
  };

  it("reads a legacy cancellation as the stopped line", async () => {
    const container = await mount(bot([peerLineMessage, cancelledReply]));
    flushSync(() => card(container)?.click());
    await settle();
    const hidden = container.querySelector('[data-peer-replies] [data-mid="b6"]');
    expect(hidden?.querySelector('[role="status"]')?.textContent).toContain(t("chat.turnStopped"));
    expect(hidden?.querySelector("[data-chat-bubble]")).toBeNull();
    expect(container.textContent).not.toContain("The request was cancelled by the client.");
  });
});

describe("the replies grouped for a peer card", () => {
  it("keeps the folded file visible with the final reply, outside the card", async () => {
    const earlyFile: Message = {
      id: "a1",
      role: "bot",
      kind: "text",
      at: at + 60_000,
      parentId: "p1",
      text: "",
      turnId: "t1",
      requestMessageId: "p1",
      attachments: [{ kind: "image", path: "/tmp/slide-early.png", mime: "image/png", name: "slide-early.png" }],
    };
    const finalReply: Message = {
      id: "b3",
      role: "bot",
      kind: "text",
      at: at + 90_000,
      parentId: "a1",
      text: "PRONTO COM ARQUIVOS",
      turnId: "t1",
      requestMessageId: "p1",
      turnTerminal: true,
    };
    const container = await mount(bot([peerLineMessage, earlyFile, finalReply]));
    expect(card(container)?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-peer-replies]')).toBeNull();
    expect(container.querySelector('[data-mid="a1"]')).toBeNull();
    expect(container.querySelector('[data-mid="b3"] img[alt="slide-early.png"]')).not.toBeNull();
    expect(container.textContent).toContain("PRONTO COM ARQUIVOS");

    flushSync(() => card(container)?.click());
    await settle();
    expect(container.querySelector('[data-peer-replies]')).toBeNull();
    expect(container.textContent).toContain("PRONTO COM ARQUIVOS");
  });

  it("keeps a reply inside the transcript window in the card", async () => {
    const filler = (n: number, parentId: string): Message => ({
      id: `f${n}`,
      role: "bot",
      kind: "text",
      at: at + 200_000 + n,
      parentId,
      text: `enchimento ${n}`,
    });
    const insideReply: Message = {
      id: "b8",
      role: "bot",
      kind: "text",
      at: at + 300_000,
      text: "RESPOSTA DENTRO DA JANELA",
      parentId: "f100",
      requestMessageId: "p1",
      turnId: "t8",
      turnTerminal: true,
    };
    const before = Array.from({ length: 100 }, (_, index) => filler(index + 1, index === 0 ? "p1" : `f${index}`));
    const after = Array.from({ length: 30 }, (_, index) => filler(index + 101, index === 0 ? "b8" : `f${index + 100}`));
    const container = await mount(bot([peerLineMessage, ...before, insideReply, ...after]), {
      focusMessage: { threadId: "bluth-thread", messageId: "p1", matchText: "SIGILOSO", nonce: 1, consumed: false },
    });
    expect(card(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-peer-replies] [data-mid="b8"]')).not.toBeNull();
    expect(container.textContent).toContain("RESPOSTA DENTRO DA JANELA");
  });

  it("counts in the card only a reply the transcript renders", async () => {
    const callRecord: Message = {
      id: "r1",
      role: "bot",
      kind: "call",
      at: at + 1_000,
      parentId: "p1",
      text: "Call with Pepper · 0:42",
      call: { callId: "c1", botId: "bluth", client: "ios", startedAt: at + 100_000, endedAt: at + 200_000, seconds: 42, endReason: "hung-up" },
    };
    const callReply: Message = {
      id: "b9",
      role: "bot",
      kind: "text",
      at: at + 150_000,
      text: "RESPOSTA DURANTE A LIGACAO",
      parentId: "r1",
      requestMessageId: "p1",
      turnId: "t9",
      turnTerminal: true,
    };
    const focusMessage = { threadId: "bluth-thread", messageId: "p1", matchText: "SIGILOSO", nonce: 1, consumed: false };

    const hidden = await mount(bot([peerLineMessage, callRecord, callReply]), { focusMessage });
    expect(hidden.querySelector('[data-testid="call-record"]')).not.toBeNull();
    expect(card(hidden)?.getAttribute("aria-expanded")).toBe("true");
    expect(hidden.querySelector('[data-peer-replies] [data-mid="b9"]')).toBeNull();
    expect(hidden.querySelector('[data-mid="b9"]')).toBeNull();
    expect(hidden.textContent).not.toContain("RESPOSTA DURANTE A LIGACAO");

    const rendered = await mount(bot([peerLineMessage, { ...callReply, parentId: "p1" }]), { focusMessage });
    expect(card(rendered)?.getAttribute("aria-expanded")).toBe("true");
    expect(rendered.querySelector('[data-peer-replies] [data-mid="b9"]')).not.toBeNull();
    expect(rendered.textContent).toContain("RESPOSTA DURANTE A LIGACAO");
  });
});
