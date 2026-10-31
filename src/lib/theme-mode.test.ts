import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

const { readThemeMode, skinForMode } = await import("./theme-mode");

describe("theme mode", () => {
  beforeEach(() => store.clear());

  it("starts on Escuro", () => {
    expect(readThemeMode()).toBe("dark");
  });

  it("moves someone on a retired skin to Claro or Escuro by its ground", () => {
    for (const skin of ["atelier", "lagoon", "linen", "daylight", "meadow"]) {
      store.set("nordus-skin", skin);
      expect(readThemeMode(), skin).toBe("light");
    }
    for (const skin of ["midnight", "foundry", "graphite", "dusk", "nordus"]) {
      store.set("nordus-skin", skin);
      expect(readThemeMode(), skin).toBe("dark");
    }
  });

  it("keeps a saved choice over the old skin", () => {
    store.set("nordus-skin", "daylight");
    store.set("nordus-theme", "auto");
    expect(readThemeMode()).toBe("auto");
  });

  it("only ever paints one of the two Nordus skins", () => {
    expect(skinForMode("dark", true)).toBe("nordus");
    expect(skinForMode("light", false)).toBe("nordus-light");
    expect(skinForMode("auto", true)).toBe("nordus-light");
    expect(skinForMode("auto", false)).toBe("nordus");
  });
});
