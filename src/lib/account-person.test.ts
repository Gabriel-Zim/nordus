import { describe, expect, it } from "vitest";
import { accountBackPhrase, accountPersonName, accountText, spokenHour } from "@/lib/account-person";

const acc = (displayName: string, email?: string) => ({ displayName, ...(email ? { snapshot: { account: { email } } } : {}) });

describe("accountPersonName", () => {
  it("takes the person from parentheses or after the engine name", () => {
    expect(accountPersonName(acc("Claude (Jordan)"))).toBe("Jordan");
    expect(accountPersonName(acc("Claude · Avery"))).toBe("Avery");
    expect(accountPersonName(acc("Codex Jordan"))).toBe("Jordan");
    expect(accountPersonName(acc("Jordan"))).toBe("Jordan");
  });
  it("falls back to the e-mail when only the engine is named", () => {
    expect(accountPersonName(acc("Claude", "a@b.com"))).toBe("a@b.com");
    expect(accountPersonName(acc("Claude edit", "a@b.com"))).toBe("a@b.com");
    expect(accountPersonName(acc("Claude"))).toBe("Claude");
  });
  it("builds the labelled text", () => {
    expect(accountText(acc("Claude (Jordan)"))).toMatch(/: Jordan$/);
  });
});

// 2026-10-22 12:00 in Brasilia (UTC-3)
const now = Date.parse("2026-10-22T15:00:00Z");
describe("accountBackPhrase", () => {
  it("speaks the hour", () => {
    expect(spokenHour(Date.parse("2026-10-22T18:40:00Z"))).toBe("15h40");
    expect(spokenHour(Date.parse("2026-10-22T12:00:00Z"))).toBe("9h");
    expect(spokenHour(Date.parse("2026-10-23T03:00:00Z"))).toBe("0h");
  });
  it("says today, tomorrow and another date", () => {
    expect(accountBackPhrase("2026-10-22T18:40:00Z", now)).toBe("Volta às 15h40, a fila espera.");
    expect(accountBackPhrase("2026-10-23T12:00:00Z", now)).toBe("Volta amanhã às 9h, a fila espera.");
    expect(accountBackPhrase("2026-10-27T12:00:00Z", now)).toBe("Volta em 27/10 às 9h, a fila espera.");
  });
  it("uses the Brasilia day, not UTC", () => {
    // 02:30 UTC on the 23rd is 23:30 on the 22nd in Brasilia: still today
    expect(accountBackPhrase("2026-10-23T02:30:00Z", now)).toBe("Volta às 23h30, a fila espera.");
  });
  it("returns null for past or missing times", () => {
    expect(accountBackPhrase(null, now)).toBeNull();
    expect(accountBackPhrase(now - 1, now)).toBeNull();
    expect(accountBackPhrase("nope", now)).toBeNull();
  });
});
