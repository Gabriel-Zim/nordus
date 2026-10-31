import { describe, expect, it } from "vitest";

import type { ReplyDraftEndFrame, RuntimeEvent } from "../shared/runtime-events.ts";
import { ReplyStreams, type ReplyStreamDeps } from "./reply-streams.ts";
import type { Message } from "./store.ts";

function streams(messages: Message[] = [], heldWords = 0) {
  let n = 0;
  const ended: ReplyDraftEndFrame[] = [];
  const patched: Array<{ messageId: string; patch: Partial<Message> }> = [];
  const openTools = new Map<string, string>();
  const store = {
    activePath: () => messages,
    botByThread: (threadId: string) => (threadId === "loose" ? undefined : { id: "bot" }),
    groupByThread: () => undefined,
    messagesFor: () => messages,
    patchMessage: (_threadId: string, messageId: string, patch: Partial<Message>) => { patched.push({ messageId, patch }); return null; },
  } as unknown as ReplyStreamDeps["store"];
  const s = new ReplyStreams({ store, broadcast: (frame) => ended.push(frame), openTools, newStreamId: () => `s${++n}`, heldWords });
  return { s, ended, patched, openTools };
}

const delta = (threadId: string, text: string, streamKind: "assistant_text" | "reasoning_text" = "assistant_text") =>
  ({ type: "content.delta", streamKind, delta: text, threadId, turnId: "turn-1", eventId: "e", provider: "p", createdAt: "" }) as RuntimeEvent;

describe("ReplyStreams", () => {
  it("numbers each piece by where it starts in the reply", () => {
    const { s } = streams();
    expect(s.append("t1", "turn-1", "Olá, ")).toEqual({ streamId: "s1", rev: 0, offset: 0, delta: "Olá, " });
    expect(s.append("t1", "turn-1", "tudo bem?")).toEqual({ streamId: "s1", rev: 0, offset: 5, delta: "tudo bem?" });
    expect(s.current("t1")).toEqual({ streamId: "s1", rev: 0, text: "Olá, tudo bem?" });
  });

  it("stamps only public reply text in a bot's conversation", () => {
    const { s } = streams();
    expect((s.stamp(delta("t1", "oi")) as { draft?: unknown }).draft).toEqual({ streamId: "s1", rev: 0, offset: 0, delta: "oi" });
    expect((s.stamp(delta("t1", "hmm", "reasoning_text")) as { draft?: unknown }).draft).toBeUndefined();
    expect((s.stamp(delta("loose", "oi")) as { draft?: unknown }).draft).toBeUndefined();
  });

  it("resends the whole draft under a new revision when a rename reaches back into shown text", () => {
    const { s } = streams();
    s.append("t1", "turn-1", "Uso o Claude");
    expect(s.append("t1", "turn-1", " Opus hoje")).toEqual({ streamId: "s1", rev: 1, offset: 0, delta: "Uso o Opus hoje" });
  });

  it("hands its id to the saved reply, or tells phones to drop it", () => {
    const { s, ended } = streams();
    s.append("t1", "turn-1", "um");
    expect(s.saved("t1", "turn-1")).toBe("s1");
    expect(s.current("t1")).toBeNull();
    s.append("t1", "turn-1", "dois");
    s.end("t1", "turn-1");
    expect(ended).toEqual([{ kind: "reply.draft.end", threadId: "t1", streamId: "s2" }]);
    s.end("t1", "turn-1");
    expect(ended).toHaveLength(1);
  });

  it("never carries a reply into the next turn", () => {
    const { s } = streams();
    s.append("t1", "turn-1", "velho");
    expect(s.append("t1", "turn-2", "novo")).toEqual({ streamId: "s2", rev: 0, offset: 0, delta: "novo" });
  });

  it("keeps the written text on Stop, without the provider's cancel sentence, and cancels the open tools", () => {
    const tool = { id: "m-tool", role: "bot", kind: "activity", at: 1, turnId: "turn-1", tool: { name: "Bash", itemId: "i1" } } as Message;
    const { s, patched, openTools, ended } = streams([tool]);
    openTools.set("t1:i1", "m-tool");
    openTools.set("t2:i9", "other");
    s.append("t1", "turn-1", "Comecei a lista The request was aborted.");
    const kept: Array<[string, string]> = [];
    s.stop("t1", "turn-1", (text, streamId) => kept.push([text, streamId]), "The request was aborted.");
    expect(kept).toEqual([["Comecei a lista", "s1"]]);
    expect(ended).toEqual([]);
    expect(patched).toEqual([{ messageId: "m-tool", patch: { tool: { name: "Bash", itemId: "i1", ok: false, cancelled: true } } }]);
    expect([...openTools.keys()]).toEqual(["t2:i9"]);
  });

  it("drops a draft that holds only the cancel sentence", () => {
    const { s, ended } = streams();
    s.append("t1", "turn-1", "The request was aborted.");
    const kept: string[] = [];
    s.stop("t1", "turn-1", (text) => kept.push(text), "The request was aborted.");
    expect(kept).toEqual([]);
    expect(ended).toEqual([{ kind: "reply.draft.end", threadId: "t1", streamId: "s1" }]);
  });

  it("leaves the next turn's draft and tools alone when a stopped turn settles late", () => {
    const next = { id: "m-next", role: "bot", kind: "activity", at: 2, turnId: "turn-2", tool: { name: "Bash", itemId: "i2" } } as Message;
    const { s, patched, openTools, ended } = streams([next]);
    openTools.set("t1:i2", "m-next");
    s.append("t1", "turn-2", "Resposta do pedido novo");
    const kept: string[] = [];
    s.stop("t1", "turn-1", (text) => kept.push(text));
    s.end("t1", "turn-1");
    expect(s.saved("t1", "turn-1")).toBeUndefined();
    expect(kept).toEqual([]);
    expect(ended).toEqual([]);
    expect(patched).toEqual([]);
    expect(s.current("t1")?.text).toBe("Resposta do pedido novo");
    expect(s.saved("t1", "turn-2")).toBe("s1");
  });

  it("filters the draft like the saved reply: no English backstage lead and no secret", () => {
    const { s } = streams();
    const lead = "The answer covers the plan and I will deliver it now.\n\n";
    s.append("t1", "turn-1", lead);
    expect(s.current("t1")?.text).toBe(lead);
    const body = s.append("t1", "turn-1", "Aqui está o plano que você pediu para a semana, com o que não pode faltar.");
    expect(body?.rev).toBe(1);
    expect(body?.delta.startsWith("Aqui está o plano")).toBe(true);
    s.append("t1", "turn-1", " A chave é sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789.");
    expect(s.current("t1")?.text).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("puts the public text, never the raw piece, on the live wire", () => {
    const { s } = streams();
    const lead = "The answer covers the plan and I will deliver it now.\n\n";
    s.stamp(delta("t1", lead));
    const stamped = s.stamp(delta("t1", "Aqui está o plano que você pediu para a semana, com o que não pode faltar.")) as { delta: string };
    expect(stamped.delta).not.toContain("The answer covers");
    const secret = s.stamp(delta("t1", " A chave é sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789. ")) as { delta: string };
    expect(secret.delta).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("holds a secret arriving in pieces until it is whole, so the draft only grows", () => {
    const { s } = streams([], 4);
    const token = "sk-ant-api03-" + "abcdefghijklmnopqrstuvwxyz0123456789".repeat(4);
    const text = `Segue o acesso que você pediu: ${token} e mais nada depois disso, obrigado pela paciência de hoje.`;
    const chunks = [];
    for (let i = 0; i < text.length; i += 4) chunks.push(s.append("t1", "turn-1", text.slice(i, i + 4)));
    const sent = chunks.filter((chunk) => chunk !== null);
    expect(sent.every((chunk) => chunk!.rev === 0)).toBe(true);
    expect(sent.map((chunk) => chunk!.delta).join("")).toBe(s.current("t1")!.text);
    expect(s.current("t1")!.text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(sent.some((chunk) => /sk-ant-api03-\w/.test(chunk!.delta))).toBe(false);
  });

  it("shows nothing of a key block until its END line, and the held words reach Stop", () => {
    const { s } = streams([], 4);
    s.append("t1", "turn-1", "A chave fica assim, guarde bem: -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n");
    expect(s.current("t1")!.text).not.toContain("MIIEvQIBADAN");
    s.append("t1", "turn-1", "Pode usar agora mesmo");
    const kept: string[] = [];
    s.stop("t1", "turn-1", (text) => kept.push(text));
    expect(kept).toHaveLength(1);
    expect(kept[0]).not.toContain("MIIEvQIBADAN");
  });
});
