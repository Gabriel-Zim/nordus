import { describe, expect, it } from "vitest";
import { formatListDate } from "./list-date";

const now = new Date(2026, 9, 22, 15, 0).getTime();

describe("formatListDate", () => {
  it("reads the clock today", () => expect(formatListDate(new Date(2026, 9, 22, 14, 5).getTime(), now, "pt-br")).toBe("14:05"));
  it("says yesterday in the app's language", () => expect(formatListDate(new Date(2026, 9, 21, 23, 0).getTime(), now, "pt-br")).toBe("ontem"));
  it("gives the short weekday within a week", () => expect(formatListDate(new Date(2026, 9, 19, 9, 0).getTime(), now, "pt-br")).toMatch(/^seg/));
  it("gives day and short month after that, not the browser's English", () => {
    expect(formatListDate(new Date(2026, 9, 10, 9, 0).getTime(), now, "pt-br")).toMatch(/^10 out/);
  });
});
