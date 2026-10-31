import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { sendOutbox } from "@/lib/app-outbox";
import { OUTBOX_TTL_MS } from "@/lib/send-outbox";
import { ComposerOutbox, outboxStatusLabel } from "./ComposerOutbox";

const draftId = "bot:designergrafico:outbox-row";
const entry = {
  sendId: "row-aaaaaaaaaaaaaaaa", draftId, target: { kind: "bot" as const, botId: "designergrafico" }, threadId: "t1",
  text: "manda o resumo do dia", requestText: "manda o resumo do dia",
};
const render = (messages: Array<{ sendId?: string }> = []) => renderToStaticMarkup(createElement(ComposerOutbox, { draftId, messages }));

describe("the pending sends above the composer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLocale("pt-br");
  });
  afterEach(() => {
    for (const pending of sendOutbox.entries()) sendOutbox.cancel(pending.sendId);
    setLocale("en");
    vi.useRealTimers();
  });

  it("shows a queued send with Cancelar, and a send past its 24 hours as a failure with Tentar de novo", () => {
    sendOutbox.enqueue(entry);
    expect(render()).toContain("Na fila");
    expect(render()).toContain("Cancelar");
    expect(render()).not.toContain("Tentar de novo");
    vi.advanceTimersByTime(OUTBOX_TTL_MS);
    const failed = render();
    expect(failed).toContain("Não foi entregue em 24 horas");
    expect(failed).toContain("Tentar de novo");
    expect(failed).toContain("manda o resumo do dia");
  });

  it("leaves a send the conversation already shows to the conversation", () => {
    sendOutbox.enqueue(entry);
    expect(render([{ sendId: entry.sendId }])).toBe("");
  });

  it("names a voice note by its length and offers Reenviar when it failed", () => {
    sendOutbox.enqueue({ ...entry, sendId: "row-bbbbbbbbbbbbbbbb", text: "", requestText: undefined, voice: { mime: "audio/webm", durationMs: 72_000 } });
    vi.advanceTimersByTime(OUTBOX_TTL_MS);
    const html = render();
    expect(html).toContain("Mensagem de voz, 1:12");
    expect(html).toContain("Reenviar");
  });

  it("says what went wrong in plain words and keeps the server's text behind Detalhes, with Mandar como nova for a used sendId", async () => {
    sendOutbox.attach({
      ready: () => true,
      voiceNote: vi.fn(),
      deliver: async () => { throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 }); },
    });
    sendOutbox.enqueue(entry);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    sendOutbox.attach(undefined);
    const html = render();
    expect(html).toContain("Não foi entregue: este envio foi cancelado ou o número dele já foi usado");
    expect(html).toContain("Mandar como nova");
    expect(html).not.toContain("Tentar de novo");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Detalhes<\/summary><p[^>]*>sendId already belongs to another message<\/p><\/details>/);
  });

  it("asks to sign in again when the sign-in in front of Nordus expired", () => {
    const waiting = { ...entry, createdAt: 0, expiresAt: 1, status: "queued" as const, signInExpired: true };
    expect(outboxStatusLabel(waiting, true)).toBe("Sua entrada no Nordus venceu. Entre de novo para continuar.");
  });
});

