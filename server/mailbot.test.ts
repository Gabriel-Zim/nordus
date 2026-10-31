import { describe, expect, it } from "vitest";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotMailboxChoices, mailboxAddresses, summaryOf } from "./mailbot.ts";
import { createBotEmailRoutes } from "./routes/bot-emails.ts";

describe("BotMailboxChoices", () => {
  it("keeps the mailbox chosen for each bot across restarts, and guesses nothing from names", () => {
    const dir = mkdtempSync(join(tmpdir(), "nordus-mailboxes-"));
    const choices = new BotMailboxChoices(dir);
    expect(choices.get("b1")).toBeNull();
    choices.set("b1", "assistentefinanceiro");
    expect(new BotMailboxChoices(dir).get("b1")).toBe("assistentefinanceiro");
    expect(() => choices.set("b1", "nope")).toThrow();
    choices.set("b1", null);
    expect(new BotMailboxChoices(dir).get("b1")).toBeNull();
    expect(mailboxAddresses("assistentefinanceiro")).toEqual(["assistentefinanceiro@mailbot.example.com", "finance@mailbot.example.com"]);
  });
  it("reads the Worker's fields into plain ones", () => {
    const mail = summaryOf({ id: "1", bot: "assistentefinanceiro", endereco: "finance", de_email: "a@b.c", de_nome: "", assunto: "Oi", data: "2026-10-16T19:06:50.000Z", lido: 0, anexos: "[{\"n\":0,\"nome\":\"nota.pdf\",\"tipo\":\"application/pdf\",\"tamanho\":12}]", previa: "linha\n dois" });
    expect(mail).toMatchObject({ address: "finance@mailbot.example.com", fromName: null, read: false, preview: "linha dois" });
    expect(mail.attachments).toEqual([{ n: 0, name: "nota.pdf", type: "application/pdf", size: 12 }]);
  });
});

describe("bot email routes", () => {
  it("never opens another bot's mail", async () => {
    process.env.NORDUS_MAILBOT_KEY_FILE = __filename;
    const fetcher = (async () => new Response(JSON.stringify({ id: "x", bot: "assistentefinanceiro", texto: "segredo" }), { status: 200 })) as typeof fetch;
    const route = createBotEmailRoutes({ botExists: () => true, mailboxes: { get: () => "social", set: () => {} }, fetcher });
    let status = 0;
    let body: unknown;
    await route({
      res: {} as never, path: "/api/bots/b1/emails/x", method: "GET", url: new URL("http://h/api/bots/b1/emails/x"),
      json: ((_res: unknown, code: number, payload: unknown) => { status = code; body = payload; }) as never,
    } as never);
    expect(status).toBe(404);
    expect(JSON.stringify(body)).not.toContain("segredo");
  });
});
