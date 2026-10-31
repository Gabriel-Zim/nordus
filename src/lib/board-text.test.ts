import { beforeEach, describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import { at, makeBot, makeMission, makeTask, myEmail, person } from "@/testing/board";
import type { Bot } from "@/state/store";
import { makeDirectory } from "./board";
import { clock, daysBetween, dispatchLine, errorText, feedStamp, formatCount, formatUsd, historyLine, missionDay, taskHint, whenText } from "./board-text";

beforeEach(() => setLocale("en"));

const directory = makeDirectory({
  bots: [makeBot("dev", "Dev"), makeBot("atlas", "Atlas")] as unknown as Bot[],
  people: [],
  me: { email: myEmail, name: "Rafael" },
});

describe("clock and days", () => {
  it("writes the time with two digits", () => {
    expect(clock(at(27, 9, 5))).toBe("09:05");
    expect(clock(at(27, 23, 59))).toBe("23:59");
  });

  it("counts calendar days, not 24-hour spans", () => {
    expect(daysBetween(at(27, 23, 59), at(28, 0, 1))).toBe(1);
    expect(daysBetween(at(27, 0, 1), at(27, 23, 59))).toBe(0);
    expect(daysBetween(at(25, 12), at(28, 8))).toBe(3);
  });

  it("numbers mission days from 1, never lower", () => {
    expect(missionDay(at(27, 9, 12), at(27, 9))).toBe(1);
    expect(missionDay(at(28, 8, 5), at(27, 9))).toBe(2);
    expect(missionDay(at(26, 8), at(27, 9))).toBe(1);
  });
});

describe("Day N · time stamps", () => {
  it("shows the first day of a started mission as Day 1 with its clock time", () => {
    const mission = makeMission({ createdAt: at(27, 8, 30), startedAt: at(27, 9) });
    expect(feedStamp(at(27, 9, 12), mission)).toBe("Day 1 · 09:12");
    expect(feedStamp(at(29, 14, 40), mission)).toBe("Day 3 · 14:40");
  });

  it("counts from when the mission was created while it has not started", () => {
    const mission = makeMission({ createdAt: at(27, 8), startedAt: undefined });
    expect(feedStamp(at(28, 7, 1), mission)).toBe("Day 2 · 07:01");
  });
});

describe("when something happened", () => {
  const now = at(27, 15);

  it("says the time today, then yesterday, then the date", () => {
    expect(whenText(at(27, 9, 12), now)).toBe("today at 09:12");
    expect(whenText(at(26, 23), now)).toBe("yesterday");
    expect(whenText(at(20, 10), now)).toMatch(/^on .*20/);
  });

  it("hints at the last move into the column the task is in", () => {
    const moved = makeTask(1, {
      status: "doing",
      history: [
        { at: at(25, 9), by: person, event: "created" },
        { at: at(26, 10), by: person, from: "todo", to: "doing" },
        { at: at(26, 18), by: person, from: "doing", to: "review" },
        { at: at(27, 9, 12), by: person, from: "review", to: "doing" },
      ],
    });
    expect(taskHint(moved, now)).toBe("Started today at 09:12");
    expect(taskHint(makeTask(2, { createdAt: at(26, 9) }), now)).toBe("Created yesterday");
    expect(taskHint(makeTask(3, { status: "review", history: [{ at: at(27, 10, 3), by: person, from: "doing", to: "review" }] }), now)).toBe("Sent to review today at 10:03");
    expect(taskHint(makeTask(4, { status: "done", updatedAt: at(27, 11) }), now)).toBe("Done today at 11:00");
  });
});

describe("history lines", () => {
  it("tells each kind of event with who did it", () => {
    const by = { kind: "bot", id: "dev" } as const;
    expect(historyLine({ at: 1, by: person, event: "created" }, directory)).toBe("You created the task");
    expect(historyLine({ at: 1, by, event: "assigned", assignee: "atlas" }, directory)).toBe("Dev passed it to Atlas");
    expect(historyLine({ at: 1, by, event: "assigned" }, directory)).toBe("Dev took off the assignee");
    expect(historyLine({ at: 1, by, event: "unassigned" }, directory)).toBe("Dev took off the assignee");
    expect(historyLine({ at: 1, by, event: "edited" }, directory)).toBe("Dev edited the task");
    expect(historyLine({ at: 1, by, event: "sent" }, directory)).toBe("Dev sent the task to the agent");
    expect(historyLine({ at: 1, by: person, from: "todo", to: "doing" }, directory)).toBe("You moved it from To do to In progress");
    expect(historyLine({ at: 1, by: person, to: "done" }, directory)).toBe("You moved it to Done");
    expect(historyLine({ at: 1, by: person }, directory)).toBe("You updated the task");
  });
});

describe("what happened to the agent that got the task", () => {
  it("reports sent, queued and skipped in plain words", () => {
    expect(dispatchLine({ dispatch: { status: "sent" } }, "Dev")).toBe("Sent to Dev");
    expect(dispatchLine({ dispatch: { status: "queued" } }, "Dev")).toBe("In Dev's queue");
    expect(dispatchLine({ dispatch: { status: "skipped", reason: "Dev is offline" } }, "Dev")).toBe("Could not tell Dev: Dev is offline");
    expect(dispatchLine({ dispatch: { status: "skipped" } }, "Dev")).toBe("Could not tell Dev");
    expect(dispatchLine({}, "Dev")).toBeNull();
  });
});

describe("error text and numbers", () => {
  it("falls back to a plain line when the error has no words", () => {
    expect(errorText(new Error("Task not found"))).toBe("Task not found");
    expect(errorText("Plain string")).toBe("Plain string");
    expect(errorText(new Error("   "))).toBe("Something went wrong. Try again.");
    expect(errorText(undefined)).toBe("Something went wrong. Try again.");
    expect(errorText(new Error("Failed to fetch"))).toBe(t("error.plain.unreachable"));
  });

  it("formats counts and dollars for the language in use", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});
