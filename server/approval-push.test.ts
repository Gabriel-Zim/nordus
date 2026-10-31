import { describe, expect, it } from "vitest";

import { approvalId, type ApprovalItem } from "../shared/approvals.ts";
import type { Notification } from "../shared/notification.ts";
import { ACTION_TOKEN_TTL_MS, askedPhrase, createActionTokens, createApprovalPush, ownerOfRequest } from "./approval-push.ts";

const ID = approvalId("t-atlas", "m1");

describe("a one-tap token", () => {
  it("works once, for one approval, for the device it was issued to", () => {
    const tokens = createActionTokens();
    const token = tokens.issue({ approvalId: ID, owner: "session-1" });
    expect(token).toMatch(/^[\w-]{20,}$/);
    expect(tokens.consume(token, { approvalId: ID, owner: "session-1" })).toBe("ok");
    expect(tokens.consume(token, { approvalId: ID, owner: "session-1" })).toBe("unknown");
    expect(tokens.size).toBe(0);
  });

  it("is spent by a try that fails, so a wrong guess does not get a second go", () => {
    const tokens = createActionTokens();
    const forAnother = tokens.issue({ approvalId: ID, owner: "session-1" });
    expect(tokens.consume(forAnother, { approvalId: approvalId("t-atlas", "m2"), owner: "session-1" })).toBe("wrong-approval");
    expect(tokens.consume(forAnother, { approvalId: ID, owner: "session-1" })).toBe("unknown");
    const forAda = tokens.issue({ approvalId: ID, owner: "session-ada" });
    expect(tokens.consume(forAda, { approvalId: ID, owner: "session-bob" })).toBe("wrong-person");
    expect(tokens.consume(forAda, { approvalId: ID, owner: "session-ada" })).toBe("unknown");
  });

  it("runs out in minutes, not days", () => {
    let now = 1_000_000;
    const tokens = createActionTokens({ now: () => now });
    const token = tokens.issue({ approvalId: ID, owner: "session-1" });
    now += ACTION_TOKEN_TTL_MS;
    expect(tokens.consume(token, { approvalId: ID, owner: "session-1" })).toBe("expired");
    expect(ACTION_TOKEN_TTL_MS).toBeLessThanOrEqual(60 * 60_000);
    const fresh = tokens.issue({ approvalId: ID, owner: "session-1" });
    now += ACTION_TOKEN_TTL_MS - 1;
    expect(tokens.consume(fresh, { approvalId: ID, owner: "session-1" })).toBe("ok");
  });

  it("is unknown when it was never issued, and every token is its own", () => {
    const tokens = createActionTokens();
    expect(tokens.consume("made-up", { approvalId: ID, owner: "session-1" })).toBe("unknown");
    expect(tokens.consume("", { approvalId: ID, owner: "session-1" })).toBe("unknown");
    const a = tokens.issue({ approvalId: ID, owner: "session-1" });
    const b = tokens.issue({ approvalId: ID, owner: "session-1" });
    expect(a).not.toBe(b);
    expect(tokens.size).toBe(2);
  });

  it("forgets the old ones, so the table cannot grow without end", () => {
    let now = 0;
    const tokens = createActionTokens({ now: () => now, ttlMs: 1_000 });
    for (let index = 0; index < 10; index += 1) tokens.issue({ approvalId: ID, owner: `s-${index}` });
    now = 5_000;
    tokens.issue({ approvalId: ID, owner: "late" });
    expect(tokens.size).toBe(1);
  });

  it("belongs to the paired session, or to the machine's owner", () => {
    expect(ownerOfRequest({ kind: "session", session: { id: "s-9" } })).toBe("s-9");
    expect(ownerOfRequest({ kind: "loopback" })).toBe("loopback");
  });
});

describe("who the request was made of", () => {
  it("is said in plain words", () => {
    expect(askedPhrase("Administradores", { you: true })).toBe("Pediu a você.");
    expect(askedPhrase("Administradores", { you: false })).toBe("Pediu aos administradores.");
    expect(askedPhrase("Rafael", { you: false })).toBe("Pediu a Rafael.");
  });
});

const item = (extra: Partial<ApprovalItem> = {}): ApprovalItem => ({
  id: ID, kind: "permission", botId: "atlas", botName: "Atlas", threadId: "t-atlas", messageId: "m1", requestId: "req-1",
  title: "Atlas quer voltar produção para a v2.14.3", summary: "Desfaz o deploy das 14h02", fields: [], risk: "normal",
  requestedAt: 1, decider: "Rafael", canDecide: true, action: "decide", ...extra,
});
const approval: Notification = { kind: "approval", botId: "atlas", botName: "Atlas", threadId: "t-atlas", title: "x", body: "y", requestId: "req-1" };

function decorator(found: { item: ApprovalItem; asked: boolean } | null) {
  const tokens = createActionTokens();
  const decorate = createApprovalPush({ tokens, itemFor: () => found });
  return { tokens, decorate };
}

describe("the phone's banner for an approval", () => {
  it("says what is asked and of whom, and offers Approve and Decline with a token for that device", () => {
    const { tokens, decorate } = decorator({ item: item(), asked: false });
    const decoration = decorate(approval, { owner: "session-1" })!;
    expect(decoration.title).toBe("Atlas quer voltar produção para a v2.14.3");
    expect(decoration.body).toBe("Desfaz o deploy das 14h02. Pediu a Rafael.");
    expect(decoration.actions).toEqual([{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }]);
    expect(decoration.approval).toMatchObject({ id: ID, done: { approve: "Aprovado por você · enviado", decline: "Recusado por você" } });
    const token = decoration.approval!.token;
    expect(tokens.consume(token, { approvalId: ID, owner: "session-2" })).toBe("wrong-person");
  });

  it("holds a token only the right device can spend", () => {
    const { tokens, decorate } = decorator({ item: item(), asked: true });
    const decoration = decorate(approval, { owner: "session-1" })!;
    expect(decoration.body).toBe("Desfaz o deploy das 14h02. Pediu a você.");
    expect(tokens.consume(decoration.approval!.token, { approvalId: ID, owner: "session-1" })).toBe("ok");
  });

  it("only opens the card for a critical action: it is approved by holding the button, never from a banner", () => {
    const { tokens, decorate } = decorator({ item: item({ risk: "critical" }), asked: true });
    const decoration = decorate(approval, { owner: "session-1" })!;
    expect(decoration.title).toBe("Atlas quer voltar produção para a v2.14.3");
    expect(decoration.actions).toBeUndefined();
    expect(decoration.approval).toBeUndefined();
    expect(tokens.size).toBe(0);
  });

  it("only opens the card when the person may not decide it", () => {
    const { tokens, decorate } = decorator({ item: item({ canDecide: false }), asked: false });
    const decoration = decorate(approval, { owner: "session-1" })!;
    expect(decoration.title).toBe("Atlas quer voltar produção para a v2.14.3");
    expect(decoration.actions).toBeUndefined();
    expect(decoration.approval).toBeUndefined();
    expect(tokens.size).toBe(0);
  });

  it("says nothing new about an approval that has to be read first", () => {
    const { tokens, decorate } = decorator({ item: item({ action: "open", kind: "skill" }), asked: false });
    expect(decorate(approval, { owner: "session-1" })).toBeUndefined();
    expect(tokens.size).toBe(0);
  });

  it("restyles what a bot sends in the person's name the same way", () => {
    const { decorate } = decorator({ item: item({ kind: "outbound", title: "Atlas quer enviar algo em seu nome", risk: "critical" }), asked: true });
    expect(decorate(approval, { owner: "session-1" })).toEqual({
      title: "Atlas quer enviar algo em seu nome",
      body: "Desfaz o deploy das 14h02. Pediu a você.",
    });
  });

  it("keeps the words of a bot asking to talk to another bot, and still offers the buttons", () => {
    const { tokens, decorate } = decorator({ item: item({ kind: "peer", title: "DESIGNERGRAFICO quer falar com Dot" }), asked: true });
    const decoration = decorate(approval, { owner: "session-1" })!;
    expect(decoration.title).toBeUndefined();
    expect(decoration.body).toBeUndefined();
    expect(decoration.actions).toEqual([{ action: "approve", title: "Aprovar" }, { action: "decline", title: "Recusar" }]);
    expect(tokens.consume(decoration.approval!.token, { approvalId: ID, owner: "session-1" })).toBe("ok");
  });

  it("only opens the card for a lesson or a team memory: the banner cannot show what would be kept", () => {
    for (const kind of ["lesson", "team-memory"] as const) {
      const { decorate } = decorator({ item: item({ kind }), asked: true });
      expect(decorate(approval, { owner: "session-1" })?.actions, kind).toBeUndefined();
    }
  });

  it("leaves every other banner as it was", () => {
    const { decorate } = decorator({ item: item(), asked: true });
    expect(decorate({ ...approval, kind: "done" }, { owner: "session-1" })).toBeUndefined();
    expect(decorate({ ...approval, kind: "question" }, { owner: "session-1" })).toBeUndefined();
    expect(decorate({ ...approval, requestId: undefined }, { owner: "session-1" })).toBeUndefined();
    expect(decorator(null).decorate(approval, { owner: "session-1" })).toBeUndefined();
  });

  it("keeps a long summary to a couple of sentences", () => {
    const { decorate } = decorator({ item: item({ summary: `${"palavra ".repeat(60)}fim` }), asked: false });
    const body = decorate(approval, { owner: "session-1" })!.body!;
    expect(body.length).toBeLessThan(200);
    expect(body.endsWith("Pediu a Rafael.")).toBe(true);
  });
});
