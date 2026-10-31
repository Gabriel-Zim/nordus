import { describe, expect, it } from "vitest";

import { triggerLabel, triggerLine } from "./trigger-message";

const webhook = (payload: string, event = "") => [
  "[USER-CONFIGURED WEBHOOK INSTRUCTIONS]",
  "Chegou um e-mail no seu endereço. Resuma para o Avery.",
  "[/USER-CONFIGURED WEBHOOK INSTRUCTIONS]",
  "",
  "[UNTRUSTED WEBHOOK EVENT DATA]",
  "Received: 2026-10-16T19:06:52.000Z",
  "Delivery ID: d1",
  ...(event ? [`Event: ${event}`] : []),
  "",
  payload,
  "[/UNTRUSTED WEBHOOK EVENT DATA]",
].join("\n");

describe("triggerLine", () => {
  it("names who sent an email and its subject, never the prompt", () => {
    expect(triggerLine(webhook(JSON.stringify({ de_nome: "Avery Mercer", de_email: "admin@example.com", assunto: "Teste 2 da caixa da ASSISTENTEFINANCEIRO" }))))
      .toEqual({ kind: "email", from: "Avery Mercer", subject: "Teste 2 da caixa da ASSISTENTEFINANCEIRO" });
    expect(triggerLine(webhook(JSON.stringify({ email: { from: { name: "Ana" }, subject: "Oi" } }))))
      .toEqual({ kind: "email", from: "Ana", subject: "Oi" });
  });

  it("calls any other webhook a trigger, by its event name when there is one", () => {
    expect(triggerLine(webhook(JSON.stringify({ order: 7 }), "order.paid"))).toEqual({ kind: "webhook", name: "order.paid" });
    expect(triggerLine(webhook("texto solto"))).toEqual({ kind: "webhook", name: null });
  });

  it("reads a routine's name from its header, and leaves what a person typed alone", () => {
    expect(triggerLine('[Scheduled routine "Bom dia" — do this now:]\nEnvie um resumo.')).toEqual({ kind: "routine", name: "Bom dia" });
    expect(triggerLine('[Routine "Relatório \\"semanal\\"" — do this now:]\nFaça.')).toEqual({ kind: "routine", name: 'Relatório "semanal"' });
    expect(triggerLine("Bom dia, tudo bem?")).toBeNull();
  });
});

describe("triggerLabel", () => {
  it("says the same quiet line the chat shows, for the sidebar too", () => {
    expect(triggerLabel({ kind: "routine", name: "Bom dia" })).toBe("Routine: Bom dia");
    expect(triggerLabel({ kind: "email", from: "Avery Mercer", subject: "Oi" })).toBe("Email from Avery Mercer: Oi");
    expect(triggerLabel({ kind: "webhook", name: null })).toBe("Trigger received");
  });
});
