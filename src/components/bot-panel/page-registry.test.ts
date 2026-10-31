import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import { BOT_SECTIONS } from "../bot-settings/sections";
import { PAGE_IDS, PAGES, PANEL_TABS, sectionTarget, setupTarget, TAB_LABEL, targetNeedsAdvanced } from "./page-registry";

describe("the bot panel's page registry", () => {
  it("lands every settings section on a tab, and on a page that lives on that tab", () => {
    for (const { id } of BOT_SECTIONS) {
      const target = sectionTarget(id);
      expect(PANEL_TABS).toContain(target.tab);
      if (target.page) expect(PAGES[target.page].home, id).toBe(target.tab);
    }
  });

  it("has no Settings tab: every page lives on a tab that exists, and the Details tab opens Advanced for the ones inside it", () => {
    expect(PANEL_TABS).toEqual(["details", "library", "computer"]);
    for (const id of PAGE_IDS) expect(PANEL_TABS, id).toContain(PAGES[id].home);
    expect(sectionTarget("team")).toEqual({ tab: "details", page: "members" });
    expect(targetNeedsAdvanced(sectionTarget("voice"))).toBe(true);
    expect(targetNeedsAdvanced(sectionTarget("routines"))).toBe(false);
  });

  it("sends each setup idea to the page that sets it up", () => {
    expect(setupTarget("soul")).toEqual({ tab: "details", page: "instructions" });
    expect(setupTarget("folder")).toEqual({ tab: "computer", page: "folder" });
    expect(setupTarget("apps")).toEqual({ tab: "details", page: "apps" });
    expect(setupTarget("schedule")).toEqual({ tab: "details", page: "routines" });
    expect(setupTarget("identity")).toEqual({ tab: "details" });
  });

  it("names every page and where it lives in English copy", () => {
    const keys = en as Record<string, string>;
    for (const id of PAGE_IDS) {
      expect(keys[PAGES[id].title], id).toBeTruthy();
      expect(keys[PAGES[id].where], id).toBeTruthy();
      expect(PAGES[id].keywords.length, id).toBeGreaterThan(0);
    }
    for (const tab of PANEL_TABS) expect(keys[TAB_LABEL[tab]]).toBeTruthy();
  });
});
