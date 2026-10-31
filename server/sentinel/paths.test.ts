import { describe, expect, it } from "vitest";

import { defaultSentinelOut, isInside } from "./paths.ts";

describe("sentinel paths", () => {
  it("keeps Sentinel's files in the platform's state folder, outside the data dir", () => {
    expect(defaultSentinelOut("/Users/nordus/.nordus", "darwin", "/Users/nordus", {})).toBe("/Users/nordus/Library/Application Support/nordus-sentinel");
    expect(defaultSentinelOut("/home/nordus/.nordus", "linux", "/home/nordus", {})).toBe("/home/nordus/.local/state/nordus-sentinel");
    expect(defaultSentinelOut("/home/nordus/.nordus", "linux", "/home/nordus", { XDG_STATE_HOME: "/var/state/nordus" })).toBe("/var/state/nordus/nordus-sentinel");
    // a relative XDG_STATE_HOME is invalid by the spec and ignored
    expect(defaultSentinelOut("/home/nordus/.nordus", "linux", "/home/nordus", { XDG_STATE_HOME: "state" })).toBe("/home/nordus/.local/state/nordus-sentinel");
    expect(defaultSentinelOut("C:\\Users\\nordus\\.nordus", "win32", "C:\\Users\\nordus", { LOCALAPPDATA: "D:\\Local" })).toBe("D:\\Local\\nordus-sentinel");
  });

  it("gives any other data dir its own subfolder, the same one every time", () => {
    const other = defaultSentinelOut("/srv/nordus-data", "linux", "/home/nordus", {});
    expect(other).toMatch(/^\/home\/nordus\/\.local\/state\/nordus-sentinel\/data-[0-9a-f]{12}$/);
    expect(defaultSentinelOut("/srv/nordus-data", "linux", "/home/nordus", {})).toBe(other);
    expect(defaultSentinelOut("/srv/nordus-data-2", "linux", "/home/nordus", {})).not.toBe(other);
  });

  it("knows when a folder is inside another", () => {
    expect(isInside("/d/nordus/sentinel", "/d/nordus", "linux")).toBe(true);
    expect(isInside("/d/nordus", "/d/nordus", "linux")).toBe(true);
    expect(isInside("/d/nordus-sentinel", "/d/nordus", "linux")).toBe(false);
    expect(isInside("/d", "/d/nordus", "linux")).toBe(false);
    expect(isInside("C:\\d\\nordus\\x", "C:\\d\\nordus", "win32")).toBe(true);
  });
});
