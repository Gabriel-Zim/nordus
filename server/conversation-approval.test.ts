import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WireMessage } from "../shared/wire.ts";
import { classifyReply, ConversationApprovals, parseCriticalCall, type CriticalCall, type Decision } from "./conversation-approval.ts";

const MINUTE = 60_000;
const BOT = "b_fin";
const THREAD = "t_fin";
const INVOICE = { cliente: "LUMON", para: "fulano@cliente.com", valor: 2000, descricao: "Invoice de outubro" };
const QUESTION = "Vou mandar a invoice da LUMON de US$ 2.000 para fulano@cliente.com. Posso?";

let dir: string;
let now: number;
let path: WireMessage[];
let seq: number;
let jevAsked: number;

const send = (input: Record<string, unknown> = INVOICE, extra: Partial<CriticalCall> = {}): CriticalCall =>
  ({ threadId: THREAD, botId: BOT, reason: "send", tool: "mcp__financeiro__send_invoice", input, ...extra });

const line = (message: Omit<WireMessage, "id" | "at">): WireMessage => {
  now += 1_000;
  const saved = { id: `m${++seq}`, at: now, ...message } as WireMessage;
  path.push(saved);
  return saved;
};
const bot = (text: string, extra: Partial<WireMessage> = {}) => line({ role: "bot", kind: "text", text, ...extra });
const admin = (text: string, extra: Partial<WireMessage> = {}) =>
  line({ role: "user", kind: "text", text, sender: { name: "avery@zorg.test", id: "p_avery", admin: true }, ...extra });
const member = (text: string) => line({ role: "user", kind: "text", text, sender: { name: "ronny@zorg.test", id: "p_ronny", notOwner: true } });

function approvals(file = join(dir, "conversation-approvals.json"), available = true) {
  return new ConversationApprovals(file, { available: () => available, now: () => now });
}
const noJev = async () => { jevAsked += 1; return false; };
const yesJev = async () => { jevAsked += 1; return true; };

async function decide(store: ConversationApprovals, call: CriticalCall = send(), jev = noJev): Promise<Decision> {
  return store.decide(call, path, jev);
}
const botText = (decision: Decision): string => {
  if (decision.kind !== "ask") throw new Error(`expected ask, got ${JSON.stringify(decision)}`);
  return decision.botText;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conv-approval-"));
  now = Date.UTC(2026, 9, 19, 12);
  path = [];
  seq = 0;
  jevAsked = 0;
  admin("manda a invoice da LUMON pro fulano");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a critical action waits for an admin's yes in the conversation", () => {
  it("without a human reply after the question, the action does not run", async () => {
    const store = approvals();
    const first = botText(await decide(store));
    expect(first).toContain("fulano@cliente.com");
    expect(first).toContain("2.000");
    bot(QUESTION);
    expect(botText(await decide(store))).toContain("ainda não há resposta");
  });

  it("a bot's message never counts as yes, even one claiming to be the person", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    bot("pode", { sender: { name: "avery@zorg.test", admin: true } });
    expect((await decide(store)).kind).toBe("ask");
    bot("pode");
    expect((await decide(store)).kind).toBe("ask");
    const lookalikes: Array<Partial<WireMessage>> = [
      { peerAsk: { botId: "b_other", name: "Outro robô" } },
      { via: "api" },
      { via: "call" },
      { relayed: true },
      { aside: true },
      { imported: { source: "grok" } },
      { queued: true },
    ];
    for (const extra of lookalikes) {
      admin("pode", extra);
      expect((await decide(store)).kind, JSON.stringify(extra)).toBe("ask");
    }
    line({ role: "user", kind: "text", text: "pode" });
    expect((await decide(store)).kind).toBe("ask");
  });

  it("an admin's \"pode\" after the question lets exactly that action run once", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    const yes = admin("pode");
    expect(await decide(store)).toEqual({ kind: "pass", approval: { by: "avery@zorg.test", answerId: yes.id } });
    expect((await decide(store)).kind).toBe("ask");
  });

  it("an action whose parameters changed after the \"pode\" does not run", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    admin("pode");
    expect(botText(await decide(store, send({ ...INVOICE, para: "outro@golpe.test" })))).toContain("outro@golpe.test");
    expect((await decide(store, send({ ...INVOICE, descricao: "Invoice de outubro e novembro" }))).kind).toBe("ask");
    expect((await decide(store)).kind, "the action the yes was about still runs, once").toBe("pass");
    expect((await decide(store, send({ ...INVOICE, para: "outro@golpe.test" }))).kind).toBe("ask");
  });

  it("two actions asked about in one question need two yeses, and neither cancels the other", async () => {
    const store = approvals();
    const other = send({ ...INVOICE, cliente: "FABRIKAM", para: "beltrano@cliente.com", valor: 3500 });
    await decide(store);
    await decide(store, other);
    bot("Vou mandar a invoice da LUMON de US$ 2.000 para fulano@cliente.com e a da FABRIKAM de US$ 3.500 para beltrano@cliente.com. Posso?");
    admin("pode");
    expect((await decide(store)).kind).toBe("pass");
    expect(botText(await decide(store, other))).toContain("já liberou outra ação");
    bot("Agora mando a da FABRIKAM: US$ 3.500 para beltrano@cliente.com. Posso?");
    admin("pode");
    expect((await decide(store, other)).kind).toBe("pass");
  });

  it("amounts and addresses are matched however they are written, and only then", async () => {
    const shown = async (input: Record<string, unknown>, question: string) => {
      const store = approvals(join(dir, `${seq}.json`));
      await decide(store, send(input));
      bot(question);
      admin("pode");
      return (await decide(store, send(input))).kind;
    };
    expect(await shown({ para: "fulano@cliente.com", valor: "2.000,00" }, "Mando R$ 2.000 para fulano@cliente.com?")).toBe("pass");
    expect(await shown({ para: "fulano@cliente.com", unit_amount: 2000 }, "Mando 2.000,00 para fulano@cliente.com?")).toBe("pass");
    expect(await shown({ para: "fulano@cliente.com", amount_cents: 250000 }, "Mando US$ 2,500.00 para fulano@cliente.com?")).toBe("pass");
    expect(await shown({ para: "joão@clínica.com.br", valor: 2000 }, "Mando 2.000 para João@Clínica.com.br?")).toBe("pass");
    expect(await shown({ para: "fulano@cliente.com", valor: "2.000" }, "Mando a invoice 2 de US$ 2 para fulano@cliente.com?")).toBe("ask");
    expect(await shown({ para: "joão@clínica.com.br", valor: 2000 }, "Mando 2.000 para o João da clínica?")).toBe("ask");
  });

  it("a member's \"pode\" does not approve", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    member("pode");
    expect(botText(await decide(store))).toContain("não pode liberar");
  });

  it("a question the bot asked before trying counts, so the person says yes only once", async () => {
    const store = approvals();
    bot(QUESTION);
    const yes = admin("pode");
    expect(await decide(store)).toEqual({ kind: "pass", approval: { by: "avery@zorg.test", answerId: yes.id } });
    expect((await decide(store)).kind, "and that yes is used up").toBe("ask");
  });

  it("an early question loses to a no, and to any other turn of the bot before the yes", async () => {
    bot("Posso mandar a invoice de US$ 2.000 para fulano@cliente.com?", { turnId: "turn-1" });
    admin("não");
    now += 5 * 60 * MINUTE;
    bot("Pronto, relatório feito.", { turnId: "turn-2" });
    admin("beleza, valeu");
    expect((await decide(approvals(join(dir, "nao.json")))).kind).toBe("ask");
  });

  it("an early question counts only while a yes would", async () => {
    bot(QUESTION);
    now += 20 * MINUTE;
    admin("pode");
    expect((await decide(approvals(join(dir, "later.json")))).kind).toBe("pass");
    bot(QUESTION);
    now += 25 * 60 * MINUTE;
    admin("pode");
    expect((await decide(approvals(join(dir, "day.json")))).kind, "but not past a day").toBe("ask");
  });

  it("an early question does not count when it is old, hides a value, or belongs to another open action", async () => {
    bot(QUESTION);
    admin("pode");
    now += 31 * MINUTE;
    expect((await decide(approvals(join(dir, "old.json")))).kind).toBe("ask");
    bot("Posso mandar a invoice da LUMON para fulano@cliente.com?");
    admin("pode");
    expect((await decide(approvals(join(dir, "hidden.json")))).kind).toBe("ask");
    const store = approvals(join(dir, "owned.json"));
    await decide(store, send({ ...INVOICE, valor: 3000 }));
    bot(QUESTION);
    admin("pode");
    expect((await decide(store)).kind, "the yes answered the open 3.000 question").toBe("ask");
  });

  it("an admin's no stops it, and the latest admin line decides", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    admin("pode");
    admin("não, espera");
    expect(botText(await decide(store))).toContain("respondeu que não");
    admin("agora pode");
    expect((await decide(store)).kind).toBe("pass");
  });

  it("an unclear answer makes the bot ask again", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    admin("pode, mas troca o valor");
    expect(botText(await decide(store))).toContain("não foi um sim claro");
  });

  it("a yes typed before the bot asked does not count", async () => {
    const store = approvals();
    admin("pode");
    await decide(store);
    expect((await decide(store)).kind).toBe("ask");
  });

  it("a question that hides the address or the amount is not a question about this action", async () => {
    const store = approvals();
    await decide(store);
    bot("Vou mandar a invoice da LUMON de US$ 2.000 para [o cliente](mailto:fulano@cliente.com). Posso?");
    admin("pode");
    expect(botText(await decide(store))).toContain("não mostrou fulano@cliente.com");
    bot("Vou mandar a invoice da LUMON de US$ 200 para fulano@cliente.com. Posso?");
    admin("pode");
    expect(botText(await decide(store))).toContain("não mostrou o valor 2.000");
  });

  it("an admin's yes to a later, unrelated question does not approve the action", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION, { turnId: "turn-1" });
    member("ronny aqui, segura");
    bot("Enquanto isso, posso apagar o rascunho antigo?", { turnId: "turn-2" });
    admin("pode");
    expect(botText(await decide(store))).toContain("outra pergunta");
  });

  it("a bot line that asks nothing does not separate the question from the yes", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION, { turnId: "turn-1" });
    admin("não, espera");
    bot("Certo, não vou mandar por enquanto.", { turnId: "turn-2" });
    admin("agora pode");
    expect((await decide(store)).kind).toBe("pass");
  });

  it("a yes older than 30 minutes, or a question older than a day, needs a new question", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    admin("pode");
    now += 31 * MINUTE;
    expect(botText(await decide(store))).toContain("mais de 30 minutos");
    now += 24 * 60 * MINUTE;
    bot(QUESTION);
    admin("pode");
    expect((await decide(store)).kind, "a new question and a new yes, even after the old one expired").toBe("pass");
  });

  it("a proposal and its single use survive a restart", async () => {
    await decide(approvals());
    bot(QUESTION);
    admin("manda");
    expect((await decide(approvals())).kind).toBe("pass");
    expect((await decide(approvals())).kind).toBe("ask");
  });

  it("a shell command is bound to its command line, not to the description the engine rewrites", async () => {
    const store = approvals();
    const push = (description: string) => send({ command: "git push origin main", description }, { reason: "deploy", tool: "Bash" });
    expect(botText(await decide(store, push("Push to main")))).toContain('"origin" e "main"');
    bot("Vou rodar git push origin main para publicar. Posso?");
    admin("pode");
    expect((await decide(store, push("Publish the site")))).toMatchObject({ kind: "pass" });
  });
});

describe("a question counts only when it plainly shows the action", () => {
  const asked = async (call: CriticalCall, question: string, answer = "pode", extra: Partial<WireMessage> = {}) => {
    path = [];
    admin("faz isso pra mim");
    const store = approvals(join(dir, `q${seq}.json`));
    await decide(store, call);
    bot(question, extra);
    admin(answer);
    return decide(store, call);
  };
  const deploy = send({ project: "prod" }, { reason: "deploy", tool: "mcp__vercel__deploy" });

  it("an action with no address or amount still has to be named, with its app and identifiers", async () => {
    expect((await asked(deploy, "Tudo certo?", "certo")).kind).toBe("ask");
    expect((await asked(deploy, "Posso publicar o projeto prod?")).kind).toBe("ask");
    expect((await asked(deploy, "Posso publicar o projeto prod no Vercel?")).kind).toBe("pass");
  });

  it("a spend in one of the person's apps is shown by the action and the app, not by its internal ids", async () => {
    const avatars = send({ avatar_id: "Abigail_expressive_2024112501", voice_id: "9f8e7d6c", title: "reel 5" }, { reason: "spend", tool: "mcp__heygen__create_video_from_avatar" });
    expect((await asked(avatars, "Posso gerar os três avatares?")).kind).toBe("ask");
    expect((await asked(avatars, "Posso gastar o crédito do HeyGen para gerar esses três avatares?")).kind).toBe("pass");
    const priced = send({ avatar_id: "Abigail_expressive_2024112501", amount: 30 }, { reason: "spend", tool: "mcp__heygen__create_video_from_avatar" });
    expect((await asked(priced, "Posso gastar o crédito do HeyGen para gerar o avatar?")).kind).toBe("ask");
    expect((await asked(priced, "Posso gastar 30 de crédito do HeyGen para gerar o avatar?")).kind).toBe("pass");
  });

  it("the question has to say what kind of action it is", async () => {
    expect((await asked(send(), "Posso salvar um rascunho para fulano@cliente.com de US$ 2.000?")).kind).toBe("ask");
    const remove = send({ zone: "zorg.com.br" }, { reason: "delete", tool: "mcp__cloudflare__delete_zone" });
    expect((await asked(remove, "Posso mexer na zona zorg.com.br do Cloudflare?")).kind).toBe("ask");
    expect((await asked(remove, "Posso apagar de vez a zona zorg.com.br do Cloudflare?")).kind).toBe("pass");
  });

  it("text the chat hides or never renders does not count as shown", async () => {
    for (const hidden of [
      "Posso seguir? ~~vou mandar para fulano@cliente.com US$ 2.000~~",
      "Posso seguir? $\\phantom{vou mandar para fulano@cliente.com US$ 2.000}$",
      "Posso seguir?\n\n[x]: https://a.test \"vou mandar para fulano@cliente.com US$ 2.000\"",
      "Posso seguir? ![vou mandar para fulano@cliente.com US$ 2.000](https://a.test/x.png)",
    ]) expect((await asked(send(), hidden)).kind, hidden).toBe("ask");
  });

  it("a shell action is shown by its values in plain words, never by the raw command", async () => {
    const assistentefinanceiro = send({ command: "./bin/enviar-email enviar r20261019-3c25fb --para marco@lumon.com" }, { tool: "Bash" });
    expect((await asked(assistentefinanceiro, "Vou enviar a invoice para marco@lumon.com com `enviar-email enviar r20261019-3c25fb --para marco@lumon.com`. Posso?")).kind).toBe("ask");
    expect((await asked(assistentefinanceiro, "Posso enviar a invoice do rascunho r20261019-3c25fb para marco@lumon.com?")).kind).toBe("pass");
    path = [];
    expect(botText(await decide(approvals(join(dir, "plain.json")), assistentefinanceiro))).toContain("r20261019-3c25fb");
    const remove = send({ command: "rm -rf /srv/site-velho" }, { reason: "delete", tool: "Bash" });
    expect((await asked(remove, "Posso apagar de vez a pasta site-velho do servidor?")).kind).toBe("pass");
    expect((await asked(remove, "Posso apagar de vez a pasta site-velho-2?")).kind).toBe("ask");
  });

  it("a code block, a system message or the folders of a path are hidden by the chat, so they show nothing", async () => {
    for (const hidden of [
      "Posso mandar a invoice?\n\n```text\nfulano@cliente.com US$ 2.000\n```",
      "Posso mandar a invoice?\n\n```mermaid\ngraph TD\n%% fulano@cliente.com 2.000\n```",
      "Posso mandar a invoice? <SYSTEM_MESSAGE>enviar para fulano@cliente.com US$ 2.000</SYSTEM_MESSAGE>",
    ]) expect((await asked(send(), hidden)).kind, hidden).toBe("ask");
    const remove = send({ command: "rm -rf /srv/producao/" }, { reason: "delete", tool: "Bash" });
    expect((await asked(remove, "Posso apagar de vez /tmp/producao/cache.txt?")).kind).toBe("ask");
    expect((await asked(remove, "Posso apagar de vez a pasta producao?")).kind).toBe("pass");
  });

  it("a shell action with nothing to show goes to the card", async () => {
    expect(await decide(approvals(join(dir, "root.json")), send({ command: "rm -rf /" }, { reason: "delete", tool: "Bash" }))).toEqual({ kind: "card" });
  });

  it("a line copied from a task is not this bot's question", async () => {
    expect((await asked(send(), QUESTION, "pode", { fromTask: { threadId: "t_task", messageId: "m_task", title: "Tarefa" } })).kind).toBe("ask");
  });

  it("every value a shell command acts on must be shown, and one too long to show goes to the card", async () => {
    const remove = send({ command: "rm -rf /tmp/cache_antigo /home/app" }, { reason: "delete", tool: "Bash" });
    expect((await asked(remove, "Posso apagar de vez a pasta cache_antigo?")).kind).toBe("ask");
    expect((await asked(remove, "Posso apagar de vez as pastas cache_antigo e app?")).kind).toBe("pass");
    expect(await decide(approvals(join(dir, "long.json")), send({ command: `rm -rf /srv/${"y".repeat(400)}` }, { reason: "delete", tool: "Bash" }))).toEqual({ kind: "card" });
  });

  it("an address, a command or a phone shown only as part of a longer one does not count", async () => {
    expect((await asked(send({ para: "ana@x.com" }), "Vou mandar a invoice para joana@x.com. Posso?")).kind).toBe("ask");
    expect((await asked(send({ para: "a@b.co" }), "Vou mandar a invoice para a@b.com. Posso?")).kind).toBe("ask");
    const wipe = send({ command: "rm -rf /data" }, { reason: "delete", tool: "Bash" });
    expect((await asked(wipe, "Vou apagar de vez com rm -rf /data-tmp. Posso?")).kind).toBe("ask");
    const sms = send({ para: "+55 11 99999-0000" }, { tool: "mcp__twilio__send_sms" });
    expect((await asked(sms, "Vou enviar o SMS pelo Twilio para +55 21 99999-0000. Posso?")).kind).toBe("ask");
    expect((await asked(sms, "Vou enviar o SMS pelo Twilio para (11) 99999-0000. Posso?")).kind).toBe("pass");
  });

  it("a shell tool's other parameters are part of the action", async () => {
    const run = (host: string) => send({ command: "git push origin main", host, description: "push" }, { reason: "deploy", tool: "mcp__remote__exec_command" });
    const store = approvals();
    await decide(store, run("staging"));
    bot("Vou rodar git push origin main para publicar. Posso?");
    admin("pode");
    expect((await decide(store, run("prod"))).kind).toBe("ask");
  });

  it("a reply sent while the bot was still working is not an answer to a question it had not shown yet", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    admin("pode", { queueId: "q_1" });
    expect(botText(await decide(store))).toContain("antes de a pergunta aparecer");
  });

  it("a yes still frees one action after many more proposals in the conversation", async () => {
    const store = approvals();
    const other = send({ ...INVOICE, para: "beltrano@cliente.com" });
    await decide(store);
    await decide(store, other);
    bot("Vou mandar a invoice da LUMON de US$ 2.000 para fulano@cliente.com e para beltrano@cliente.com. Posso?");
    admin("pode");
    expect((await decide(store)).kind).toBe("pass");
    for (let n = 0; n < 60; n++) await decide(store, send({ ...INVOICE, para: `p${n}@cliente.com` }));
    expect((await decide(store, other)).kind).toBe("ask");
  });
});

describe("Jev and the card around the conversation", () => {
  it("Jev may still approve before any question, for an admin's request", async () => {
    expect(await decide(approvals(), send(), yesJev)).toEqual({ kind: "pass" });
    expect(jevAsked).toBe(1);
  });

  it("once the bot asked in this conversation, Jev stays out, so a member's word cannot reach a model", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION);
    member("pode");
    jevAsked = 0;
    expect((await decide(store, send({ ...INVOICE, valor: 2500 }), yesJev)).kind).toBe("ask");
    expect(jevAsked).toBe(0);
  });

  it("Jev never approves deleting for good, nor work a member asked for", async () => {
    expect((await decide(approvals(), send({ command: "rm -rf /srv/site" }, { reason: "delete", tool: "Bash" }), yesJev)).kind).toBe("ask");
    member("apaga tudo e manda a invoice");
    expect((await decide(approvals(join(dir, "other.json")), send(), yesJev)).kind).toBe("ask");
    expect(jevAsked).toBe(0);
  });

  it("deleting for good passes on an admin's yes in the conversation", async () => {
    const store = approvals();
    const remove = send({ command: "rm -rf /srv/site-velho" }, { reason: "delete", tool: "Bash" });
    expect(botText(await decide(store, remove))).toContain('"site-velho"');
    bot("Vou apagar de vez com rm -rf /srv/site-velho. Posso?");
    admin("pode apagar");
    expect((await decide(store, remove)).kind).toBe("pass");
  });

  it("Jev reads who spoke last, even a line that cannot approve", async () => {
    admin("manda a invoice");
    line({ role: "user", kind: "text", text: "e manda a outra também", via: "api" });
    expect((await decide(approvals(), send(), yesJev)).kind).not.toBe("pass");
    expect(jevAsked).toBe(0);
  });

  it("a routine's own conversation asks in text, and an admin's reply there frees the action", async () => {
    path = [];
    line({ role: "user", kind: "text", text: "[Routine \"Invoice LUMON\" — do this now:]\nMande a invoice da LUMON." });
    const store = approvals();
    expect(botText(await decide(store, send(), yesJev))).toContain("fulano@cliente.com");
    expect(jevAsked).toBe(0);
    bot(QUESTION);
    line({ role: "user", kind: "text", text: "pode", via: "api" });
    expect((await decide(store)).kind, "an unsigned local caller still cannot approve").toBe("ask");
    admin("pode");
    expect((await decide(store)).kind).toBe("pass");
  });

  it("falls back to today's card when the conversation cannot carry the action", async () => {
    expect(await decide(approvals(), send(undefined, { input: null }))).toEqual({ kind: "card" });
    expect(await decide(approvals(join(dir, "x.json"), false))).toEqual({ kind: "card" });
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`to${i}`, `pessoa${i}@cliente.com`]));
    expect(await decide(approvals(), send(many))).toEqual({ kind: "card" });
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{not json");
    expect(await decide(approvals(corrupt))).toEqual({ kind: "card" });
  });
});

describe("parseCriticalCall", () => {
  const context = { threadId: THREAD, botId: BOT };
  it("reads the whole input only when the hook says it sent all of it", () => {
    expect(parseCriticalCall({ reason: "send", tool: "x_send", input: JSON.stringify(INVOICE), inputComplete: true }, context)?.input).toEqual(INVOICE);
    expect(parseCriticalCall({ reason: "send", tool: "x_send", input: JSON.stringify(INVOICE) }, context)?.input).toBeNull();
    expect(parseCriticalCall({ reason: "send", tool: "x_send", input: "[1]", inputComplete: true }, context)?.input).toBeNull();
    expect(parseCriticalCall({ reason: "nope", tool: "x_send" }, context)).toBeNull();
  });
});

describe("classifyReply", () => {
  const question = QUESTION;
  it.each([
    "pode", "Pode!", "manda", "sim", "Sim, pode mandar", "ok", "beleza", "fechado", "👍", "pode mandar a invoice da LUMON", "manda ver", "autorizo",
  ])("%s is yes", (reply) => expect(classifyReply(reply, question)).toBe("yes"));
  it.each(["ok, para tudo", "pode, esquece", "beleza, deixa pra lá"])("%s is not a yes", (reply) =>
    expect(classifyReply(reply, "Posso parar o envio para fulano?")).not.toBe("yes"));
  it.each(["não", "nao manda", "não, espera", "espera", "para", "cancela", "ainda não", "segura aí"])("%s is no", (reply) =>
    expect(classifyReply(reply, question)).toBe("no"));
  it.each([
    "", "pode?", "pode, mas troca o valor", "pode mandar pro pedro", "talvez", "acho que sim", "pode, não tem problema",
    "sim sim sim sim sim sim sim sim sim sim sim sim sim",
  ])("%s is unclear", (reply) => expect(classifyReply(reply, question)).toBe("unclear"));
});

describe("a card asked in words never frees a critical action", () => {
  it("the yes that answered a card, and the line that asked it, are not the bot's question and the person's yes", async () => {
    const store = approvals();
    await decide(store);
    bot(QUESTION, { textAsk: { requestId: "r_card" } });
    admin("sim", { answersAsk: { requestId: "r_card", reply: "yes" } });
    expect(botText(await decide(store))).toContain("fulano@cliente.com");
    bot(QUESTION);
    admin("sim", { answersAsk: { requestId: "r_card", reply: "yes" } });
    expect(botText(await decide(store))).toContain("ainda não há resposta");
    admin("sim");
    expect((await decide(store)).kind).toBe("pass");
  });
});
