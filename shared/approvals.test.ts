import { describe, expect, it } from "vitest";

import {
  ADMINS_LABEL, APPROVAL_TTL_MS, approvalCopy, approvalDeadline, approvalId, approvalRisk, decidableOutsideCard, decidedInList, expiresAfterWaiting,
  nameFromEmail, parseApprovalId, waitLeft, waitingKind,
} from "./approvals.ts";
import type { OptionCardData, WireMessage } from "./wire.ts";

const card = (extra: Partial<OptionCardData> = {}): OptionCardData => ({
  title: "Permission",
  subtitle: "echo hi",
  options: ["Allow", "Deny"],
  requestId: "req-1",
  tool: "bash",
  ...extra,
});
const options = (extra: Partial<OptionCardData> = {}, at = 1_000): Pick<WireMessage, "kind" | "card" | "at"> => ({ kind: "options", card: card(extra), at });

describe("what waits on a person", () => {
  it.each([
    ["a tool permission", {}, "permission"],
    ["a request to another agent", { tool: "ask_bot" }, "peer"],
    ["a request to hand work over", { tool: "delegate_bot" }, "peer"],
    ["a message to a room", { tool: "post_to_room" }, "peer"],
    ["something to send in the person's name", { outboundRequest: { app: "Gmail", calls: [] } as never }, "outbound"],
    ["a proposed lesson", { lessonRequest: { lesson: "Ask before deleting" } }, "lesson"],
    ["a note for the team memory", { teamMemoryRequest: { section: "Rules" } as never }, "team-memory"],
    ["a question", { requestType: "question" as never }, "question"],
    ["a proposed skill", { skillRequest: { name: "Brief" } as never }, "skill"],
    ["a proposed routine", { routineRequest: {} as never }, "routine"],
    ["a profile change", { profileRequest: {} as never }, "profile"],
    ["a helper", { mcpServerRequest: { serverName: "files" } as never }, "helper"],
  ] as const)("calls %s %s", (_what, extra, kind) => {
    expect(waitingKind(options(extra as Partial<OptionCardData>))).toBe(kind);
  });

  it("calls nothing waiting once the card is answered, dismissed, run out or applied by itself", () => {
    for (const settled of [{ answered: "allow" as const }, { dismissed: true as const }, { expired: true as const }, { autoApplied: true as const }]) {
      expect(waitingKind(options(settled as Partial<OptionCardData>))).toBeNull();
    }
    expect(waitingKind({ kind: "options", card: card({ requestId: undefined }), at: 1 })).toBeNull();
    expect(waitingKind({ kind: "text", at: 1 })).toBeNull();
  });

  it("counts a sign-in, a key and an app connection until they are done", () => {
    expect(waitingKind({ kind: "signin", signIn: { site: "x.com", url: "https://x.com" } as never, at: 1 })).toBe("sign-in");
    expect(waitingKind({ kind: "signin", signIn: { site: "x.com", done: true } as never, at: 1 })).toBeNull();
    expect(waitingKind({ kind: "secret", secret: { label: "Key", provided: false } as never, at: 1 })).toBe("credential");
    expect(waitingKind({ kind: "secret", secret: { label: "Key", provided: true } as never, at: 1 })).toBeNull();
    expect(waitingKind({ kind: "connector", connector: { label: "Gmail", status: "needed" } as never, at: 1 })).toBe("connector");
    expect(waitingKind({ kind: "connector", connector: { label: "Gmail", status: "connected" } as never, at: 1 })).toBeNull();
  });

  it("decides only plain yes-or-no cards in the list, and lets only the ones that wait on a live request run out", () => {
    for (const kind of ["permission", "peer", "outbound", "lesson", "team-memory"] as const) expect(decidedInList(kind), kind).toBe(true);
    for (const kind of ["skill", "routine", "profile", "question", "sign-in", "credential", "connector"] as const) expect(decidedInList(kind), kind).toBe(false);
    expect(expiresAfterWaiting("permission")).toBe(true);
    expect(expiresAfterWaiting("outbound")).toBe(true);
    expect(expiresAfterWaiting("lesson")).toBe(false);
    expect(expiresAfterWaiting("skill")).toBe(false);
  });
});

describe("how risky a card is", () => {
  it("holds an action the safety floor holds back, and an outbound send, and anything that deploys", () => {
    expect(approvalRisk(card({ heldCode: "approval.held.sensitive" }))).toBe("critical");
    expect(approvalRisk(card({ heldCode: "approval.held.outbound" }))).toBe("critical");
    expect(approvalRisk(card({ heldCode: "approval.held.sandbox" }))).toBe("critical");
    expect(approvalRisk(card({ outboundRequest: { app: "Gmail", calls: [] } as never }))).toBe("critical");
    expect(approvalRisk(card({ tool: "bash", subtitle: "git push origin main" }))).toBe("critical");
    expect(approvalRisk(card({ tool: "bash", subtitle: "rm -rf /" }))).toBe("critical");
  });

  it("leaves a plain permission, a peer request and no card at one click", () => {
    expect(approvalRisk(card())).toBe("normal");
    expect(approvalRisk(card({ tool: "ask_bot", subtitle: "git push origin main" }))).toBe("normal");
    expect(approvalRisk(undefined)).toBe("normal");
  });
});

describe("the deadline", () => {
  it("is the stamp on the card, else its age plus the wait everyone gets", () => {
    expect(approvalDeadline(options({}, 5_000), APPROVAL_TTL_MS)).toBe(5_000 + APPROVAL_TTL_MS);
    expect(approvalDeadline(options({ approval: { expiresAt: 9_999 } }, 5_000), APPROVAL_TTL_MS)).toBe(9_999);
  });

  it("does not exist for a card that does not run out or is not waiting", () => {
    expect(approvalDeadline(options({ lessonRequest: { lesson: "x" } }), APPROVAL_TTL_MS)).toBeUndefined();
    expect(approvalDeadline(options({ answered: "allow" }), APPROVAL_TTL_MS)).toBeUndefined();
  });

  it("counts down in hours, then minutes, and ends at zero", () => {
    expect(waitLeft(1_000 + 13 * 3_600_000, 1_000)).toEqual({ hours: 13, minutes: 0 });
    expect(waitLeft(1_000 + 90 * 60_000, 1_000)).toEqual({ hours: 1, minutes: 30 });
    expect(waitLeft(1_000 + 40 * 60_000 - 10, 1_000)).toEqual({ hours: 0, minutes: 40 });
    expect(waitLeft(1_000 + 5, 1_000)).toEqual({ hours: 0, minutes: 1 });
    expect(waitLeft(1_000, 1_000)).toBeNull();
    expect(waitLeft(500, 1_000)).toBeNull();
  });
});

describe("the card in plain words", () => {
  it("names who asks, what is asked, and the facts a person decides on", () => {
    const copy = approvalCopy(
      options({ intent: "Voltar produção para a v2.14.3", explanation: "Desfaz o deploy das 14h02.", tool: "mcp__render__rollback", subtitle: "service=api version=v2.14.3" }),
      "Atlas",
      "Rafael",
    );
    expect(copy.title).toBe("Atlas quer voltar produção para a v2.14.3");
    expect(copy.summary).toBe("Desfaz o deploy das 14h02.");
    expect(copy.fields.map((field) => [field.code, field.label])).toEqual([
      ["action", "Ação"], ["service", "Serviço"], ["detail", "Detalhe"], ["decider", "Quem decide"],
    ]);
    expect(copy.fields.find((field) => field.code === "action")?.value).toBe("Voltar produção para a v2.14.3");
    expect(copy.fields.find((field) => field.code === "service")?.value).toBe("Render");
    expect(copy.fields.at(-1)).toMatchObject({ code: "decider", value: "Rafael" });
  });

  it("falls back to the tool when the agent gave no reason of its own", () => {
    const copy = approvalCopy(options({ tool: "bash", subtitle: "echo hi" }), "Atlas", ADMINS_LABEL);
    expect(copy.title).toBe("Atlas pede para usar bash");
    expect(copy.fields.find((field) => field.code === "service")?.value).toBe("Terminal");
    expect(copy.fields.at(-1)).toMatchObject({ label: "Quem decide", value: ADMINS_LABEL });
  });

  it("says why a held action stopped, by the catalog key the client translates", () => {
    const copy = approvalCopy(options({ held: "Always asks first.", heldCode: "approval.held.sensitive" }), "Atlas", ADMINS_LABEL);
    expect(copy.fields.find((field) => field.code === "why")).toMatchObject({ value: "Always asks first.", valueCode: "approval.held.sensitive" });
  });

  it("says a send that runs code runs code, not that it only sends", () => {
    const outbound = { tool: "COMPOSIO_PROXY_EXECUTE", app: "Composio", calls: [] } as never;
    const run = approvalCopy(options({ tool: "COMPOSIO_PROXY_EXECUTE", held: "Sends something.", heldCode: "approval.held.outbound", outboundRequest: outbound }), "Atlas", ADMINS_LABEL);
    expect(run.fields.find((field) => field.code === "why")).toMatchObject({ valueCode: "approval.opaqueCode" });
    const send = approvalCopy(options({ tool: "SLACK_SEND_MESSAGE", held: "Sends something.", heldCode: "approval.held.outbound", outboundRequest: { tool: "SLACK_SEND_MESSAGE", app: "Slack", calls: [] } as never }), "Atlas", ADMINS_LABEL);
    expect(send.fields.find((field) => field.code === "why")).toMatchObject({ valueCode: "approval.held.outbound" });
  });

  it("gives a lesson from a refusal its own headline and origin", () => {
    const copy = approvalCopy(
      options({ lessonRequest: { lesson: "Marina recusou publicar: falta revisar." }, tool: "propose_lesson", approval: { fromRefusal: true } }),
      "Atlas",
      ADMINS_LABEL,
    );
    expect(copy.title).toBe("Atlas propõe uma lição a partir da sua recusa");
    expect(copy.fields.map((field) => field.code)).toEqual(["lesson", "origin", "decider"]);
  });

  it("gives each non-card kind a headline too", () => {
    expect(approvalCopy({ kind: "signin", signIn: { site: "Notion", url: "https://notion.so" } as never, at: 1 }, "Atlas", ADMINS_LABEL).title)
      .toBe("Atlas precisa que você entre em Notion");
    expect(approvalCopy({ kind: "secret", secret: { label: "Chave da API", description: "Para enviar", envName: "API_KEY" } as never, at: 1 }, "Atlas", ADMINS_LABEL).title)
      .toBe("Atlas precisa de uma chave: Chave da API");
    expect(approvalCopy({ kind: "connector", connector: { label: "Gmail", description: "Para ler e-mails" } as never, at: 1 }, "Atlas", ADMINS_LABEL).title)
      .toBe("Atlas precisa que você conecte Gmail");
  });

  it("keeps each field code to one meaning, so a translated label never overrides a different one", () => {
    const seen = new Map<string, Set<string>>();
    const cases: Array<Pick<WireMessage, "kind" | "card" | "signIn" | "secret" | "connector" | "at">> = [
      options({ intent: "Rodar", tool: "bash" }),
      options({ skillRequest: { name: "Resumo", gist: "x" } as never }),
      options({ mcpServerRequest: { serverName: "files" } as never }),
      options({ teamMemoryRequest: { section: "Regras" } as never }),
      options({ lessonRequest: { lesson: "x", client: "Acme" } }),
      { kind: "signin", signIn: { site: "Notion", url: "https://notion.so" } as never, at: 1 },
      { kind: "secret", secret: { label: "Chave", description: "d", envName: "KEY" } as never, at: 1 },
      { kind: "connector", connector: { label: "Gmail", description: "d" } as never, at: 1 },
    ];
    for (const message of cases) {
      for (const field of approvalCopy(message, "Atlas", ADMINS_LABEL).fields) {
        if (!field.code) continue;
        seen.set(field.code, (seen.get(field.code) ?? new Set()).add(field.label));
      }
    }
    for (const [code, labels] of seen) expect([...labels], code).toHaveLength(1);
  });
});

describe("deciding without opening the card", () => {
  const item = { kind: "permission", canDecide: true, action: "decide", risk: "normal", requestId: "req-1" } as const;

  it("lets the list and a banner decide a plain request the person may answer", () => {
    expect(decidableOutsideCard(item, "list")).toBe(true);
    expect(decidableOutsideCard(item, "banner")).toBe(true);
  });

  it("lets the list, but never a banner, decide a critical action: it is held to approve on its card", () => {
    const critical = { ...item, risk: "critical" } as const;
    expect(decidableOutsideCard(critical, "list")).toBe(true);
    expect(decidableOutsideCard(critical, "banner")).toBe(false);
  });

  it("lets the list, but never a banner, decide a lesson or a team memory: their text is read before answering", () => {
    for (const kind of ["lesson", "team-memory"] as const) {
      expect(decidableOutsideCard({ ...item, kind }, "list"), `${kind} list`).toBe(true);
      expect(decidableOutsideCard({ ...item, kind }, "banner"), `${kind} banner`).toBe(false);
    }
    expect(decidableOutsideCard({ ...item, kind: "peer" }, "banner")).toBe(true);
  });

  it("lets neither decide what the person may not answer, what has to be read first, or what has no request to answer", () => {
    for (const surface of ["list", "banner"] as const) {
      expect(decidableOutsideCard({ ...item, canDecide: false }, surface), `${surface} not allowed`).toBe(false);
      expect(decidableOutsideCard({ ...item, action: "open" }, surface), `${surface} open`).toBe(false);
      expect(decidableOutsideCard({ ...item, requestId: undefined }, surface), `${surface} no request`).toBe(false);
    }
  });
});

describe("ids and names", () => {
  it("round-trips an approval id and refuses one that is not", () => {
    const id = approvalId("thread-1", "msg-9");
    expect(id).toBe("thread-1.msg-9");
    expect(parseApprovalId(id)).toEqual({ threadId: "thread-1", messageId: "msg-9" });
    for (const bad of ["", "thread-1", "a.b.c", "../x.y", "a b.c", "a.b/c"]) expect(parseApprovalId(bad), bad).toBeNull();
  });

  it("reads a name off an address", () => {
    expect(nameFromEmail("marina.souza@example.com")).toBe("Marina Souza");
    expect(nameFromEmail("rafael@example.com")).toBe("Rafael");
    expect(nameFromEmail("ana_maria-lima@x.io")).toBe("Ana Maria Lima");
  });
});
