import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Codex" } as InstanceInfo] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
const mode = vi.hoisted(() => ({ advanced: false }));
vi.mock("@/lib/interface-mode", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => mode.advanced,
}));

const { ChatView } = await import("./ChatView");
const { setLocale, t } = await import("@/lib/i18n");
afterAll(() => { setLocale("en"); vi.unstubAllGlobals(); });

let at = 0;
const line = (fields: Partial<Message>): Message => {
  at += 1;
  return { id: `m${at}`, ...(at > 1 ? { parentId: `m${at - 1}` } : {}), at, role: "bot", kind: "activity", ...fields } as Message;
};
const transcript: Message[] = [
  line({ role: "user", kind: "text", text: "faz o relatório da semana", quickModel: "Claude Haiku 4.5" }),
  line({ tool: { name: "recovery: Claude hit its limit (resets 3:40 PM), so Codex took over.", ok: true } }),
  line({ tool: { name: "Aprovado automaticamente: rodar o relatório", ok: true, approved: true } }),
  line({ tool: { name: "Liberado na conversa: enviar o e-mail", ok: true, approved: true } }),
  line({ tool: { name: "Comecei em paralelo: relatório da semana", ok: true } }),
  line({ tool: { name: "DESIGNERGRAFICO levou este pedido a você: publicar o post", ok: true, awaitingApproval: true } }),
  line({ tool: { name: "Opened thread #QA: PR 1", ok: true }, threadRef: { botId: "bot", threadId: "t2", title: "QA: PR 1" } }),
  line({ kind: "compaction", text: "Compacted the thread history" }),
  line({ tool: { name: "error: Codex exited with code 1: ENOENT /srv/nordus/threads/t1/tool.json", ok: false } }),
];
const bot = (messages: Message[]): Bot => ({
  id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "test", model: "m" },
});
const visibleText = (markup: string) => markup
  .replace(/<details[\s\S]*?<\/details>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the Simple chat", () => {
  it("shows the conversation with no technical word outside Detalhes", () => {
    setLocale("pt-br");
    mode.advanced = false;
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: bot(transcript) }));
    const text = visibleText(markup);
    expect(text).toContain("Comecei isso à parte: relatório da semana");
    expect(text).toContain("DESIGNERGRAFICO vai confirmar com você: publicar o post");
    expect(markup).toMatch(/<details[^>]*><summary[^>]*>Detalhes<\/summary>/);
    expect(text).not.toMatch(/Aprovado automaticamente|Liberado na conversa|Opened thread|Resposta rápida/);
    const conversation = text.slice(text.indexOf("faz o relatório"));
    expect(conversation).not.toMatch(/\b(?:claude|codex|engine|motor|thread|tool|ENOENT)\b|took over|\/srv\//i);
  });

  it("hides a failure the bot answered past by itself", () => {
    setLocale("pt-br");
    mode.advanced = false;
    const answered = [...transcript, line({ kind: "text", text: "Pronto, segue o relatório.", turnTerminal: true, turnId: "t9" })];
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: bot(answered) }));
    expect(markup).not.toContain("<details");
    expect(visibleText(markup)).toContain("Pronto, segue o relatório.");
  });

  it("shows everything in Advanced", () => {
    setLocale("pt-br");
    mode.advanced = true;
    try {
      const markup = renderToStaticMarkup(createElement(ChatView, { bot: bot(transcript) }));
      expect(markup).toContain("Resposta rápida com Claude Haiku 4.5");
      expect(markup).toContain("took over");
    } finally {
      mode.advanced = false;
    }
  });

  it("shows one live line while the bot works: no name, no tool, no timer", () => {
    setLocale("pt-br");
    mode.advanced = false;
    const working = [line({ role: "user", kind: "text", text: "procura o voo" }), line({ tool: { name: "Bash", input: "curl https://api.example.com/x", spoken: "running curl" } })];
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot(working), busy: true, activity: "working" } as Bot }));
    const presence = /data-turn-presence[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";
    expect(visibleText(presence)).toContain("Trabalhando nisso…");
    expect(visibleText(presence)).not.toMatch(/Pepper|curl|comando|há \d/);
    expect(markup).not.toContain(`title="${t("chat.stopTurn")}"`);
    mode.advanced = true;
    try {
      const advanced = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot(working), busy: true, activity: "working" } as Bot }));
      expect(advanced).toContain(`title="${t("chat.stopTurn")}"`);
    } finally {
      mode.advanced = false;
    }
  });
});
