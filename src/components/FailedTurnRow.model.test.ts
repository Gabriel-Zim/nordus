import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import { failedTurnTool } from "../../shared/failed-turn";
import { setLocale } from "@/lib/i18n";

const providerMessage = "There's an issue with the selected model (claude-opus-4-1). It may not exist or you may not have access to it. Run --model to pick a different model.";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn(), bots: [] as Bot[] };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, config: {}, instances: [] as InstanceInfo[], bots: fixture.bots },
    dispatch: fixture.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "darwin" }, localComputer: { available: true } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/interface-mode", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => true,
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span", { "data-test-model-picker": "" }) }));

const { FailedTurnRow } = await import("./ChatView");

const bot = { id: "atlas", name: "Atlas", modelSelection: { instanceId: "claude", model: "m" } } as unknown as Bot;

beforeEach(() => {
  setLocale("en");
  fixture.dispatch = vi.fn();
  fixture.bots = [bot];
});

describe("a failed turn whose model the provider refused", () => {
  it("reads as one plain sentence with both ways out, never as the provider's English", () => {
    const onRetry = vi.fn();
    const markup = renderToStaticMarkup(createElement(FailedTurnRow, {
      tool: failedTurnTool(providerMessage), engine: undefined, botId: "atlas", threadId: "thread-atlas", onRetry,
    }));
    expect(markup).toContain("That model isn&#x27;t available right now. Choose another model.");
    expect(markup).toContain("Choose another model");
    expect(markup).toContain("Retry");
    expect(markup).not.toContain("There&#x27;s an issue with the selected model");
  });
});
