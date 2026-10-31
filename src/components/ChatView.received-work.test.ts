// @vitest-environment happy-dom
// DESIGNERGRAFICO's main conversation shows what LUMON sent her, from the work thread, without writing anything into her own thread.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message, Task } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("@/state/store");
const { t } = await import("@/lib/i18n");
const sent = t("handoff.sent", { name: "LUMON" });

const at = (minute: number) => new Date(2026, 9, 3, 9, minute).getTime();
const REQUEST = "Monta o carrossel da campanha de outubro com a paleta nova";
const FROM = { botId: "lumon", name: "LUMON", color: "blue" as const };

const mainThread: Message[] = [
  { id: "m1", role: "user", kind: "text", at: at(0), text: "Oi, tudo bem?" },
  { id: "m2", role: "bot", kind: "text", at: at(1), parentId: "m1", text: "Tudo certo por aqui." },
];
const request: Message = { id: "w1", role: "bot", kind: "text", at: at(10), from: FROM, roomRequest: { id: "req", phase: "request" }, text: `@DESIGNERGRAFICO ${REQUEST}` };
const answer: Message = { id: "w3", role: "bot", kind: "text", at: at(20), parentId: "w1", text: "Carrossel pronto, 8 lâminas.", turnId: "t1", turnTerminal: true, turnSucceeded: true };
const midTurn: Message = { id: "w5", role: "bot", kind: "text", at: at(18), parentId: "w1", text: "Segundo nome: Café da Vizinha.", turnId: "t2", streamId: "s2" };

let workThread: Message[] = [request];
const fetched: Array<{ url: string; method: string }> = [];

const task = (threadId: string, extra: Partial<Task> = {}): Task => ({
  threadId, title: threadId, createdAt: 1, modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask", ...extra,
});
const working = task("work", {
  title: "@LUMON · work", busy: true, activity: "working", turnStartedAt: at(10),
  openedBy: { botId: "lumon", name: "LUMON", threadId: "lumon-main", kind: "work", at: at(10) },
  steps: [{ at: Date.now() - 5000, text: "Montando a lâmina 3" }],
});
const finished: Task = { ...working, busy: false, activity: "idle", turnStartedAt: undefined, steps: undefined };

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-main`, name: id.toUpperCase(), title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
  tasks: [task(`${id}-main`)], ...extra,
});
const designergrafico = (tasks: Task[], extra: Partial<Bot> = {}) =>
  bot("designergrafico", { mainThreadId: "designergrafico-main", messages: mainThread, activeLeafId: "m2", tasks: [task("designergrafico-main"), ...tasks], ...extra });

let state: AppState = {
  ...initialState,
  connected: true,
  selectedId: "designergrafico",
  bots: [designergrafico([working]), bot("lumon")],
  instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
  config: { features: { showToolCalls: true } } as AppState["config"],
};
const dispatch = vi.fn();
let root: Root;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await settle();
}
async function draw() {
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  const children = createElement(ChatView, { bot: state.bots.find((entry) => entry.id === "designergrafico")! });
  flushSync(() => root.render(createElement(BotEditorStore, { value, children })));
  await settle();
}
const text = () => document.body.textContent ?? "";
const setDesignerGrafico = (next: Bot) => { state = { ...state, bots: [next, ...state.bots.filter((entry) => entry.id !== "designergrafico")] }; };

beforeAll(async () => {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    fetched.push({ url, method: init?.method ?? "GET" });
    if (!url.startsWith("/api/threads/work/messages")) return new Promise(() => {});
    return { ok: true, status: 200, json: async () => ({ messages: workThread, hasMore: false, activeLeafId: workThread.at(-1)!.id }) };
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await draw();
  await until(() => document.querySelector("[data-received-work]") !== null);
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
});

describe("work another bot sent, in the main conversation", () => {
  it("shows the sender, the request and the live step while the bot works", () => {
    const block = document.querySelector("[data-received-work]")!;
    expect(block.getAttribute("data-received-state")).toBe("working");
    expect(block.textContent).toContain("LUMON");
    expect(block.textContent).toContain(REQUEST);
    expect(block.textContent).toContain("Montando a lâmina 3");
    expect(block.textContent).not.toContain(sent);
  });

  it("comes after the messages that were already there, in time order", () => {
    expect(text().indexOf("Tudo certo por aqui.")).toBeLessThan(text().indexOf(REQUEST));
  });

  it("reads the work thread without writing anything", () => {
    expect(fetched.filter((call) => call.url.includes("/work/"))).not.toEqual([]);
    expect(fetched.filter((call) => call.url.includes("/work/")).every((call) => call.method === "GET")).toBe(true);
    expect(fetched.filter((call) => call.method !== "GET")).toEqual([]);
    expect(dispatch.mock.calls.filter(([action]) => action.type !== "revealThread")).toEqual([]);
  });

  it("opens the full conversation between the two bots when the request is pressed", () => {
    flushSync(() => document.querySelector<HTMLElement>("[data-received-ask]")!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "designergrafico", threadId: "work" });
  });

  it("closes with the way back to the sender once the bot answered and stopped", async () => {
    workThread = [request, { id: "w2", role: "bot", kind: "activity", at: at(15), parentId: "w1", tool: { name: "Read", ok: true } }, answer];
    setDesignerGrafico(designergrafico([finished]));
    await draw();
    await until(() => document.querySelector("[data-received-state=returned]") !== null);
    const block = document.querySelector("[data-received-work]")!;
    expect(block.textContent).toContain(sent);
    expect(block.textContent).toContain(REQUEST);
    expect(block.textContent).not.toContain("Montando a lâmina 3");
    dispatch.mockClear();
    flushSync(() => block.querySelector<HTMLElement>("[data-received-return]")!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "lumon", threadId: "lumon-main" });
  });

  it("keeps the first request and its way back on screen when the sender asks again in the same thread", async () => {
    const again: Message = { ...request, id: "w4", at: at(30), parentId: "w3", text: "@DESIGNERGRAFICO Agora troca a capa por uma mais clara" };
    workThread = [request, answer, again];
    setDesignerGrafico(designergrafico([{ ...working, turnStartedAt: at(30) }]));
    await draw();
    await until(() => text().includes("Agora troca a capa"));
    const blocks = [...document.querySelectorAll("[data-received-work]")];
    expect(blocks.map((block) => block.getAttribute("data-received-state"))).toEqual(["returned", "working"]);
    expect(blocks[0]!.textContent).toContain(REQUEST);
    expect(blocks[0]!.textContent).toContain(sent);
    expect(blocks[1]!.textContent).toContain("Agora troca a capa");
    expect(blocks[1]!.textContent).toContain("Montando a lâmina 3");
    expect(blocks[1]!.textContent).not.toContain(sent);
    expect(document.querySelectorAll("[data-received-live]")).toHaveLength(1);
    expect(text().indexOf(REQUEST)).toBeLessThan(text().indexOf("Agora troca a capa"));
  });

  it("shows a quiet stopped line, not the way back, when the bot went idle after mid-turn texts with no settled turn", async () => {
    workThread = [request, midTurn];
    setDesignerGrafico(designergrafico([finished]));
    await draw();
    await until(() => document.querySelector("[data-received-state=stopped]") !== null);
    const block = document.querySelector("[data-received-work]")!;
    expect(block.getAttribute("data-received-state")).toBe("stopped");
    expect(block.textContent).toContain(REQUEST);
    expect(block.textContent).toContain(t("interrupted.title"));
    expect(text()).not.toContain(sent);
    expect(block.querySelector("[data-received-return]")).toBeNull();
    expect(block.querySelector("[data-received-live]")).toBeNull();
  });

  it("keeps working while mid-turn texts arrive and the bot is busy", async () => {
    workThread = [request, midTurn];
    setDesignerGrafico(designergrafico([{ ...working, turnStartedAt: at(10) }]));
    await draw();
    await until(() => document.querySelector("[data-received-state=working]") !== null);
    expect(document.querySelector("[data-received-work]")!.getAttribute("data-received-state")).toBe("working");
    expect(text()).not.toContain(sent);
  });

  it("is not drawn inside the conversation between the two bots, nor for a task the bot opened itself", async () => {
    const own = task("own", { openedBy: { botId: "designergrafico", name: "DESIGNERGRAFICO", at: at(5) } });
    setDesignerGrafico(designergrafico([working, own], { threadId: "work" }));
    await draw();
    expect(document.querySelector("[data-received-work]")).toBeNull();
    setDesignerGrafico(designergrafico([own]));
    await draw();
    await settle();
    expect(document.querySelector("[data-received-work]")).toBeNull();
  });
});
