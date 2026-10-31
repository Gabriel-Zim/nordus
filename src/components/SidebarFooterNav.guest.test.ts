import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ advanced: false, guest: false, state: {} as Record<string, unknown> }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: fixture.state, dispatch: () => {} }) }));
vi.mock("@/lib/use-viewer", () => ({ useGuest: () => fixture.guest, useViewer: () => ({ admin: false, guest: fixture.guest }) }));
vi.mock("./UpdateIndicator", () => ({ UpdateIndicator: () => null }));
import { SidebarFooterNav, SidebarToolsMenu } from "./SidebarFooterNav";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";

const places = (html: string) => ["automations", "team-map"].filter((id) => html.includes(`data-sidebar-nav="${id}"`));

beforeEach(() => {
  fixture.advanced = true;
  fixture.guest = false;
  fixture.state = { activeView: "chat", routineRuns: [], pluginsOpen: false };
  vi.stubGlobal("window", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("what a guest does not get in the sidebar", () => {
  it("has Automations and Team map for a member", () => {
    expect(places(renderToStaticMarkup(createElement(SidebarFooterNav, { density: "comfortable", onToggleCollapsed() {} })))).toEqual(["automations", "team-map"]);
  });

  it("has neither for a guest, in the list or on the avatars-only rail", () => {
    fixture.guest = true;
    for (const density of ["comfortable", "compact", "icons"] as const) {
      expect(places(renderToStaticMarkup(createElement(SidebarFooterNav, { density, onToggleCollapsed() {} })))).toEqual([]);
    }
  });

  it("has neither in Simple mode's Tools menu", () => {
    fixture.advanced = false;
    const menu = () => {
      let items: SidebarMenuItem[] = [];
      renderToStaticMarkup(createElement(() => { const tree = SidebarToolsMenu(); items = (tree.props as { items: SidebarMenuItem[] }).items; return tree; }));
      return items.map((item) => item.key).filter((key) => key === "automations" || key === "team-map");
    };
    expect(menu()).toEqual(["automations", "team-map"]);
    fixture.guest = true;
    expect(menu()).toEqual([]);
  });
});
