// @vitest-environment happy-dom
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { commonModelPrefix, filterModels, normalizeSearch } from "@/lib/account-moves";
import { ModelSearchPicker } from "./ModelSearchPicker";

const LONG = "opencode/claude-fable-5-preview-with-a-very-long-suffix-20261020";
const MODELS = [
  { id: "opencode/claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "opencode/claude-opus-5-4" },
  { id: LONG },
  { id: "opencode/gpt-6.1-sol" },
];

let root: Root;
let container: HTMLElement;
let chosen: string[];

function Harness({ start = "" }: { start?: string }) {
  const [value, setValue] = useState(start);
  return createElement(ModelSearchPicker, { value, onChange: (next: string) => { chosen.push(next); setValue(next); }, models: MODELS, ruleHint: "opencode/gpt-6.1-sol", ariaLabel: "Model" });
}
const doc = () => document.body;
const open = () => flushSync(() => (doc().querySelector("[data-model-picker]") as HTMLElement).click());
const type = (text: string) => {
  const input = doc().querySelector<HTMLInputElement>('input[role="combobox"]')!;
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = (name: string) => {
  const input = doc().querySelector<HTMLInputElement>('input[role="combobox"]')!;
  flushSync(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
};
const optionIds = () => [...doc().querySelectorAll("[data-model-option]")].map((node) => node.getAttribute("data-model-option"));

beforeEach(() => {
  setLocale("en");
  chosen = [];
  container = document.createElement("div");
  doc().append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(Harness)));
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

describe("search helpers", () => {
  it("reads 'opus 5.5', 'opus-5-5' and accents alike and needs every word", () => {
    expect(normalizeSearch("  Opus 5.5 ")).toBe("opus 5 5");
    expect(normalizeSearch("Ação-Ñ")).toBe("acao n");
    expect(filterModels(MODELS, "opus 5.5").map((m) => m.id)).toEqual(["opencode/claude-opus-5-5"]);
    expect(filterModels(MODELS, "OPUS-5-5").map((m) => m.id)).toEqual(["opencode/claude-opus-5-5"]);
    expect(filterModels(MODELS, "opus").length).toBe(2);
    expect(filterModels(MODELS, "nothing")).toEqual([]);
    expect(filterModels(MODELS, "claude 5.5").map((m) => m.id)).toEqual(["opencode/claude-opus-5-5"]);
    const codex = ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].map((id) => ({ id }));
    expect(filterModels(codex, "5.5")).toEqual([]);
    expect(filterModels(codex, "6.1 sol").map((m) => m.id)).toEqual(["gpt-6.1-sol"]);
    expect(filterModels(codex, "sol").map((m) => m.id)).toEqual(["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol"]);
    expect(filterModels(codex, "5.6").map((m) => m.id)).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(filterModels(MODELS, "").length).toBe(4);
  });

  it("finds the provider prefix only when every id shares it", () => {
    expect(commonModelPrefix(MODELS.map((m) => m.id))).toBe("opencode/");
    expect(commonModelPrefix(["a/x", "b/y"])).toBe("");
    expect(commonModelPrefix(["only/one"])).toBe("");
  });
});

describe("model search picker", () => {
  it("shows the rule first with its model in parentheses, and the prefix once in a group header", () => {
    expect(doc().querySelector("[data-model-picker-value]")?.textContent).toBe("Suggested by the rule (opencode/gpt-6.1-sol)");
    open();
    expect(optionIds()[0]).toBe("rule");
    expect(doc().querySelector('[data-model-option="rule"]')?.textContent).toBe("Suggested by the rule (opencode/gpt-6.1-sol)");
    expect(doc().querySelectorAll("[data-picker-group]")).toHaveLength(1);
    expect(doc().querySelector("[data-picker-group]")?.textContent).toBe("opencode/");
    expect(doc().querySelector('[data-model-option="opencode/claude-opus-5-4"]')?.textContent).toBe("claude-opus-5-4");
  });

  it("shows the friendly name above a smaller id, and the whole long id without truncation", () => {
    open();
    const named = doc().querySelector('[data-model-option="opencode/claude-opus-5-5"]')!;
    expect(named.querySelector("[data-option-name]")?.textContent).toBe("Claude Opus 5.5");
    expect(named.querySelector("[data-option-id]")?.textContent).toBe("claude-opus-5-5");
    const long = doc().querySelector(`[data-model-option="${LONG}"]`)!;
    expect(long.textContent).toBe(LONG.replace("opencode/", ""));
    const all = doc().querySelector("[data-model-picker-panel]")!.innerHTML;
    expect(all).not.toContain("truncate");
    expect(all).not.toContain("text-ellipsis");
    expect(doc().querySelector("[data-model-picker-value]")!.className).not.toContain("truncate");
  });

  it("focuses the search box on open and filters while typing", () => {
    open();
    expect(document.activeElement).toBe(doc().querySelector('input[role="combobox"]'));
    type("opus 5.5");
    expect(optionIds()).toEqual(["opencode/claude-opus-5-5"]);
  });

  it("moves with the arrows, chooses with Enter, closes with Escape", () => {
    open();
    key("ArrowDown");
    key("ArrowDown");
    expect(doc().querySelector('[data-model-option="opencode/claude-opus-5-4"]')?.className).toContain("bg-control");
    key("Enter");
    expect(chosen).toEqual(["opencode/claude-opus-5-4"]);
    expect(doc().querySelector("[data-model-picker-panel]")).toBeNull();
    expect(doc().querySelector("[data-model-picker-value]")?.textContent).toBe("opencode/claude-opus-5-4");
    open();
    key("Escape");
    expect(doc().querySelector("[data-model-picker-panel]")).toBeNull();
    expect(chosen).toEqual(["opencode/claude-opus-5-4"]);
  });

  it("never accepts text that is not in the catalog", () => {
    open();
    type("modelo-que-nao-existe");
    expect(doc().querySelector("[data-picker-empty]")?.textContent).toBe("No model with that name on this account");
    key("Enter");
    expect(chosen).toEqual([]);
    expect(doc().querySelector("[data-model-picker-panel]")).not.toBeNull();
  });

  it("picks the rule again from the first option", () => {
    flushSync(() => root.render(createElement(Harness, { start: "opencode/gpt-6.1-sol" })));
    open();
    flushSync(() => (doc().querySelector('[data-model-option="rule"]') as HTMLElement).click());
    expect(chosen).toEqual([""]);
  });
});
