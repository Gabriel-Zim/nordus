// The decision model only helps the typed-yes rule: it can turn an unclear reply into a yes, never anything else.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WireMessage } from "../shared/wire.ts";
import { ASSISTED_YES_MIN, assistedReply, classifyReply, ConversationApprovals, replyNeedsReading, type CriticalCall } from "./conversation-approval.ts";

const BOT = "b_fin";
const THREAD = "t_fin";
const INVOICE = { cliente: "LUMON", para: "fulano@cliente.com", valor: 2000, descricao: "Invoice de outubro" };
const QUESTION = "Vou mandar a invoice da LUMON de US$ 2.000 para fulano@cliente.com. Posso?";

let dir: string;
let now: number;
let path: WireMessage[];
let seq: number;

const send = (): CriticalCall => ({ threadId: THREAD, botId: BOT, reason: "send", tool: "mcp__financeiro__send_invoice", input: INVOICE });
const line = (message: Omit<WireMessage, "id" | "at">): WireMessage => {
  now += 1_000;
  const saved = { id: `m${++seq}`, at: now, ...message } as WireMessage;
  path.push(saved);
  return saved;
};
const bot = (text: string) => line({ role: "bot", kind: "text", text });
const admin = (text: string) => line({ role: "user", kind: "text", text, sender: { name: "avery@zorg.test", id: "p_avery", admin: true } });
const member = (text: string) => line({ role: "user", kind: "text", text, sender: { name: "ronny@zorg.test", id: "p_ronny", notOwner: true } });
const noJev = async () => false;

function approvals(readReply?: (reply: string, question: string) => Promise<number | null>) {
  return new ConversationApprovals(join(dir, "conversation-approvals.json"), { available: () => true, now: () => now, ...(readReply ? { readReply } : {}) });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conv-approval-clef-"));
  now = Date.UTC(2026, 9, 22, 12);
  path = [];
  seq = 0;
  admin("manda a invoice da LUMON pro fulano");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("assistedReply", () => {
  it("keeps the rule's yes and no whatever the model says", () => {
    expect(assistedReply("pode", QUESTION, 0)).toBe("yes");
    expect(assistedReply("não", QUESTION, 1)).toBe("no");
    expect(assistedReply("espera", QUESTION, 1)).toBe("no");
  });

  it("turns an unclear reply into a yes only at the threshold and with no holding word", () => {
    const reply = "pode mandar, ficou ótimo";
    expect(classifyReply(reply, QUESTION)).toBe("unclear");
    expect(assistedReply(reply, QUESTION, ASSISTED_YES_MIN)).toBe("yes");
    expect(assistedReply(reply, QUESTION, ASSISTED_YES_MIN - 0.01)).toBe("unclear");
    expect(assistedReply(reply, QUESTION)).toBe("unclear");
    expect(assistedReply(reply, QUESTION, Number.NaN)).toBe("unclear");
    for (const held of ["pode mandar mas troca o valor", "manda só depois das 3", "pode mandar? ficou ótimo", "ficou ótimo, agora não", "pode, porém antes revisa"]) {
      expect(assistedReply(held, QUESTION, 0.99)).toBe("unclear");
      expect(replyNeedsReading(held, QUESTION)).toBe(false);
    }
    expect(assistedReply(`pode mandar ${"muito ".repeat(45)}bom`, QUESTION, 0.99)).toBe("unclear");
  });
});

describe("ConversationApprovals with the decision model", () => {
  it("an admin's \"pode mandar, ficou ótimo\" frees the action when the model says yes", async () => {
    const readReply = vi.fn().mockResolvedValue(0.97);
    const store = approvals(readReply);
    await store.decide(send(), path, noJev);
    bot(QUESTION);
    const yes = admin("pode mandar, ficou ótimo");
    expect(await store.decide(send(), path, noJev)).toEqual({ kind: "pass", approval: { by: "avery@zorg.test", answerId: yes.id } });
    expect(readReply).toHaveBeenCalledWith("pode mandar, ficou ótimo", QUESTION);
  });

  it("the same reply still asks again without the model, below the threshold, or when the model fails", async () => {
    for (const readReply of [undefined, vi.fn().mockResolvedValue(0.6), vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(new Error("down"))]) {
      path = [];
      admin("manda a invoice da LUMON pro fulano");
      const store = approvals(readReply);
      await store.decide(send(), path, noJev);
      bot(QUESTION);
      admin("pode mandar, ficou ótimo");
      expect((await store.decide(send(), path, noJev)).kind).toBe("ask");
      rmSync(join(dir, "conversation-approvals.json"), { force: true });
    }
  });

  it("never asks the model about a clear yes, a no, or a holding reply", async () => {
    const readReply = vi.fn().mockResolvedValue(0.99);
    const store = approvals(readReply);
    await store.decide(send(), path, noJev);
    bot(QUESTION);
    admin("pode mandar mas troca o valor");
    expect((await store.decide(send(), path, noJev)).kind).toBe("ask");
    admin("não");
    expect((await store.decide(send(), path, noJev)).kind).toBe("ask");
    admin("pode");
    expect((await store.decide(send(), path, noJev)).kind).toBe("pass");
    expect(readReply).not.toHaveBeenCalled();
  });

  it("a member's reply is never read as anyone's yes, however sure the model is", async () => {
    const readReply = vi.fn().mockResolvedValue(1);
    const store = approvals(readReply);
    await store.decide(send(), path, noJev);
    bot(QUESTION);
    member("pode mandar, ficou ótimo");
    expect((await store.decide(send(), path, noJev)).kind).toBe("ask");
  });

  it("one assisted yes frees one action, never two", async () => {
    const store = approvals(vi.fn().mockResolvedValue(0.97));
    await store.decide(send(), path, noJev);
    bot(QUESTION);
    admin("pode mandar, ficou ótimo");
    const [first, second] = await Promise.all([store.decide(send(), path, noJev), store.decide(send(), path, noJev)]);
    expect([first.kind, second.kind].sort()).toEqual(["ask", "pass"]);
  });
});
