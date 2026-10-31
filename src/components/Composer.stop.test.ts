// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], instances: [{ instanceId: "fake", driverKind: "claude", displayName: "Fake", capabilities: {} }] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
const mode = vi.hoisted(() => ({ advanced: false }));
vi.mock("@/lib/interface-mode", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => mode.advanced,
}));

const { Composer } = await import("./Composer");
const { setLocale, t } = await import("@/lib/i18n");

const bot: Bot = {
  id: "stop-bot", threadId: "stop-thread", name: "Programador", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: true, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};

describe("the composer while the bot works", () => {
  let root: Root;
  let container: HTMLDivElement;
  const draw = () => flushSync(() => root.render(createElement(Composer, { bot, onEditLast: vi.fn() })));

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    setLocale("pt-br");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    setLocale("en");
    vi.unstubAllGlobals();
  });

  it("has no stop button in the Simple chat: the person writes \"para\" instead", () => {
    mode.advanced = false;
    draw();
    expect(container.querySelector(`[aria-label="${t("chat.stopTurn")}"]`)).toBeNull();
  });

  it("keeps the stop button in Advanced", () => {
    mode.advanced = true;
    draw();
    expect(container.querySelector(`[aria-label="${t("chat.stopTurn")}"]`)).not.toBeNull();
    mode.advanced = false;
  });
});
