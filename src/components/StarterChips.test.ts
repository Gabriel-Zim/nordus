import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: [], routines: [] },
      dispatch: vi.fn(),
    }),
  };
});
const mode = vi.hoisted(() => ({ advanced: false }));
vi.mock("@/lib/interface-mode", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => mode.advanced,
}));
vi.mock("./ConnectAI", () => ({ ConnectAI: () => null }));

const { StarterChips, CONFIG_CHIP_IDS, IDEA_CHIP_IDS } = await import("./StarterChips");
afterAll(() => { vi.unstubAllGlobals(); });

const chips = (markup: string) => [...markup.matchAll(/data-starter-chip="([^"]+)"/g)].map((match) => match[1]);

describe("the starter chips", () => {
  it("offers setup and ideas in the Simple chat", () => {
    mode.advanced = false;
    const markup = renderToStaticMarkup(createElement(StarterChips));
    expect(chips(markup)).toEqual([...CONFIG_CHIP_IDS, ...IDEA_CHIP_IDS]);
    expect(markup).not.toContain("data-starter-chips-setup-only");
  });

  it("shows only the setup chips when the bot already offers concrete requests", () => {
    mode.advanced = false;
    const markup = renderToStaticMarkup(createElement(StarterChips, { setupOnly: true }));
    expect(chips(markup)).toEqual([...CONFIG_CHIP_IDS]);
    expect(markup).toContain("data-starter-chips-setup-only");
    for (const id of IDEA_CHIP_IDS) expect(chips(markup)).not.toContain(id);
  });

  it("stays out of the Advanced chat", () => {
    mode.advanced = true;
    expect(renderToStaticMarkup(createElement(StarterChips, { setupOnly: true }))).toBe("");
    mode.advanced = false;
  });
});
