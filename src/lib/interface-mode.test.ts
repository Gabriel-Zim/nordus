import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

let local: ReturnType<typeof memoryStorage>;

// The module keeps a per-session choice, so each case loads a fresh copy over the same storage, as a relaunch would.
async function fresh() {
  vi.resetModules();
  return import("./interface-mode");
}

beforeEach(() => {
  local = memoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("interface mode", () => {
  it("defaults a fresh install to Simple and stores that once", async () => {
    const { readAdvancedMode, settleAdvancedModeDefault, ADVANCED_MODE_KEY } = await fresh();
    expect(readAdvancedMode()).toBe(false);
    settleAdvancedModeDefault();
    local.setItem("nordus-skin", "midnight");
    expect(local.getItem(ADVANCED_MODE_KEY)).toBe("0");
    expect((await fresh()).readAdvancedMode()).toBe(false);
  });

  it("keeps Simple for an existing install, whatever keys it already had", async () => {
    local.setItem("nordus-skin", "lagoon");
    local.setItem("nordus-installed", "1");
    local.setItem("nordus-drafts", "{}");
    const { readAdvancedMode, settleAdvancedModeDefault, ADVANCED_MODE_KEY } = await fresh();
    expect(readAdvancedMode()).toBe(false);
    settleAdvancedModeDefault();
    expect(local.getItem(ADVANCED_MODE_KEY)).toBe("0");
  });

  it("turns Advanced on only when the person chose it", async () => {
    local.setItem("nordus-skin", "lagoon");
    (await fresh()).setAdvancedMode(true);
    expect((await fresh()).readAdvancedMode()).toBe(true);
  });

  it("keeps an explicit choice over the fresh-install default", async () => {
    local.setItem("nordus-skin", "midnight");
    (await fresh()).setAdvancedMode(false);
    expect((await fresh()).readAdvancedMode()).toBe(false);
  });

  it("still switches for the session when storage throws", async () => {
    const { setAdvancedMode, readAdvancedMode } = await fresh();
    local.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    setAdvancedMode(true);
    expect(readAdvancedMode()).toBe(true);
  });

  it("falls back to Simple when storage cannot be read at all", async () => {
    local.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { readAdvancedMode, settleAdvancedModeDefault } = await fresh();
    expect(() => settleAdvancedModeDefault()).not.toThrow();
    expect(readAdvancedMode()).toBe(false);
  });
});
