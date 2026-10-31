// @vitest-environment happy-dom
import { createElement, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  api: vi.fn(),
}));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: fixture.state, dispatch: vi.fn() }) }));
// A plain select keeps the test about this screen, not the custom menu.
vi.mock("./Select", async () => {
  const { createElement: h } = await import("react");
  return { Select: ({ size: _size, ...props }: ComponentProps<"select"> & { size?: string }) => h("select", props) };
});
const { AccountMovesSettings } = await import("./AccountMovesSettings");

const inst = (instanceId: string, driverKind: string, models: string[], efforts?: string[]) => ({
  instanceId, driverKind, displayName: instanceId, snapshot: { state: "available" },
  models: { default: models[0]!, options: models.map((id) => ({ id, label: id })) },
  ...(efforts ? { capabilities: { effortLevels: efforts } } : {}),
});
const window = (used: number, resetsAt: string) => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt });
const future = new Date(Date.now() + 7 * 3_600_000).toISOString();
const bot = (id: string, name: string, instanceId: string, extra: Record<string, unknown> = {}) => ({
  id, name, section: "Vendas", busy: false, modelSelection: { instanceId, model: "claude-opus-5-5", effort: "max" }, ...extra,
});

let calls: Array<{ path: string; init?: RequestInit }>;
let batches: unknown[];
let root: Root;
let container: HTMLElement;

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const text = () => container.textContent ?? "";
const click = (element: Element | null) => { flushSync(() => (element as HTMLElement).click()); };
const choose = (label: string, value: string) => {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  flushSync(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

beforeEach(async () => {
  setLocale("en");
  calls = [];
  batches = [];
  fixture.state = {
    sections: ["Vendas"],
    instances: [
      inst("grok", "grokAgent", ["grok-4.7"], ["low", "medium", "high"]),
      inst("claude", "claudeAgent", ["claude-opus-5-5", "claude-sonnet-5"], ["low", "medium", "high", "xhigh", "max"]),
      inst("codex", "codex", ["gpt-6.1-sol", "gpt-6.1-terra"], ["low", "medium", "high", "xhigh", "max"]),
      inst("opencodeGo", "opencodeGo", ["opencode/big-pickle"]),
    ],
    bots: [
      bot("a", "Ana", "claude"),
      bot("b", "Beto", "claude", { busy: true }),
      bot("c", "Caio", "codex", { modelSelection: { instanceId: "codex", model: "gpt-6.1-sol", effort: "high" } }),
      bot("d", "Dani", "opencodeGo", { section: undefined, modelSelection: { instanceId: "opencodeGo", model: "opencode/big-pickle" } }),
    ],
    routines: [
      { id: "r1", botId: "a", name: "Resumo diário", enabled: true, nextRunAt: Date.now() + 3_600_000 },
      { id: "r2", botId: "a", name: "Relatório", enabled: false, nextRunAt: null },
    ],
  };
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path.startsWith("/api/plan-usage")) {
      return { fetchedAt: "x", providers: [
        { id: "grok", name: "Grok", driver: "grok", plan: "SuperGrok Heavy", ok: true, error: null, fiveHour: window(10, future), weekly: window(40, future), extra: [] },
        { id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null, fiveHour: window(30, future), weekly: window(100, future), extra: [] },
        { id: "codex", name: "Codex", driver: "codex", plan: "plus", ok: true, error: null, fiveHour: window(5, future), weekly: window(86, future), extra: [] },
      ] };
    }
    if (path === "/api/account-moves" && !init?.method) return { batches };
    if (path === "/api/account-presets" && !init?.method) return { presets: [{ id: "p1", name: "Plano B: Claude esgotou", targets: [{ botId: "a", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" }], updatedAt: 1 }] };
    return { batch: { id: "new" } };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(AccountMovesSettings)));
  await settle();
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

describe("Accounts and models screen", () => {
  it("draws one card per configured account with usage, alert, Brasilia reset time and robot count", () => {
    const cards = [...container.querySelectorAll("[data-account-card]")].map((card) => card.getAttribute("data-account-card"));
    expect(cards).toEqual(["grok", "claude", "codex", "opencodeGo"]);
    const claude = container.querySelector('[data-account-card="claude"]')!;
    expect(claude.textContent).toContain("Account: claude");
    expect(claude.textContent).toContain("100% used");
    expect(claude.textContent).toMatch(/Volta às \d+h(\d\d)?, a fila espera\./);
    expect(claude.querySelector('[data-account-alert="exhausted"]')?.textContent).toBe("Exhausted");
    expect(claude.textContent).toContain("2 robots");
    expect(container.querySelector('[data-account-card="codex"] [data-account-alert="nearEnd"]')?.textContent).toBe("Almost out");
    expect(container.querySelector('[data-account-card="grok"] [data-account-alert]')).toBeNull();
    expect(container.querySelector('[data-account-card="opencodeGo"]')?.textContent).toContain("no reading");
  });

  it("lists robots by section with state and the routines under their robot", () => {
    expect([...container.querySelectorAll("[data-robot-group]")].map((group) => group.getAttribute("data-robot-group"))).toEqual(["Vendas", ""]);
    expect(container.querySelector('[data-robot="b"] [data-robot-state="busy"]')?.textContent).toBe("Busy");
    expect(container.querySelector('[data-robot="a"] [data-robot-state="free"]')?.textContent).toBe("Free");
    const routines = [...container.querySelectorAll('[data-robot="a"] [data-routine]')].map((node) => node.textContent);
    expect(routines[0]).toMatch(/^Routine Resumo diário · next \d\d\/\d\d \d\d:\d\d$/);
    expect(routines[1]).toBe("Routine Relatório · paused");
  });

  it("counts a multiple selection and filters by card, selecting only what the filter shows", () => {
    const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(container.querySelector("[data-account-bar]")).toBeNull();
    click(boxes()[0]!);
    click(boxes()[2]!);
    expect(container.querySelector("[data-selected-count]")?.textContent).toBe("2 robots selected");
    click(container.querySelector('[data-account-card="claude"]'));
    expect([...container.querySelectorAll("[data-robot]")].map((row) => row.getAttribute("data-robot"))).toEqual(["a", "b"]);
    expect(container.querySelector('[data-account-card="claude"]')?.getAttribute("aria-pressed")).toBe("true");
    click(container.querySelector("[data-select-all]"));
    expect(container.querySelector("[data-selected-count]")?.textContent).toBe("3 robots selected");
    click(container.querySelector("[data-select-all]"));
    expect(container.querySelector("[data-selected-count]")?.textContent).toBe("1 robot selected");
    click(container.querySelector('[data-account-chip="all"]'));
    expect(container.querySelectorAll("[data-robot]")).toHaveLength(4);
  });

  it("says how many selected robots are outside the filter and clears only those", () => {
    click(container.querySelector('[data-robot="a"] input'));
    click(container.querySelector('[data-robot="c"] input'));
    click(container.querySelector('[data-account-card="claude"]'));
    expect(container.querySelector("[data-outside-filter]")?.textContent).toContain("1 selected outside this filter");
    click(container.querySelector("[data-clear-outside]"));
    expect(container.querySelector("[data-outside-filter]")).toBeNull();
    expect(container.querySelector("[data-selected-count]")?.textContent).toBe("1 robot selected");
  });

  it("lists every robot in the confirmation, grouped by destination account", () => {
    for (const id of ["a", "b", "c", "d"]) click(container.querySelector(`[data-robot="${id}"] input`));
    choose("Destination account", "grok");
    click(container.querySelector("[data-apply]"));
    const groups = [...container.querySelectorAll("[data-confirm-group]")];
    expect(groups.map((group) => group.getAttribute("data-confirm-group"))).toEqual(["grok"]);
    expect(groups[0]!.textContent).toContain("To grok (4)");
    for (const name of ["Ana", "Beto", "Caio", "Dani"]) expect(groups[0]!.textContent).toContain(name);
  });

  it("keeps the bar hidden with no selection and opens the fields from the compact row on a phone", () => {
    expect(container.querySelector("[data-account-bar]")).toBeNull();
    click(container.querySelector('[data-robot="a"] input'));
    expect(container.querySelector("[data-bar-fields]")!.className).toContain("hidden");
    click(container.querySelector("[data-open-bar]"));
    expect(container.querySelector("[data-bar-fields]")!.className).not.toContain("hidden");
    expect(container.querySelector("[data-open-bar]")).toBeNull();
    click(container.querySelector("[data-close-bar]"));
    expect(container.querySelector("[data-bar-fields]")!.className).toContain("hidden");
  });

  it("searches by name", () => {
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "dan");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...container.querySelectorAll("[data-robot]")].map((row) => row.getAttribute("data-robot"))).toEqual(["d"]);
  });

  it("confirms with a summary and sends the rule's model and effort for each selected robot", async () => {
    click(container.querySelector('[data-robot="a"] input'));
    click(container.querySelector('[data-robot="b"] input'));
    expect(container.querySelector<HTMLButtonElement>("[data-apply]")!.disabled).toBe(true);
    expect(text().match(/2 robots selected/g)).toHaveLength(1);
    choose("Destination account", "codex");
    click(container.querySelector("[data-apply]"));
    const confirm = container.querySelector("[data-account-confirm]")!;
    expect(confirm.textContent).toContain("Confirm the move");
    expect(confirm.textContent).toContain("Ana");
    expect(confirm.textContent).toContain("claude · claude-opus-5-5 · Max → codex · gpt-6.1-sol · High");
    expect(confirm.textContent).toContain("Beto");
    expect(confirm.textContent).toContain("busy now");
    click(container.querySelector("[data-confirm-go]"));
    await settle();
    const post = calls.find((call) => call.path === "/api/account-moves" && call.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toEqual({
      label: "Move 2 robots to codex",
      targets: [
        { botId: "a", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" },
        { botId: "b", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" },
      ],
    });
    expect(container.querySelector("[data-account-confirm]")).toBeNull();
    expect(container.querySelector("[data-account-bar]")).toBeNull();
  });

  it("lets the person pick the model and effort from the destination's catalog", async () => {
    click(container.querySelector('[data-robot="a"] input'));
    choose("Destination account", "codex");
    click(container.querySelector("[data-model-picker]"));
    const modelOptions = [...document.querySelectorAll("[data-model-option]")].map((option) => option.getAttribute("data-model-option"));
    expect(modelOptions).toEqual(["rule", "gpt-6.1-sol", "gpt-6.1-terra"]);
    click(document.querySelector('[data-model-option="gpt-6.1-terra"]'));
    const effortOptions = [...container.querySelectorAll('select[aria-label="Effort"] option')].map((option) => option.getAttribute("value"));
    expect(effortOptions).toEqual(["", "none", "low", "medium", "high", "xhigh"]);
    choose("Effort", "xhigh");
    click(container.querySelector("[data-apply]"));
    click(container.querySelector("[data-confirm-go]"));
    await settle();
    const post = calls.find((call) => call.path === "/api/account-moves" && call.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body)).targets).toEqual([{ botId: "a", instanceId: "codex", model: "gpt-6.1-terra", effort: "xhigh" }]);
  });

  it("names the Antigravity destination as Antigravity / Gemini, and leaves the other accounts alone", () => {
    click(container.querySelector('[data-robot="a"] input'));
    fixture.state.instances = [...(fixture.state.instances as unknown[]), { ...inst("antigravity", "antigravityAgent", ["gemini-3-pro"]), displayName: "Antigravity" }];
    flushSync(() => root.render(createElement(AccountMovesSettings)));
    const options = [...container.querySelectorAll('select[aria-label="Destination account"] option')].map((option) => [option.getAttribute("value"), option.textContent]);
    expect(options).toContainEqual(["antigravity", "Antigravity / Gemini"]);
    expect(options).toContainEqual(["codex", "codex"]);
    expect(options.filter(([, label]) => /Gemini/.test(String(label)))).toHaveLength(1);
  });

  it("saves the current selection as a preset and applies a saved one as a whole batch", async () => {
    click(container.querySelector('[data-robot="a"] input'));
    choose("Destination account", "codex");
    click(container.querySelector("[data-preset-from-selection]"));
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Preset name"]')!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Plano B: Claude esgotou");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(container.querySelector("[data-preset-save]"));
    await settle();
    const put = calls.find((call) => call.path === "/api/account-presets" && call.init?.method === "PUT")!;
    expect(JSON.parse(String(put.init!.body))).toEqual({
      name: "Plano B: Claude esgotou",
      targets: [{ botId: "a", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" }],
    });
    click(container.querySelector('[data-preset="p1"] button'));
    expect(container.querySelector("[data-account-confirm]")?.textContent).toContain("Ana");
    click(container.querySelector("[data-confirm-go]"));
    await settle();
    const post = calls.filter((call) => call.path === "/api/account-moves" && call.init?.method === "POST").at(-1)!;
    expect(JSON.parse(String(post.init!.body))).toEqual({
      label: "Plano B: Claude esgotou",
      targets: [{ botId: "a", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" }],
    });
  });

  it("shows the history with counts, expands robot by robot, and undoes or cancels", async () => {
    batches = [{
      id: "b1", kind: "move", label: "Plano B", createdAt: Date.parse("2026-10-22T03:05:00Z"),
      items: [
        { botId: "a", botName: "Ana", status: "ok", attempts: 1, before: { instanceId: "claude", model: "m" }, target: { instanceId: "codex", model: "gpt-6.1-sol" } },
        { botId: "b", botName: "Beto", status: "pendente", attempts: 2, message: "Robô ocupado.", before: { instanceId: "claude", model: "m" }, target: { instanceId: "codex", model: "gpt-6.1-sol" } },
        { botId: "c", botName: "Caio", status: "falhou", attempts: 1, message: "boom", before: { instanceId: "claude", model: "m" }, target: { instanceId: "codex", model: "x" } },
      ],
    }];
    // remount so the first load already sees the batch
    flushSync(() => root.unmount());
    root = createRoot(container);
    flushSync(() => root.render(createElement(AccountMovesSettings)));
    await settle();
    const row = container.querySelector('[data-move-batch="b1"]')!;
    expect(row.textContent).toContain("Plano B");
    expect(row.textContent).toContain("22/10 00:05");
    expect(row.textContent).toContain("1 ok, 1 pending, 1 failed");
    expect(row.querySelector("[data-move-item]")).toBeNull();
    click([...row.querySelectorAll("button")].find((button) => button.textContent === "Show robots")!);
    expect([...row.querySelectorAll("[data-move-item]")].map((item) => item.getAttribute("data-move-item"))).toEqual(["ok", "pendente", "falhou"]);
    expect(row.textContent).toContain("claude · m → codex · gpt-6.1-sol");
    click([...row.querySelectorAll("button")].find((button) => button.textContent === "Cancel pending")!);
    await settle();
    expect(calls.some((call) => call.path === "/api/account-moves/b1/cancel" && call.init?.method === "POST")).toBe(true);
    click([...row.querySelectorAll("button")].find((button) => button.textContent === "Undo")!);
    await settle();
    expect(calls.some((call) => call.path === "/api/account-moves/b1/undo" && call.init?.method === "POST")).toBe(true);
  });

  it("polls the history on its own", async () => {
    vi.useFakeTimers();
    try {
      flushSync(() => root.unmount());
      root = createRoot(container);
      calls.length = 0;
      flushSync(() => root.render(createElement(AccountMovesSettings)));
      await vi.advanceTimersByTimeAsync(10_500);
      expect(calls.filter((call) => call.path === "/api/account-moves" && !call.init?.method).length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
