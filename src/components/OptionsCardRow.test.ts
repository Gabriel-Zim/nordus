import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StoreProvider, type Message } from "@/state/store";
import { optionsCardRow } from "./OptionsCardRow";

const quiz: Message = { id: "quiz", role: "bot", kind: "options", at: 1, card: { title: "What do you mostly want help with?", subtitle: "Pick whatever's closest.", options: ["Work & projects"] } };
const said: Message = { id: "u1", role: "user", kind: "text", at: 2, text: "Hi" };
const row = (message: Message, transcript: Message[]) => optionsCardRow({ message, transcript, botId: "atlas", botName: "Atlas", threadId: "t1" });
const markup = (message: Message, transcript: Message[]) => renderToStaticMarkup(createElement(StoreProvider, null, row(message, transcript)));

describe("optionsCardRow", () => {
  it("is no row at all once the person has talked past the first-run quiz", () => {
    expect(row(quiz, [quiz, said])).toBeNull();
    expect(row({ ...quiz, card: { ...quiz.card!, dismissed: true } }, [quiz])).toBeNull();
  });

  it("draws a waiting approval as a card, keeps an answered one as a record, and drops a stale one", () => {
    const approval = (card: Partial<NonNullable<Message["card"]>>): Message => ({
      id: "approval", role: "bot", kind: "options", at: 4,
      card: { title: "Approval needed", subtitle: "git status", options: ["Allow", "Deny"], requestId: "r2", tool: "Bash", ...card },
    });
    const waiting = markup(approval({}), [approval({})]);
    expect(waiting).toContain("Atlas asks for your approval");
    expect(waiting).toContain("Allow once");
    expect(markup(approval({ answered: "allow" }), [])).toContain("You allowed");
    expect(row(approval({ expired: true }), [])).toBeNull();
    expect(row(approval({ answered: "unavailable", dismissed: true }), [])).toBeNull();
  });

  it("draws nothing for a card asked in words, waiting or answered: the question and the answer are the conversation", () => {
    const asked: Message = {
      id: "asked", role: "bot", kind: "options", at: 5,
      card: { title: "Approval needed", subtitle: "git push", options: ["Allow", "Deny"], requestId: "r3", tool: "Bash", byText: true },
    };
    expect(row(asked, [asked])).toBeNull();
    expect(row({ ...asked, card: { ...asked.card!, answered: "allow" } }, [asked])).toBeNull();
  });

  it("draws the list card for a quiz still waiting, and the question card for a structured ask", () => {
    expect(markup(quiz, [quiz])).toContain("What do you mostly want help with?");
    const ask: Message = {
      id: "ask", role: "bot", kind: "options", at: 3,
      card: { title: "Your bot has a question", subtitle: "Which region?", options: [], requestId: "r1", questionRequest: { version: 1, questions: [{ question: "Which region?", options: [{ label: "us-east-1" }, { label: "eu-west-1" }] }] } },
    };
    const drawn = markup(ask, [quiz, said, ask]);
    expect(drawn).toContain('data-ask-card="pending"');
    expect(drawn).toContain("eu-west-1");
  });
});
