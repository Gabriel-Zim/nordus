// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  bots: [] as Bot[],
  picker: null as null | { bot: Bot; threadId?: string; contained?: boolean },
}));

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots: fixture.bots }, dispatch: vi.fn() }) }));
vi.mock("./ModelPicker", () => ({
  ModelPicker: (props: { bot: Bot; threadId?: string; contained?: boolean }) => {
    fixture.picker = props;
    return createElement("span", { "data-test-model-picker": "" });
  },
}));

const { ModelUnavailableCard } = await import("./ModelUnavailableCard");
const { setLocale } = await import("@/lib/i18n");

const bot = { id: "atlas", threadId: "thread-atlas", name: "Atlas", modelSelection: { instanceId: "codex", model: "gpt-5.6" } } as unknown as Bot;
const plain = "That model isn't available right now. Choose another model.";

let root: Root;
let host: HTMLDivElement;
const draw = (props: Parameters<typeof ModelUnavailableCard>[0]) => {
  flushSync(() => root.render(createElement(ModelUnavailableCard, props)));
};
const buttonWith = (label: string) => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(label));

beforeEach(() => {
  setLocale("en");
  fixture.bots = [bot];
  fixture.picker = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("ModelUnavailableCard", () => {
  it("says one plain sentence and opens the shared picker from its action", () => {
    const onRetry = vi.fn();
    draw({ botId: "atlas", threadId: "thread-atlas", onRetry });
    expect(host.textContent).toContain(plain);
    expect(host.textContent).not.toContain("There's an issue with the selected model");
    expect(host.querySelector("[data-test-model-picker]")).toBeNull();

    const choose = buttonWith("Choose another model")!;
    expect(choose.getAttribute("aria-expanded")).toBe("false");
    flushSync(() => choose.click());

    expect(host.querySelector("[data-test-model-picker]")).not.toBeNull();
    expect(buttonWith("Choose another model")!.getAttribute("aria-expanded")).toBe("true");
    expect(fixture.picker).toMatchObject({ bot, threadId: "thread-atlas", contained: true });

    flushSync(() => buttonWith("Retry")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the sentence and retry, but no picker action, when the bot is not in the store", () => {
    fixture.bots = [];
    draw({ botId: "gone", onRetry: vi.fn() });
    expect(host.textContent).toContain(plain);
    expect(buttonWith("Choose another model")).toBeUndefined();
    expect(buttonWith("Retry")).toBeDefined();
  });
});
