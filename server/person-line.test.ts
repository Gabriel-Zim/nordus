import { describe, expect, it } from "vitest";

import { ESCALATIONS_THREAD_TITLE, escalationText, type Escalation } from "./escalations.ts";
import { incidentText, retryRefusedForDone, type Incident } from "./incidents.ts";
import { PERSON_LINE_MARKER, PERSON_LINE_MAX, personLineFrom } from "./person-line.ts";

describe("personLineFrom", () => {
  it("is only the line the bot marked for the person", () => {
    expect(personLineFrom("Retomei a conversa da Ada.")).toBeNull();
    expect(personLineFrom(`Vi o problema.\n${PERSON_LINE_MARKER} A Ada precisa que você entre no Gmail de novo.`))
      .toBe("A Ada precisa que você entre no Gmail de novo.");
    expect(personLineFrom("**PARA A PESSOA:** Falta a chave do Drive.")).toBe("Falta a chave do Drive.");
    expect(personLineFrom("Para a pessoa:\nResponda na conversa da Mira.")).toBe("Responda na conversa da Mira.");
    expect(personLineFrom(`${PERSON_LINE_MARKER}   `)).toBeNull();
    expect(personLineFrom(undefined)).toBeNull();
  });

  it("stays one short line however long the answer", () => {
    const long = `${PERSON_LINE_MARKER} ${"A Ada parou porque falta acesso. ".repeat(20)}`;
    const line = personLineFrom(long)!;
    expect(line.length).toBeLessThanOrEqual(PERSON_LINE_MAX);
    expect(line).not.toContain("\n");
  });
});

const incident: Incident = { kind: "failed", bot: { id: "ada", name: "Ada" }, threadId: "t-ada", title: "Notas", detail: "boom" };
const escalation: Escalation = { kind: "raised", bot: { id: "mira", name: "Mira" }, threadId: "t-mira", title: "Deploy", gate: "it raised this flag itself", reason: "falta a chave" };

describe("a Chief's notices", () => {
  it("mark for the person only what needs the person", () => {
    const retry = incidentText(incident, { count: 1, mayRetry: true, muted: false });
    // Only the person-fixable cause is marked; a resumed thread stays a backstage note.
    expect(retry).toContain(`1. If the cause is something only the person can fix (a sign-in, a missing credential, an unanswered question, a setting), write one line starting with "${PERSON_LINE_MARKER}"`);
    expect(retry).toMatch(/3\. Note here[^\n]*the person is not interrupted/);
    expect(incidentText(incident, { count: 3, mayRetry: false, muted: false })).toContain(PERSON_LINE_MARKER);
    expect(incidentText({ ...incident, done: [{ tool: "mcp__zorg__gerar_video", effect: "spend", uncertain: false }] }, { count: 1, mayRetry: true, muted: false })).toContain(PERSON_LINE_MARKER);
    expect(retryRefusedForDone([{ tool: "x", effect: "send", uncertain: false }])).toContain(PERSON_LINE_MARKER);
    const raised = escalationText(escalation, { count: 1, muted: false });
    expect(raised).toContain(`2. Otherwise write one line starting with "${PERSON_LINE_MARKER}"`);
    expect(raised).not.toContain("Report in one sentence what you told the person");
    expect(ESCALATIONS_THREAD_TITLE).toBe("Team escalations");
  });
});
