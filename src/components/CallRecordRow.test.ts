import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { CallRecordRow } from "./CallRecordRow";

const at = 1_700_000_000_000;
const msg = (id: string, fields: Partial<Message>): Message => ({ id, role: "bot", kind: "text", at, ...fields }) as Message;
const step = (id: string, request: string, tool: NonNullable<Message["tool"]>) =>
  msg(id, { kind: "activity", requestMessageId: request, tool: { ...tool, itemId: `item-${id}` } });
const row = (call: Partial<NonNullable<Message["call"]>> = {}) => msg("row", {
  kind: "call",
  text: "Call with Pepper · 1:42",
  call: { callId: "c1", botId: "bot", client: "ios", startedAt: at - 102_000, endedAt: at, seconds: 102, endReason: "hung-up", ...call },
});
const transcript: Message[] = [
  msg("m1", { role: "user", text: "what's the weather", via: "call", callId: "c1" }),
  step("a1", "m1", { name: "WebSearch", spoken: "searching the web", ok: true, input: "weather pune secret-query" }),
  msg("o1", {
    kind: "options",
    requestMessageId: "m1",
    card: { title: "Approval needed", subtitle: "rm -rf build", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash", answered: "allow", answeredBy: { kind: "loopback", via: "call" } },
  }),
  msg("b1", { text: "Sunny.", requestMessageId: "m1" }),
  msg("m2", { role: "user", text: "thanks" }),
  step("a2", "m2", { name: "Read", spoken: "reading a file", ok: true }),
];
const draw = (message: Message, messages: Message[] = transcript, { busy = false, hasMore = false } = {}) =>
  renderToStaticMarkup(createElement(CallRecordRow, { message, transcript: [...messages, message], botName: "Pepper", busy, hasMore }));

afterEach(() => {
  setLocale("en");
});

describe("CallRecordRow", () => {
  it("is one quiet line: a wave, the word call and its length, with a thumbs up and down", () => {
    const markup = draw(row());
    expect(markup).toContain('data-testid="call-record"');
    expect(markup).toContain(">Call<");
    expect(markup).toContain("· 1:42");
    expect(markup).toContain('aria-label="Good call"');
    expect(markup).toContain('aria-label="Bad call"');
  });

  it("keeps what happened on the call folded away until the line is opened", () => {
    const markup = draw(row());
    expect(markup).not.toContain("<li");
    expect(markup).not.toContain("rm -rf build");
    expect(markup).not.toContain("secret-query");
    expect(markup).toContain('aria-haspopup="dialog"');
  });

  it("is a labelled group rather than a landmark", () => {
    const markup = draw(row());
    expect(markup).toMatch(/^<div role="group"/);
    expect(markup).not.toContain("<section");
  });
});
