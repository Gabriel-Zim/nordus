import { afterEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { TurnErrorClass } from "../../shared/turn-error";
import { RECOVERY_LABEL, errorRecovery } from "./error-recovery";
import { narrationLine, plainChipShown, plainMechanicalLine, recoveredAfter, simpleWorkingLine } from "./plain-conversation";

const NOW = new Date(2026, 9, 22, 10, 0).getTime();
const at = (index: number) => NOW + index;
const row = (fields: Partial<Message>, index = 0): Message => ({ id: `m${index}`, at: at(index), role: "bot", kind: "text", ...fields }) as Message;

afterEach(() => { setLocale("en"); });

/** Words that name the machinery behind a bot; none may reach a line the Simple chat shows. */
const TECHNICAL = /\b(?:claude|codex|grok|gemini|openai|anthropic|engines?|motor(?:es)?|threads?|tools?|ferramentas?|stack|ENOENT|ECONN\w*|HTTP|API)\b|[—–]|\/[\w.-]+\//i;

const CLASSES: TurnErrorClass[] = ["engine-unreachable", "signed-out", "usage-limit", "engine-down", "disk-full", "interrupted"];

function simpleChatLines(): string[] {
  const lines: string[] = [];
  const say = (line: string | undefined) => { if (line) lines.push(line); };
  for (const kind of CLASSES) {
    for (const done of [0, 1, 4]) {
      const recovery = errorRecovery("x", { class: kind, ...(done ? { done } : {}) }, NOW);
      say(recovery.line);
      say(recovery.title);
      say(recovery.why);
    }
  }
  say(errorRecovery("This Claude account has reached its 5-hour limit", { class: "usage-limit", retryAt: NOW + 3_600_000 }, NOW).line);
  say(errorRecovery("turn interrupted — Nordus AI restarted", { class: "interrupted" }, NOW).line);
  say(errorRecovery("turn interrupted — Nordus AI restarted", { class: "interrupted", done: 2 }, NOW).line);
  for (const cause of ["fetch failed", "API Error: 429", "socket hang up", "ETIMEDOUT", "EACCES", "HTTP 401", "ENOENT", "413", "HTTP 500", "turn interrupted — settings changed", "this bot reached its monthly limit"]) {
    say(errorRecovery(cause, undefined, NOW).line);
  }
  for (const label of Object.values(RECOVERY_LABEL)) say(t(label));
  say(t("chat.error.generic"));
  say(t("chat.error.details"));
  for (const key of ["chat.recovery.resumeHint", "chat.recovery.autoResumeCancel", "chat.recovery.why.unknown"] as const) say(t(key));
  say(t("chat.recovery.autoResume", { seconds: 10 }));
  say(t("chat.screen.show"));
  say(t("chat.activity.onIt"));
  for (const name of [
    "recovery: Claude hit its limit (resets 3:40 PM), so Codex took over.",
    "Aprovado automaticamente: pagamento",
    "Liberado na conversa: envio do e-mail",
    "Opened thread #Relatório da semana",
    "Comecei em paralelo: relatório da semana",
    "DESIGNERGRAFICO levou este pedido a você",
    "DESIGNERGRAFICO levou este pedido a você: publicar o post",
  ]) {
    const line = plainMechanicalLine(name);
    if (line && "say" in line) say(line.say);
  }
  return lines;
}

describe("the Simple chat speaks plainly", () => {
  it("every line it can say about a failure or the server's mechanics is Portuguese with no technical word", () => {
    setLocale("pt-br");
    const lines = simpleChatLines();
    expect(lines.length).toBeGreaterThan(25);
    for (const line of lines) expect(line, line).not.toMatch(TECHNICAL);
  });

  it("a failed turn reads as what happened and what the bot does next", () => {
    setLocale("pt-br");
    expect(errorRecovery("API Error: 529 Overloaded", undefined, NOW).line).toBe("A IA está fora do ar agora. Toque em tentar de novo daqui a pouco que eu refaço.");
    expect(errorRecovery("This Claude account has reached its 5-hour limit", { class: "usage-limit", retryAt: new Date(2026, 9, 22, 15, 40).getTime() }, NOW).line)
      .toBe("A conta de IA chegou no limite de uso. Libera às 15:40.");
    expect(errorRecovery("turn interrupted — Nordus AI restarted", { class: "interrupted", done: 3 }, NOW).line)
      .toBe("O Nordus reiniciou no meio do trabalho. Eu já tinha feito 3 passos. Confira o que ficou pronto e toque em retomar que eu sigo sem repetir.");
  });

});

describe("plainMechanicalLine", () => {
  it("drops what the bot gets past alone and the approvals the person already gave", () => {
    for (const name of [
      "recovery: Claude hit its limit, so Codex took over.",
      "recovery: Automatic recovery: Claude is signed out. Trying Codex · gpt-5 once in this thread.",
      "Aprovado automaticamente: pagamento",
      "Liberado na conversa: pagamento no Financeiro",
      "Opened thread #QA: PR #1",
    ]) expect(plainMechanicalLine(name), name).toEqual({ hide: true });
  });

  it("says a parallel start and a request the lead took to the person in words", () => {
    setLocale("pt-br");
    expect(plainMechanicalLine("Comecei em paralelo: relatório da semana")).toEqual({ say: "Comecei isso à parte: relatório da semana" });
    expect(plainMechanicalLine("DESIGNERGRAFICO levou este pedido a você")).toEqual({ say: "DESIGNERGRAFICO vai confirmar isso com você." });
    expect(plainMechanicalLine("DESIGNERGRAFICO levou este pedido a você: publicar o post")).toEqual({ say: "DESIGNERGRAFICO vai confirmar com você: publicar o post" });
  });

  it("leaves every other line to the chat", () => {
    expect(plainMechanicalLine("notice: Sua conta voltou.")).toBeNull();
    expect(plainMechanicalLine("Read file")).toBeNull();
  });
});

describe("plainChipShown", () => {
  it("keeps hand-offs the app words itself and hides a raw server title", () => {
    expect(plainChipShown(row({ kind: "activity", tool: { name: "Sent to GerenteDeOperacao", ok: true } }))).toBe(true);
    expect(plainChipShown(row({ kind: "activity", tool: { name: "Waiting on your approval in @GerenteDeOperacao" } }))).toBe(true);
    expect(plainChipShown(row({ kind: "activity", tool: { name: "Posted in Sala", ok: true } }))).toBe(true);
    expect(plainChipShown(row({ kind: "activity", tool: { name: "coordinate_bots ok", ok: true } }))).toBe(false);
  });
});

describe("recoveredAfter", () => {
  it("hides a failure the bot answered past before the person wrote again", () => {
    const transcript = [
      row({ role: "user", text: "faz o relatório" }, 0),
      row({ kind: "activity", tool: { name: "error: API Error: 529 Overloaded", ok: false } }, 1),
      row({ text: "Pronto, segue o relatório.", turnTerminal: true, turnId: "t2" }, 2),
    ];
    expect(recoveredAfter(transcript, 1)).toBe(true);
  });

  it("keeps the failure when the person spoke first or nothing came after", () => {
    const failed = row({ kind: "activity", tool: { name: "error: API Error: 529 Overloaded", ok: false } }, 1);
    expect(recoveredAfter([failed], 0)).toBe(false);
    expect(recoveredAfter([failed, row({ role: "user", text: "e aí?" }, 2), row({ text: "Pronto.", turnTerminal: true }, 3)], 0)).toBe(false);
    expect(recoveredAfter([failed, row({ text: "Vou tentar.", turnTerminal: false }, 2)], 0)).toBe(false);
  });
});

describe("narrationLine", () => {
  it("is the bot's first sentence of progress, without markdown", () => {
    expect(narrationLine([row({ text: "**Avisando o GerenteDeOperacao** e montando a conferência. Depois eu te mando o resultado." })]))
      .toBe("Avisando o GerenteDeOperacao e montando a conferência.");
  });

  it("is cut short when the bot runs on", () => {
    const line = narrationLine([row({ text: "a".repeat(300) })])!;
    expect(line.length).toBeLessThanOrEqual(110);
    expect(line.endsWith("…")).toBe(true);
  });

  it("is undefined with no words", () => {
    expect(narrationLine([row({ text: "  " })])).toBeUndefined();
  });
});

describe("simpleWorkingLine", () => {
  it("is the bot's newest step in its own words, with no closing mark for the dots to follow", () => {
    expect(simpleWorkingLine([
      { at: 1, text: "Lendo o briefing" },
      { at: 2, tool: "Bash" },
      { at: 3, text: "Avisando o GerenteDeOperacao e montando a conferência." },
    ])).toBe("Avisando o GerenteDeOperacao e montando a conferência");
  });

  it("says it is working on it when the bot named no step, or named a path", () => {
    setLocale("pt-br");
    expect(simpleWorkingLine(undefined)).toBe("Trabalhando nisso");
    expect(simpleWorkingLine([{ at: 1, tool: "Read" }])).toBe("Trabalhando nisso");
    expect(simpleWorkingLine([{ at: 1, text: "Editando /srv/app/index.ts" }])).toBe("Trabalhando nisso");
  });
});
