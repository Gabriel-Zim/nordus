import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstanceInfo, Message } from "@/state/store";
import { failedTurnTool } from "../../shared/failed-turn";
import { setLocale } from "@/lib/i18n";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: {}, instances: [] as InstanceInfo[], bots: [] }, dispatch: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: true } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => null }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { FailedTurnRow } = await import("./ChatView");
const { activityPreview } = await import("@/lib/failed-turn");

const grok = { instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", snapshot: { state: "available", authenticated: true } } as unknown as InstanceInfo;
const chatgpt = { instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT conta 2", snapshot: { state: "available", authenticated: true } } as unknown as InstanceInfo;
const GROK_EXTRA = "Grok has an MCP connection outside the bot's selection. Disable native MCP connections before using tool selection. No prompt was sent.";
const row = (cause: string): NonNullable<Message["tool"]> => failedTurnTool(cause);
const html = (cause: string, engine: InstanceInfo | undefined) =>
  renderToStaticMarkup(createElement(FailedTurnRow, { tool: row(cause), engine, onRetry: vi.fn() }));
const headline = (markup: string) => /<span class="min-w-0 break-words">([^<]*)<\/span>/.exec(markup)?.[1]?.replace(/&#x27;/g, "'");

afterEach(() => setLocale("en"));

describe("a turn the engine refused before sending the prompt", () => {
  it("says in Portuguese what happened, with the engine's words only behind Detalhes", () => {
    setLocale("pt-br");
    const markup = html(GROK_EXTRA, grok);
    expect(headline(markup)).toBe("O Grok tem conexões próprias além das ferramentas escolhidas para este bot, então nada foi enviado. Desligue essas conexões ou mude as ferramentas no perfil do bot.");
    expect(markup).not.toContain("Não consegui concluir isso agora");
    const details = markup.indexOf("<details");
    expect(details).toBeGreaterThan(-1);
    expect(markup.slice(details)).toContain("Detalhes");
    expect(markup.indexOf("Grok has an MCP connection")).toBeGreaterThan(details);
  });

  it.each([
    ["Claude cannot confirm a restricted MCP configuration for this account. Disable inherited Claude MCP servers and use a current, identifiable Claude CLI before using tool selection.",
      "As configurações próprias do Claude impedem confirmar as proteções deste bot, então nada foi enviado. Veja os detalhes para saber o que ajustar."],
    ["Codex has an MCP server outside the selected configuration. Disable native MCP entries for this account before using tool selection. No prompt was sent.",
      "O Codex tem conexões próprias além das ferramentas escolhidas para este bot, então nada foi enviado. Desligue essas conexões ou mude as ferramentas no perfil do bot."],
    ["Codex could not confirm its shell environment policy. No prompt was sent.",
      "As configurações próprias do Codex impedem confirmar as proteções deste bot, então nada foi enviado. Veja os detalhes para saber o que ajustar."],
    ["Codex could not disable inherited shell snapshots. No prompt was sent.",
      "As configurações próprias do Codex impedem confirmar as proteções deste bot, então nada foi enviado. Veja os detalhes para saber o que ajustar."],
    ["Grok could not enforce the selected MCP catalog. No prompt was sent.",
      "As configurações próprias do Grok impedem confirmar as proteções deste bot, então nada foi enviado. Veja os detalhes para saber o que ajustar."],
    ["Grok could not confirm its MCP catalog. No prompt was sent.",
      "O Grok não confirmou as proteções deste bot, então nada foi enviado. Tente de novo; se continuar, atualize o motor."],
    ["Grok could not connect a selected MCP server. No prompt was sent.",
      "Uma ferramenta escolhida para este bot não conectou, então nada foi enviado. Tente de novo."],
    ["Grok could not confirm the selected model without replacing its tool profile. Start a new conversation or choose a model with a supported Grok profile. No prompt was sent.",
      "Este modelo não pode ser usado nesta conversa sem perder as ferramentas escolhidas para o bot, então nada foi enviado. Comece uma conversa nova ou escolha outro modelo."],
    ["gemini: native tool selection is not supported by this engine. Keep native:* in the selection or choose a supported engine.",
      "Este motor não consegue limitar as ferramentas de um bot, então nada foi enviado. Escolha outro motor ou libere todas as ferramentas no perfil do bot."],
    ["Automatic recovery unavailable: no backup is set. Original error: Grok did not confirm its selected MCP catalog in time. No prompt was sent.",
      "O Grok não confirmou as proteções deste bot, então nada foi enviado. Tente de novo; se continuar, atualize o motor."],
  ])("words every engine's refusal the same plain way: %s", (cause, line) => {
    setLocale("pt-br");
    expect(headline(html(cause, undefined))).toBe(line);
  });

  it("previews the refusal in the conversation list in the reader's language", () => {
    setLocale("pt-br");
    expect(activityPreview(row(GROK_EXTRA), grok)).toBe("O Grok tem conexões próprias além das ferramentas escolhidas para este bot, então nada foi enviado. Desligue essas conexões ou mude as ferramentas no perfil do bot.");
  });

  it("names the engine that refused, even after the bot moved to another engine", () => {
    setLocale("pt-br");
    expect(headline(html(GROK_EXTRA, chatgpt))).toMatch(/^O Grok tem conexões próprias/);
    expect(activityPreview(row(GROK_EXTRA), chatgpt)).toMatch(/^O Grok tem conexões próprias/);
  });

  it("points to the details when the engine's own settings are in the way", () => {
    expect(headline(html("Codex could not disable inherited shell snapshots. No prompt was sent.", chatgpt)))
      .toBe("Codex's own settings keep this bot's safeguards from being confirmed, so nothing was sent. See the details for what to change.");
  });

  it("leaves any other failure as it was", () => {
    setLocale("pt-br");
    expect(headline(html("read ECONNRESET", grok))).toBe("A conexão caiu. Tente de novo.");
  });
});
