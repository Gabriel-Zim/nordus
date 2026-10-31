import { describe, expect, it } from "vitest";
import { clockMinutes, DEFAULT_QUIET_HOURS, isQuietHour, notificationRings, parseQuietHours } from "./notification-quiet.ts";

const at = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const night = { enabled: true, start: "22:00", end: "08:00" };

describe("quiet hours", () => {
  it("start off, from 22h to 8h", () => {
    expect(DEFAULT_QUIET_HOURS).toEqual({ enabled: false, start: "22:00", end: "08:00" });
    expect(isQuietHour(DEFAULT_QUIET_HOURS, at("03:00"))).toBe(false);
  });

  it("wrap past midnight and end on the minute they say", () => {
    expect(isQuietHour(night, at("22:00"))).toBe(true);
    expect(isQuietHour(night, at("03:00"))).toBe(true);
    expect(isQuietHour(night, at("07:59"))).toBe(true);
    expect(isQuietHour(night, at("08:00"))).toBe(false);
    expect(isQuietHour(night, at("21:59"))).toBe(false);
    expect(isQuietHour({ enabled: true, start: "13:00", end: "14:00" }, at("13:30"))).toBe(true);
    expect(isQuietHour({ enabled: true, start: "13:00", end: "14:00" }, at("14:30"))).toBe(false);
  });

  it("never silence an approval, a question, a sign-in or a spend alert; the rest waits in the feed", () => {
    for (const kind of ["approval", "question", "sign-in", "spend"] as const) expect(notificationRings(kind, night, at("03:00"))).toBe(true);
    for (const kind of ["done", "turn-failed", "incident", "routine-failed"] as const) {
      expect(notificationRings(kind, night, at("03:00"))).toBe(false);
      expect(notificationRings(kind, night, at("12:00"))).toBe(true);
    }
  });

  it("read the clock in the server's time zone", () => {
    expect(clockMinutes(Date.UTC(2026, 9, 19, 6, 30), "America/Sao_Paulo")).toBe(at("03:30"));
  });

  it("accept only HH:MM times", () => {
    expect(parseQuietHours({ enabled: true, start: "22:00", end: "08:00" })).toEqual(night);
    expect(parseQuietHours({ enabled: true, start: "24:00", end: "08:00" })).toBeNull();
    expect(parseQuietHours({ enabled: "yes", start: "22:00", end: "08:00" })).toBeNull();
    expect(parseQuietHours(null)).toBeNull();
    expect(parseQuietHours({ ...night, timeZone: "America/Sao_Paulo" })).toEqual({ ...night, timeZone: "America/Sao_Paulo" });
    expect(parseQuietHours({ ...night, timeZone: "Mars/Olympus" })).toBeNull();
  });
});
