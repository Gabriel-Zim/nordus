import { describe, expect, it } from "vitest";
import { BOARD_LIMITS } from "../../shared/board";
import { TITLE_FROM_MESSAGE_CHARS, draftFromMessage, requestBoardFocus, takeBoardFocus, type MessageTask } from "./board-compose";

const message = (text: string, extra: Partial<MessageTask> = {}): MessageTask => ({ threadId: "t1", messageId: "m1", text, ...extra });

describe("a task drafted from a message", () => {
  it("uses a short one-line message as the title and leaves the description empty", () => {
    expect(draftFromMessage(message("Send the report to Ana"))).toMatchObject({ title: "Send the report to Ana", description: "" });
  });

  it("uses the first line as the title and everything after it as the description", () => {
    const draft = draftFromMessage(message("Prepare the launch\nDetails: banner, email\n\nThanks"));
    expect(draft.title).toBe("Prepare the launch");
    expect(draft.description).toBe("Details: banner, email\n\nThanks");
  });

  it("skips blank lines before the first words and strips markdown marks from the title", () => {
    expect(draftFromMessage(message("\n\n  \n## **Plan** the week\n- one\n- two"))).toMatchObject({ title: "Plan the week", description: "- one\n- two" });
    expect(draftFromMessage(message("> quoted line")).title).toBe("quoted line");
    expect(draftFromMessage(message("1. First thing")).title).toBe("First thing");
  });

  it("cuts a long first line at a word and sends the rest to the description", () => {
    const words = Array.from({ length: 25 }, (_, index) => `word${String(index).padStart(2, "0")}`);
    const draft = draftFromMessage(message(`${words.join(" ")}\nSecond line`));
    expect(draft.title).toBe(`${words.slice(0, 17).join(" ")}…`);
    expect(draft.title.length).toBeLessThanOrEqual(TITLE_FROM_MESSAGE_CHARS + 1);
    expect(draft.description).toBe(`${words.slice(17).join(" ")}\nSecond line`);
  });

  it("cuts at the limit when a long line has no word to cut at", () => {
    const draft = draftFromMessage(message("x".repeat(200)));
    expect(draft.title).toBe(`${"x".repeat(TITLE_FROM_MESSAGE_CHARS)}…`);
    expect(draft.description).toBe("x".repeat(80));
  });

  it("never lets the description pass what the board accepts", () => {
    expect(draftFromMessage(message(`Title\n${"y".repeat(BOARD_LIMITS.description + 1_000)}`)).description).toHaveLength(BOARD_LIMITS.description);
  });

  it("leaves an empty message with an empty draft", () => {
    expect(draftFromMessage(message("  \n "))).toMatchObject({ title: "", description: "" });
  });

  it("remembers where the task came from, naming the room only when there is one", () => {
    expect(draftFromMessage(message("Hi")).source).toStrictEqual({ threadId: "t1", messageId: "m1" });
    expect(draftFromMessage(message("Hi", { groupId: "g1" })).source).toStrictEqual({ threadId: "t1", groupId: "g1", messageId: "m1" });
  });
});

describe("asking the board to open on something", () => {
  it("hands the request over once", () => {
    requestBoardFocus({ taskId: 7 });
    expect(takeBoardFocus()).toEqual({ taskId: 7 });
    expect(takeBoardFocus()).toBeNull();
  });
});
