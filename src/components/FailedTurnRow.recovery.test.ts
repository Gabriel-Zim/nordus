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

const html = (tool: NonNullable<Message["tool"]>, latest = true) =>
  renderToStaticMarkup(createElement(FailedTurnRow, { tool, engine: undefined, onRetry: latest ? vi.fn() : undefined, botId: "b1", threadId: "t1" }));
const headline = (markup: string) => /<span class="min-w-0 break-words">([^<]*)<\/span>/.exec(markup)?.[1]?.replace(/&#x27;/g, "'");
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>(?:<svg.*?<\/svg>)?\s*([^<]*)<\/button>/g)].map((match) => match[1]!.trim());

afterEach(() => setLocale("en"));

describe("a failed turn's way out", () => {
  it("a restart after the bot already did work warns that part may be done, and offers to look and resume instead of asking again", () => {
    setLocale("pt-br");
    const markup = html(failedTurnTool("turn interrupted — Nordus AI restarted", { done: 3 }));
    expect(headline(markup)).toBe("Parei depois de 3 passos");
    expect(markup).toContain("O Nordus reiniciou no meio do trabalho.");
    expect(markup).toContain("Ao retomar, eu sigo de onde parei sem refazer nada.");
    expect(buttons(markup)).toEqual(["Retomar", "Ver o que já foi feito"]);
    expect(markup).not.toContain("Se precisar, peça de novo");
  });

  it("a signed-out engine offers to sign in, not to retry", () => {
    setLocale("pt-br");
    const markup = html(failedTurnTool("Not logged in · Please run /login", { setup: true }));
    expect(headline(markup)).toBe("A conta de IA deste robô desconectou. Conecte de novo e eu continuo.");
    expect(buttons(markup)).toEqual(["Entrar na conta"]);
  });

  it("in Portuguese, a signed-out row offers to sign in even when the engine reads as signed in", () => {
    setLocale("pt-br");
    const engine = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as unknown as InstanceInfo;
    const markup = renderToStaticMarkup(createElement(FailedTurnRow, { tool: failedTurnTool("Not logged in · Please run /login", { setup: true }), engine, onRetry: vi.fn(), botId: "b1", threadId: "t1" }));
    expect(buttons(markup)).toEqual(["Entrar na conta"]);
  });

  it("a usage limit says when to try again and offers another engine", () => {
    setLocale("pt-br");
    const retryAt = Date.now() + 2 * 3_600_000;
    const markup = html(failedTurnTool("This Claude account has reached its 5-hour limit", { retryAt }));
    expect(headline(markup)).toMatch(/^A conta de IA chegou no limite de uso\. Libera (?:amanhã )?às \d\d:\d\d\.$/);
    expect(buttons(markup)).toEqual(["Trocar conta"]);
  });

  it("an engine that is down, unreachable or a full disk each get their own sentence and button", () => {
    setLocale("pt-br");
    expect(buttons(html(failedTurnTool("API Error: 529 Overloaded")))).toEqual(["Tentar de novo", "Ver contas de IA"]);
    expect(headline(html(failedTurnTool("connect ECONNREFUSED 127.0.0.1:8317")))).toBe("Perdi a conexão com a IA agora. Toque em tentar de novo que eu refaço.");
    expect(buttons(html(failedTurnTool("ENOSPC: no space left on device")))).toEqual(["Ver backups", "Tentar de novo"]);
  });

  it("an old row without the server's count takes the steps the conversation shows, so it never says nothing was done", () => {
    setLocale("pt-br");
    const markup = renderToStaticMarkup(createElement(FailedTurnRow, {
      tool: { name: "error: no activity for 20 minutes — the turn was stopped", ok: false }, engine: undefined, onRetry: vi.fn(), botId: "b1", threadId: "t1", doneSteps: ["Rodar um comando"],
    }));
    expect(headline(markup)).toBe("Parei depois de 1 passo");
    expect(markup).toContain("A IA ficou 20 minutos sem responder, então eu parei.");
    expect(buttons(markup)).toEqual(["Retomar", "Ver o que já foi feito"]);
  });

  it("the server's own count wins over steps the conversation shows from earlier turns", () => {
    setLocale("pt-br");
    const markup = renderToStaticMarkup(createElement(FailedTurnRow, {
      tool: failedTurnTool("no activity for 20 minutes — the turn was stopped", { done: 0 }), engine: undefined, onRetry: vi.fn(), botId: "b1", threadId: "t1", doneSteps: ["Rodar um comando"],
    }));
    expect(headline(markup)).toBe("Parei antes de começar. Toque em tentar de novo que eu refaço.");
    expect(buttons(markup)).toEqual(["Tentar de novo"]);
  });

  it("a signed-out engine that had already done work still shows the sign-in button with the others", () => {
    setLocale("pt-br");
    const engine = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: false } } as unknown as InstanceInfo;
    const markup = renderToStaticMarkup(createElement(FailedTurnRow, {
      tool: failedTurnTool("Not logged in · Please run /login", { setup: true, done: 1 }), engine: undefined, onRetry: vi.fn(), botId: "b1", threadId: "t1",
    }));
    expect(buttons(markup)).toEqual(["Entrar na conta", "Retomar", "Ver o que já foi feito"]);
    const withEngine = renderToStaticMarkup(createElement(FailedTurnRow, {
      tool: failedTurnTool("Not logged in · Please run /login", { setup: true, done: 1 }), engine, onRetry: vi.fn(), botId: "b1", threadId: "t1",
    }));
    expect(buttons(withEngine)).toEqual(["Entrar na conta", "Retomar", "Ver o que já foi feito"]);
  });

  it("an older failure row, without Retry, does not offer to resume either", () => {
    setLocale("pt-br");
    expect(buttons(html(failedTurnTool("turn interrupted — Nordus AI restarted", { done: 2 }), false))).toEqual(["Ver o que já foi feito"]);
  });

  it("a passing stop on the latest row counts down to resume on its own, with a way to say no", () => {
    setLocale("pt-br");
    const row = (autoResume: boolean, cause = "turn interrupted — Nordus AI restarted") => renderToStaticMarkup(createElement(FailedTurnRow, {
      tool: failedTurnTool(cause, { done: 4 }), engine: undefined, onRetry: vi.fn(), botId: "b1", threadId: "t1", messageId: "m9", autoResume,
    }));
    expect(row(true)).toContain("Retomando sozinho em 10 s");
    expect(buttons(row(true))).toContain("Não retomar");
    expect(row(false)).not.toContain("data-auto-resume");
    expect(row(true, "This Claude account has reached its 5-hour limit")).not.toContain("data-auto-resume");
  });

  it("a stop with no class gives its reason in plain words, or says the reason is unknown, never the engine's words", () => {
    setLocale("pt-br");
    const plain = html(failedTurnTool("ENOENT: /srv/nordus/threads/t1/tool.json", { done: 2 }));
    expect(headline(plain)).toBe("Parei depois de 2 passos");
    expect(plain.split("<details")[0]).toContain("Não foi possível encontrar isso.");
    const unknown = html(failedTurnTool("The session went away with the tool call", { done: 2 }));
    expect(unknown.split("<details")[0]).toContain("Não consegui saber o motivo exato.");
  });

  it("an engine that went down mid-work leads with resuming, the engines page second", () => {
    setLocale("pt-br");
    expect(buttons(html(failedTurnTool("API Error: 529 Overloaded", { done: 2 })))).toEqual(["Retomar", "Ver contas de IA", "Ver o que já foi feito"]);
  });
});

describe("a failed turn's technical words", () => {
  it.each(["pt-br", "en", "es"])("stay behind a closed Ver detalhes in %s, never in the sentence", (locale) => {
    setLocale(locale);
    const cause = "Codex exited with code 1: ENOENT /srv/nordus/threads/t1/tool.json";
    const markup = html(failedTurnTool(cause));
    expect(markup).toMatch(/<details class="[^"]*"><summary/);
    expect(markup).not.toMatch(/<details[^>]*\bopen\b/);
    const [outside, inside] = markup.split("<details");
    expect(inside).toContain(cause);
    expect(outside).not.toMatch(/Codex|ENOENT|\/srv\//);
  });

  it("a usage limit names no engine in Portuguese", () => {
    setLocale("pt-br");
    const markup = html(failedTurnTool("This Claude account has reached its 5-hour limit", { retryAt: Date.now() + 3_600_000 }));
    expect(headline(markup)).not.toMatch(/Claude|motor/);
    expect(markup.split("<details")[1]).toContain("This Claude account");
  });
});
