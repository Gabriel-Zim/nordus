import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();

// Each case loads fresh modules over the same storage, as a launch would; interface-mode keeps a per-session choice.
async function boot() {
  vi.resetModules();
  const [{ settleAdvancedModeDefault, readAdvancedMode }, skins] = await Promise.all([import("./interface-mode"), import("./skins")]);
  settleAdvancedModeDefault();
  skins.applySkin(skins.readSkin());
  return { skin: document.documentElement.dataset.skin, advanced: readAdvancedMode(), stored: values.get("nordus-skin") };
}

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { documentElement: { dataset: {} as Record<string, string> } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("default skin", () => {
  it("opens a fresh install in Nordus, in Simple mode, and keeps it on the next launch", async () => {
    expect(await boot()).toEqual({ skin: "nordus", advanced: false, stored: "nordus" });
    values.set("nordus-installed", "2026-10-17T00:00:00.000Z");
    expect(await boot()).toEqual({ skin: "nordus", advanced: false, stored: "nordus" });
  });

  it("keeps an install that ran before in Midnight when nobody picked a skin", async () => {
    values.set("nordus-skin", "midnight");
    expect(await boot()).toMatchObject({ skin: "midnight", stored: "midnight" });
  });

  it("keeps Nordus for an earlier install whose saved skin is missing or no longer exists", async () => {
    values.set("nordus-installed", "2026-01-01T00:00:00.000Z");
    expect(await boot()).toEqual({ skin: "nordus", advanced: false, stored: "nordus" });
    values.set("nordus-skin", "retired-skin");
    expect(await boot()).toMatchObject({ skin: "nordus", stored: "nordus" });
  });

  it("always honours a skin someone chose", async () => {
    values.set("nordus-skin", "lagoon");
    expect(await boot()).toMatchObject({ skin: "lagoon" });
    values.clear();
    values.set("nordus-skin", "midnight");
    values.set("nordus-advanced-mode", "0");
    expect(await boot()).toMatchObject({ skin: "midnight", advanced: false });
  });

  it("shows Dark as the selected mode in Appearance on a fresh install", async () => {
    await boot();
    const { SkinPicker } = await import("@/components/SkinPicker");
    const markup = renderToStaticMarkup(createElement(SkinPicker));
    const pressed = [...markup.matchAll(/aria-checked="true"[\s\S]*?<div class="text-\[13px\] font-medium text-ink">([^<]+)</g)].map(([, name]) => name);
    expect(pressed).toEqual(["Dark"]);
  });
});
