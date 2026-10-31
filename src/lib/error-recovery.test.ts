import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { doneStepsBefore, errorRecovery, resumeSendId, whenItResets } from "./error-recovery";
import { parseSendId } from "../../server/send-idempotency";

const NOW = new Date(2026, 9, 19, 1, 0).getTime();

afterEach(() => { setLocale("en"); });

describe("errorRecovery", () => {
  it("gives each class of failure its own sentence and way out", () => {
    setLocale("pt-BR");
    expect(errorRecovery("connect ECONNREFUSED 127.0.0.1:8317", undefined, NOW)).toEqual({
      line: "Perdi a conexão com a IA agora. Toque em tentar de novo que eu refaço.", actions: ["retry", "open-engines"],
    });
    expect(errorRecovery("Not logged in · Please run /login", undefined, NOW)).toEqual({
      line: "A conta de IA deste robô desconectou. Conecte de novo e eu continuo.", actions: ["sign-in"],
    });
    expect(errorRecovery("API Error: 529 Overloaded", undefined, NOW).actions).toEqual(["retry", "open-engines"]);
    expect(errorRecovery("ENOSPC: no space left on device", undefined, NOW).actions).toEqual(["see-backups", "retry"]);
    expect(errorRecovery("turn interrupted — Nordus AI restarted", { class: "interrupted" }, NOW)).toEqual({
      line: "O Nordus reiniciou antes de eu começar. Toque em tentar de novo que eu refaço.", actions: ["retry"],
    });
  });

  it("a usage limit with a reset time says when, and offers another engine instead of a retry that would fail", () => {
    setLocale("pt-BR");
    const retryAt = new Date(2026, 9, 19, 15, 40).getTime();
    const recovery = errorRecovery("This Claude account has reached its 5-hour limit", { class: "usage-limit", retryAt }, NOW);
    expect(recovery.line).toMatch(/^A conta de IA chegou no limite de uso\. Libera às 15:40\.$/);
    expect(recovery.actions).toEqual(["switch-account"]);
  });

  it("after the turn already did work, warns that part may be done and offers to look and resume, never to repeat", () => {
    setLocale("pt-BR");
    const cut = errorRecovery("turn interrupted — Nordus AI restarted", { class: "interrupted", done: 2 }, NOW);
    expect(cut).toEqual({
      line: "O Nordus reiniciou no meio do trabalho. Eu já tinha feito 2 passos. Confira o que ficou pronto e toque em retomar que eu sigo sem repetir.",
      actions: ["see-done", "resume"],
    });
    expect(errorRecovery("Not logged in", { class: "signed-out", done: 1 }, NOW)).toEqual({
      line: "A conta de IA desconectou no meio do trabalho. Eu já tinha feito 1 passo. Confira o que ficou pronto e toque em retomar que eu sigo sem repetir.",
      actions: ["see-done", "sign-in", "resume"],
    });
    expect(errorRecovery("claude exited null before result", { class: "engine-down", done: 2 }, NOW).line).not.toContain("Tente de novo");
    expect(errorRecovery("Delete one computer to start another.", { done: 1 }, NOW)).toEqual({
      line: "Parei no meio do trabalho. Eu já tinha feito 1 passo. Confira o que ficou pronto e toque em retomar que eu sigo sem repetir.",
      actions: ["see-done", "resume"],
    });
  });

  it("an interrupted row from before the server counted the work does not claim nothing was done", () => {
    setLocale("pt-BR");
    expect(errorRecovery("turn interrupted — Nordus AI restarted", undefined, NOW)).toEqual({
      line: "A Nordus reiniciou no meio da resposta. Confira o que já foi feito antes de pedir de novo.", actions: ["retry"],
    });
    expect(errorRecovery("no activity for 20 minutes — the turn was stopped", undefined, NOW).line).toBe("Parei no meio do trabalho.");
  });

  it("keeps the plain sentence with Retry for a cause it cannot classify", () => {
    expect(errorRecovery("The operation was aborted due to timeout", undefined, NOW)).toEqual({ line: "That took too long. Try again.", actions: ["retry"] });
    expect(errorRecovery("Delete one computer to start another.", undefined, NOW)).toEqual({ line: undefined, actions: ["retry"] });
  });
});

describe("whenItResets", () => {
  it("names today, tomorrow or the day", () => {
    setLocale("pt-BR");
    expect(whenItResets(new Date(2026, 9, 19, 15, 40).getTime(), NOW)).toBe("às 15:40");
    expect(whenItResets(new Date(2026, 9, 20, 9, 5).getTime(), NOW)).toBe("amanhã às 09:05");
    expect(whenItResets(new Date(2026, 9, 22, 9, 5).getTime(), NOW)).toBe("em 22/10 às 09:05");
  });
});

describe("doneStepsBefore", () => {
  const row = (id: string, fields: Partial<Message>): Message => ({ id, at: 0, role: "bot", kind: "activity", ...fields } as Message);
  it("lists every step the failed turn started, a cut-off one included, back to the person's message", () => {
    const transcript = [
      row("a", { tool: { name: "Read", ok: true, itemId: "1" } }),
      row("u", { role: "user", kind: "text", text: "manda o e-mail" }),
      row("b", { tool: { name: "WebSearch", ok: true, itemId: "2" } }),
      row("c", { tool: { name: "Bash", ok: false, itemId: "3" } }),
      row("d", { tool: { name: "notice: retrying", ok: true } }),
      row("e", { tool: { name: "WebFetch", ok: true, itemId: "4" } }),
      row("f", { tool: { name: "Bash", itemId: "5" } }),
      row("x", { tool: { name: "error: turn interrupted — Nordus AI restarted", ok: false } }),
    ];
    expect(doneStepsBefore(transcript, 7)).toHaveLength(4);
    expect(doneStepsBefore(transcript, 1)).toHaveLength(1);
  });

  it("keeps to the failed turn's own steps when its id is known", () => {
    const transcript = [
      row("a", { turnId: "goal-1", tool: { name: "WebSearch", ok: true, itemId: "1" } }),
      row("b", { turnId: "goal-2", tool: { name: "Bash", itemId: "2" } }),
      row("x", { turnId: "goal-2", tool: { name: "error: no activity for 20 minutes — the turn was stopped", ok: false } }),
    ];
    expect(doneStepsBefore(transcript, 2, "goal-2")).toHaveLength(1);
    expect(doneStepsBefore(transcript, 2)).toHaveLength(2);
  });
});

describe("resumeSendId", () => {
  it("is one valid send id per failure row, so a second tap is the same send", () => {
    const id = resumeSendId("0f4c2a9e-1b2c-4d5e-8f90-123456789abc");
    expect(resumeSendId("0f4c2a9e-1b2c-4d5e-8f90-123456789abc")).toBe(id);
    expect(parseSendId(id)).toBe(id);
    expect(parseSendId(resumeSendId("m1"))).toBe(resumeSendId("m1"));
    expect(resumeSendId("m2")).not.toBe(resumeSendId("m1"));
  });
});
