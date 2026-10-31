import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { setLocale, t } from "@/lib/i18n";
import { foldHandoffs, handoffKind, handoffLabel, handoffLine } from "./handoff-label";

beforeEach(() => setLocale("pt-br"));
afterEach(() => setLocale("en"));

const toDesignerGrafico = (id: string, name: string, threadId = "designergrafico-work"): Message => ({
  id, at: 1, role: "bot", kind: "activity", tool: { name, ok: true },
  threadRef: { botId: "designergrafico", threadId, title: "@LUMON · work" },
});
const person = (id: string): Message => ({ id, at: 1, role: "user", kind: "text", text: "pede isso" });

const FAMILY = [
  "Sent to DESIGNERGRAFICO",
  "Sent to DESIGNERGRAFICO · Sala",
  "DESIGNERGRAFICO replied",
  "DESIGNERGRAFICO replied · Sala",
  "DESIGNERGRAFICO needs your input: qual fonte uso na capa?",
  "DESIGNERGRAFICO — failed: o motor caiu",
  "DESIGNERGRAFICO — cancelled: pedido retirado",
  "DESIGNERGRAFICO — queued: na fila",
  "DESIGNERGRAFICO was cut off by a restart; resuming",
  "Result withheld: team access changed",
  "Waiting on your answer in @DESIGNERGRAFICO",
  "Waiting on your approval in @DESIGNERGRAFICO",
  "Nobody answered @DESIGNERGRAFICO's question in time",
  "Nobody answered @DESIGNERGRAFICO's approval in time — that step did not run",
  "@DESIGNERGRAFICO's turn ended before anyone answered its question",
  "@DESIGNERGRAFICO's approval closed before anyone answered — that step did not run",
  "@DESIGNERGRAFICO's question was dismissed",
  "@DESIGNERGRAFICO's request was denied",
  "@DESIGNERGRAFICO got your answer",
  "@DESIGNERGRAFICO got your approval",
  "@DESIGNERGRAFICO's question was answered",
  "@DESIGNERGRAFICO's request was approved",
];

describe("handoffLabel", () => {
  it.each(FAMILY)("speaks Portuguese for %s, without a long dash or English words", (name) => {
    const label = handoffLabel(name);
    expect(label).not.toBe(name);
    expect(label).toContain(name.includes("withheld") ? "team access changed" : "DESIGNERGRAFICO");
    expect(label).not.toContain("—");
    expect(label).not.toMatch(/\b(Sent|replied|needs|failed|cancelled|Nobody|Waiting|got your|was cut off|withheld|turn ended)\b/);
  });

  it("keeps the detail the server gave", () => {
    expect(handoffLabel("DESIGNERGRAFICO needs your input: aprovação do orçamento")).toBe("DESIGNERGRAFICO precisa de você: aprovação do orçamento");
    expect(handoffLabel("DESIGNERGRAFICO — failed: o motor caiu")).toBe("DESIGNERGRAFICO falhou: o motor caiu");
    expect(handoffLabel("DESIGNERGRAFICO — running: ainda")).toBe("DESIGNERGRAFICO parou: ainda");
  });

  it("does not read a question or a status that mentions 'replied' as a reply", () => {
    expect(handoffLabel("DESIGNERGRAFICO needs your input: ele replied?")).toBe("DESIGNERGRAFICO precisa de você: ele replied?");
    expect(handoffLabel("DESIGNERGRAFICO — failed: nobody replied")).toBe("DESIGNERGRAFICO falhou: nobody replied");
  });

  it("leaves the other thread rows as they were", () => {
    expect(handoffLabel("Opened thread #T on DESIGNERGRAFICO")).toBe(t("handoff.openedThreadOn", { title: "T", name: "DESIGNERGRAFICO" }));
    expect(handoffLabel("Posted in Sala")).toBe(t("handoff.posted", { room: "Sala" }));
    expect(handoffLabel("Something else")).toBe("Something else");
  });
});

describe("handoffKind", () => {
  it("sorts the family into going out and coming back", () => {
    expect(handoffKind("Sent to DESIGNERGRAFICO")).toBe("sent");
    for (const name of FAMILY.filter((entry) => !entry.startsWith("Sent to"))) expect(handoffKind(name)).toBe("back");
  });

  it("is null for rows that are not a hand-off between bots", () => {
    for (const name of ["Opened thread #T", "Opened thread #T on DESIGNERGRAFICO", "Incident: bot down", "Posted in Sala", "Read file"]) {
      expect(handoffKind(name)).toBeNull();
    }
  });
});

describe("handoffLine", () => {
  it("names who the conversation is with, never what the last line said", () => {
    expect(handoffLine("Sent to DESIGNERGRAFICO", 1, "DESIGNERGRAFICO")).toBe("Mensagem para DESIGNERGRAFICO");
    expect(handoffLine("DESIGNERGRAFICO needs your input: x", 1, "DESIGNERGRAFICO")).toBe("Mensagem de DESIGNERGRAFICO");
    expect(handoffLine("DESIGNERGRAFICO — failed: x", 3, "DESIGNERGRAFICO")).toBe("3 mensagens com DESIGNERGRAFICO");
  });
});

describe("foldHandoffs", () => {
  const transcript = (): Message[] => [
    person("ask"),
    toDesignerGrafico("sent", "Sent to DESIGNERGRAFICO"),
    toDesignerGrafico("other", "Sent to DESIGNERGRAFICO", "designergrafico-other"),
    ...[1, 2, 3, 4, 5].map((n) => toDesignerGrafico(`needs${n}`, "DESIGNERGRAFICO needs your input: aprovação")),
    ...[1, 2, 3].map((n) => toDesignerGrafico(`failed${n}`, "DESIGNERGRAFICO — failed: caiu")),
  ];

  it("turns one conversation's lines into one, counted, at the newest line", () => {
    const { counts, folded } = foldHandoffs(transcript());
    expect(counts.get("failed3")).toBe(9);
    expect(counts.get("other")).toBe(1);
    expect([...folded].sort()).toEqual(["failed1", "failed2", "needs1", "needs2", "needs3", "needs4", "needs5", "sent"].sort());
  });

  it("starts over after each message from the person", () => {
    const rows: Message[] = [];
    for (const n of [1, 2, 3, 4]) rows.push(person(`ask${n}`), toDesignerGrafico(`out${n}`, "Sent to DESIGNERGRAFICO"), toDesignerGrafico(`back${n}`, "DESIGNERGRAFICO replied"));
    const { counts, folded } = foldHandoffs(rows);
    expect([...counts.entries()]).toEqual([["back1", 2], ["back2", 2], ["back3", 2], ["back4", 2]]);
    expect([...folded]).toEqual(["out1", "out2", "out3", "out4"]);
  });

  it("counts the waiting-on-you lines with the rest of the conversation", () => {
    const { counts } = foldHandoffs([toDesignerGrafico("a", "Sent to DESIGNERGRAFICO"), toDesignerGrafico("b", "Waiting on your answer in @DESIGNERGRAFICO"), toDesignerGrafico("c", "@DESIGNERGRAFICO got your answer")]);
    expect(counts.get("c")).toBe(3);
  });

  it("keys a room conversation by room, thread and bot", () => {
    const comm = (id: string, name: string, groupId: string, withBotId: string): Message => ({
      id, at: 1, role: "bot", kind: "activity", tool: { name, ok: true },
      comm: { groupId, threadId: "t", withBotId, withName: "DESIGNERGRAFICO", withColor: "green" },
    });
    const { counts } = foldHandoffs([comm("a", "Sent to DESIGNERGRAFICO · Sala", "room", "designergrafico"), comm("b", "DESIGNERGRAFICO replied · Sala", "room", "designergrafico"), comm("c", "DESIGNERGRAFICO replied · Sala", "room", "assistentefinanceiro")]);
    expect([...counts.entries()]).toEqual([["b", 2], ["c", 1]]);
  });

  it("leaves the task card, the incident chip, and plain tool lines alone", () => {
    const { counts, folded } = foldHandoffs([
      toDesignerGrafico("card1", "Opened thread #T"),
      toDesignerGrafico("card2", "Opened thread #T"),
      toDesignerGrafico("incident", "Incident: bot down"),
      { id: "tool", at: 1, role: "bot", kind: "activity", tool: { name: "Read file", ok: true } },
    ]);
    expect(counts.size).toBe(0);
    expect(folded.size).toBe(0);
  });

  it("unites the files of the folded lines, each path once, under the newest line", () => {
    const withFiles = (id: string, name: string, paths: string[]): Message =>
      ({ ...toDesignerGrafico(id, name), attachments: paths.map((path) => ({ kind: "image" as const, path, mime: "image/png" })) });
    const { attachments } = foldHandoffs([toDesignerGrafico("a", "Sent to DESIGNERGRAFICO"), withFiles("b", "DESIGNERGRAFICO replied", ["x.png", "y.png"]), withFiles("c", "DESIGNERGRAFICO replied", ["y.png", "z.png"])]);
    expect([...attachments.keys()]).toEqual(["c"]);
    expect(attachments.get("c")!.map((line) => [line.messageId, line.attachments.map((file) => file.path)])).toEqual([["b", ["x.png", "y.png"]], ["c", ["z.png"]]]);
  });

  it("has no attachments entry when no folded line carries a file", () => {
    expect(foldHandoffs([toDesignerGrafico("a", "Sent to DESIGNERGRAFICO"), toDesignerGrafico("b", "DESIGNERGRAFICO replied")]).attachments.size).toBe(0);
  });
});
