import { describe, expect, it, vi } from "vitest";

import type { Decider } from "../decider/index.ts";
import type { ChoiceAnswer } from "../decider/types.ts";
import { actionSpace, fieldText, type PageAction, type PageState } from "./model.ts";
import { MARKER, READ_PAGE_TEXT, READ_STATE } from "./page-scripts.ts";
import { runGoal, type GoalPage } from "./run.ts";

function state(actions: Omit<PageAction, "id">[], text = "Busca"): PageState {
  const all = [...actions, { kind: "wait" as const, label: "Wait for the page to update" }].map((action, index) => ({ ...action, id: action.kind === "wait" ? "wait" : `e${index + 1}` }));
  return { url: "https://example.com/", title: "Exemplo", text, actions: all, marker: `m:${text}`, page_key: "k", guards: Object.fromEntries(all.filter((a) => a.node).map((a) => [String(a.node), `g${a.node}`])), scroll: { y: 0, height: 720 } };
}

function fakePage(pages: PageState[]): GoalPage & { clicks: number; typed: string[] } {
  let current = 0;
  const page = {
    clicks: 0,
    typed: [] as string[],
    evaluate: vi.fn(async (script: string) => {
      if (script === MARKER) return pages[current]!.marker;
      if (script === READ_STATE) return JSON.stringify(pages[current]);
      if (script === READ_PAGE_TEXT) return JSON.stringify({ url: pages[current]!.url, title: pages[current]!.title, text: pages[current]!.text });
      if (script.includes("c.pageKey()")) {
        const node = Number(/nodes\.get\((\d+)\)/.exec(script)![1]);
        return JSON.stringify([pages[current]!.page_key, pages[current]!.guards[String(node)]]);
      }
      if (script.includes("elementFromPoint")) return JSON.stringify({ x: 10, y: 10 });
      return 1;
    }),
    mouse: vi.fn(async (event: { type: string }) => {
      if (event.type === "mouseReleased") { page.clicks++; current = Math.min(current + 1, pages.length - 1); }
    }),
    insertText: vi.fn(async (text: string) => { page.typed.push(text); }),
  };
  return page;
}

const choice = (key: string): ChoiceAnswer => ({ type: "choice", choice: key, pTop: 0.9, margin: 0.8, probabilities: { [key]: 0.9 } });

function decider(...answers: Array<{ operation: string; target?: string }>) {
  let call = 0;
  const jev = {
    ask: vi.fn(async (_seam: unknown, _state: unknown, questions: Record<string, unknown>) => {
      const next = answers[Math.min(call++, answers.length - 1)]!;
      const target = Object.keys(questions).find((key) => key !== "operation");
      return { ok: true as const, provider: "jev" as const, latencyMs: 1, answers: { operation: choice(next.operation), ...(target && next.target ? { [target]: choice(next.target) } : {}) } };
    }),
  };
  return jev as typeof jev & Pick<Decider, "ask">;
}

describe("runGoal", () => {
  it("stops before a control that pays and presses nothing", async () => {
    const page = fakePage([state([{ kind: "click", node: 1, role: "button", label: "Confirmar e pagar" }])]);
    const outcome = await runGoal("reservar o quarto", { page, decider: decider({ operation: "CLICK" }), textModel: null });
    expect(outcome.status).toBe("approval");
    expect(outcome.reason).toContain("Confirmar e pagar");
    expect(page.clicks).toBe(0);
  });

  it.each(["13, Sunday, December 2026. Available. Select as checkout date.", "13, domingo. Disponível. Selecionar como data de checkout."])(
    "picks a checkout date in a calendar without asking the person: %s", async (label) => {
      const page = fakePage([state([{ kind: "click", node: 1, role: "button", label }]), state([], "Datas escolhidas")]);
      const outcome = await runGoal("buscar", { page, decider: decider({ operation: "CLICK" }, { operation: "DONE" }), textModel: null });
      expect(outcome.status).toBe("done");
      expect(page.clicks).toBe(1);
    });

  it.each(["Checkout", "Ir para o checkout", "Proceed to checkout"])("still stops before a checkout button: %s", async (label) => {
    const page = fakePage([state([{ kind: "click", node: 1, role: "button", label }])]);
    const outcome = await runGoal("comprar", { page, decider: decider({ operation: "CLICK" }), textModel: null });
    expect(outcome.status).toBe("approval");
  });

  it("refuses optional cookies by itself before asking for the next action", async () => {
    const page = fakePage([
      state([{ kind: "click", node: 1, role: "button", label: "Aceitar todos" }, { kind: "click", node: 2, role: "button", label: "Recusar opcionais" }], "Usamos cookies"),
      state([{ kind: "click", node: 3, role: "button", label: "Pesquisar" }], "Busca pronta"),
    ]);
    const jev = decider({ operation: "DONE" });
    const outcome = await runGoal("buscar", { page, decider: jev, textModel: null });
    expect(outcome.steps.map((step) => [step.kind, step.label])).toEqual([["read", "Exemplo"], ["cookies", "Recusar opcionais"]]);
    expect(outcome.status).toBe("done");
    const asked = jev.ask.mock.calls[0]![1] as { page: { text: string } };
    expect(asked.page.text).toBe("Busca pronta");
  });

  it("never presses accept-all on a cookie banner without a refuse option", async () => {
    const page = fakePage([state([{ kind: "click", node: 1, role: "button", label: "Aceitar todos os cookies" }], "Usamos cookies")]);
    const outcome = await runGoal("buscar", { page, decider: decider({ operation: "CLICK" }), textModel: null });
    expect(outcome.status).toBe("blocked");
    expect(page.clicks).toBe(0);
  });

  it("closes a sign-in offer that covers the page before asking for the next action", async () => {
    const page = fakePage([
      state([{ kind: "click", node: 1, role: "button", label: "Dismiss sign-in info." }, { kind: "click", node: 2, role: "link", label: "Sign in or register" }], "Sign in, save money"),
      state([{ kind: "fill", node: 3, role: "combobox", label: "Where are you going?", value: "" }], "Find your next stay"),
    ]);
    const jev = decider({ operation: "DONE" });
    const outcome = await runGoal("buscar", { page, decider: jev, textModel: null });
    expect(outcome.steps.map((step) => [step.kind, step.label])).toEqual([["read", "Exemplo"], ["dismiss", "Dismiss sign-in info."]]);
    expect(page.clicks).toBe(1);
    const asked = jev.ask.mock.calls[0]![1] as { page: { text: string } };
    expect(asked.page.text).toBe("Find your next stay");
  });

  it("types the text model's value into the chosen field and records it", async () => {
    const page = fakePage([
      state([{ kind: "fill", node: 1, role: "combobox", label: "Destino", value: "" }, { kind: "click", node: 2, role: "button", label: "Pesquisar" }]),
      state([{ kind: "click", node: 2, role: "button", label: "Pesquisar" }], "Chicago"),
    ]);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"text\":\"Chicago\"}" } }] })));
    const outcome = await runGoal("buscar Chicago", {
      page, decider: decider({ operation: "TYPE_TEXT" }, { operation: "DONE" }), textModel: { baseUrl: "https://text.test/v1", model: "m", key: "k" }, fetch,
    });
    expect(page.typed).toEqual(["Chicago"]);
    expect(outcome.steps.at(-1)).toMatchObject({ kind: "fill", label: "Destino", text: "Chicago" });
    expect(outcome.status).toBe("done");
  });

  it("shows the pointer inside the hit test, with no extra command or wait", async () => {
    const page = fakePage([
      state([{ kind: "fill", node: 1, role: "combobox", label: "Destino", value: "" }]),
      state([{ kind: "click", node: 2, role: "button", label: "Pesquisar" }], "Chicago"),
    ]);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"text\":\"Chicago\"}" } }] })));
    const sleep = vi.fn(async () => {});
    await runGoal("buscar Chicago", {
      page, decider: decider({ operation: "TYPE_TEXT" }, { operation: "DONE" }), textModel: { baseUrl: "https://text.test/v1", model: "m", key: "k" }, fetch,
      visible: true, sleep,
    });
    const scripts = vi.mocked(page.evaluate).mock.calls.map(([script]) => String(script));
    const pointed = scripts.filter((script) => script.includes("__nordus_pointer"));
    expect(pointed).toHaveLength(1);
    expect(pointed[0]).toContain("elementFromPoint");
    expect(sleep).not.toHaveBeenCalled();
    expect(page.typed).toEqual(["Chicago"]);
  });

  it("waits for a page that is still loading after a click instead of giving up", async () => {
    const pages = [
      state([{ kind: "click", node: 1, role: "option", label: "Chicago, Illinois" }]),
      state([{ kind: "click", node: 2, role: "button", label: "Pesquisar" }], "Datas"),
    ];
    const page = fakePage(pages);
    const read = vi.mocked(page.evaluate).getMockImplementation()!;
    let loading = 0;
    vi.mocked(page.evaluate).mockImplementation(async (script: string) => {
      if (script === READ_STATE && page.clicks === 1 && loading++ < 15) return null;
      return read(script);
    });
    const outcome = await runGoal("buscar", { page, decider: decider({ operation: "CLICK" }, { operation: "DONE" }), textModel: null, sleep: async () => {} });
    expect(outcome.status).toBe("done");
  });

  it("waits for the next page when a click navigates away while the page is read", async () => {
    const pages = [
      state([{ kind: "click", node: 1, role: "button", label: "Datas" }]),
      state([{ kind: "click", node: 2, role: "button", label: "Pesquisar" }], "Resultados"),
    ];
    const page = fakePage(pages);
    const read = vi.mocked(page.evaluate).getMockImplementation()!;
    let navigating = 0;
    vi.mocked(page.evaluate).mockImplementation(async (script: string) => {
      if (page.clicks === 1 && navigating++ < 3) throw new Error("Execution context was destroyed, most likely because of a navigation.");
      return read(script);
    });
    const outcome = await runGoal("buscar", { page, decider: decider({ operation: "CLICK" }, { operation: "DONE" }), textModel: null, sleep: async () => {} });
    expect(outcome.status).toBe("done");
    expect(outcome.title).toBe("Exemplo");
  });

  it("waits for the next page when the click itself navigates away before the button is released", async () => {
    const pages = [
      state([{ kind: "click", node: 1, role: "button", label: "Datas" }]),
      state([{ kind: "click", node: 2, role: "button", label: "Pesquisar" }], "Resultados"),
    ];
    const page = fakePage(pages);
    const press = vi.mocked(page.mouse).getMockImplementation()!;
    let released = 0;
    vi.mocked(page.mouse).mockImplementation(async (event) => {
      await press(event);
      if (event.type === "mouseReleased" && released++ === 0) throw new Error("Target page, context or browser has been closed");
    });
    const outcome = await runGoal("buscar", { page, decider: decider({ operation: "CLICK" }, { operation: "DONE" }), textModel: null, sleep: async () => {} });
    expect(outcome.status).toBe("done");
  });

  it("gives up after three actions that change nothing", async () => {
    const same = state([{ kind: "click", node: 1, role: "button", label: "Ver mais" }, { kind: "click", node: 2, role: "button", label: "Filtros" }]);
    const page = fakePage([same]);
    const outcome = await runGoal("filtrar", { page, decider: decider({ operation: "CLICK", target: "1" }), textModel: null });
    expect(outcome.status).toBe("blocked");
    expect(page.clicks).toBe(3);
  });

  it("gives up when it keeps pressing the same controls in a circle", async () => {
    const actions = [{ kind: "click" as const, node: 1, role: "button", label: "Tipo de acomodação" }, { kind: "click" as const, node: 2, role: "button", label: "Mostrar 1.000+ acomodações" }];
    const page = fakePage(Array.from({ length: 30 }, (_, index) => state(actions, `Busca ${index}`)));
    const outcome = await runGoal("filtrar casas", { page, decider: decider(...Array.from({ length: 30 }, (_, index) => ({ operation: "CLICK", target: index % 2 ? "2" : "1" }))), textModel: null });
    expect(outcome.status).toBe("blocked");
    expect(page.clicks).toBe(5);
  });

  it("returns unavailable when the decision model does not answer", async () => {
    const page = fakePage([state([{ kind: "click", node: 1, label: "Pesquisar" }])]);
    const outcome = await runGoal("buscar", { page, decider: { ask: async () => ({ ok: false as const, reason: "timeout" as const }) }, textModel: null });
    expect(outcome.status).toBe("unavailable");
  });
});

describe("actionSpace", () => {
  it("groups each operation's targets by element and keeps controls apart", () => {
    const { elements, targets, controls } = actionSpace(state([
      { kind: "fill", node: 1, role: "textbox", label: "Destino", value: "" },
      { kind: "click", node: 1, role: "textbox", label: "Open Destino", value: "" },
      { kind: "select", node: 2, role: "combobox", label: "Hóspedes → 2", value: "2", current_value: "1" },
    ]).actions);
    expect(elements.map((element) => [element.index, element.operations])).toEqual([["1", ["TYPE_TEXT", "CLICK"]], ["2", ["SELECT"]]]);
    expect([...targets.get("SELECT")!.keys()]).toEqual(["2:1"]);
    expect([...controls.keys()]).toEqual(["WAIT"]);
  });
});

describe("fieldText", () => {
  it("asks again without the page when the provider's content filter trips", async () => {
    const bodies: string[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return bodies.length === 1
        ? new Response(JSON.stringify({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] }))
        : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"text\":\"Lisboa\"}" } }] }));
    }) as unknown as typeof globalThis.fetch;
    const result = await fieldText({ baseUrl: "https://text.test/v1", model: "mercury-3", key: "k" }, {
      goal: "voos para Lisboa", field: { label: "Para onde?" }, page: { title: "Voos", text: "notícias" }, recent_actions: [],
    }, { timeoutMs: 1_000, fetch });
    expect(result).toMatchObject({ ok: true, text: "Lisboa" });
    expect(JSON.parse(JSON.parse(bodies[1]!).messages[1].content).page.text).toBe("");
    expect(JSON.parse(bodies[0]!).reasoning_effort).toBe("instant");
  });
});

describe("runGoal with a date picker", () => {
  it("moves the open calendar to the goal's month by itself, then lets the pilot pick the day", async () => {
    const next = { kind: "click" as const, node: 2, role: "button", label: "Mova para frente para alternar para o próximo mês." };
    const field = { kind: "click" as const, node: 1, role: "button", label: "Quando Insira as datas" };
    const page = fakePage([
      state([field, next], "outubro de 2026\nnovembro de 2026"),
      state([field, next], "novembro de 2026\ndezembro de 2026"),
      state([field, next, { kind: "click", node: 3, role: "button", label: "5, Tuesday, January 2027. Disponível." }], "dezembro de 2026\njaneiro de 2027"),
      state([], "Datas escolhidas"),
    ]);
    const jev = decider({ operation: "CLICK", target: "3" }, { operation: "DONE" });
    const outcome = await runGoal("Search Porto for January 5 to 8 for 2 adults", { page, decider: jev, textModel: null });
    expect(outcome.status).toBe("done");
    expect(outcome.steps.filter((item) => item.label === next.label)).toHaveLength(2);
    expect(page.clicks).toBe(3);
  });
});

describe("runGoal on a site's home page", () => {
  it("acts before calling a goal met on the home page, even when the page shows past searches", async () => {
    const page = fakePage([
      state([{ kind: "click", node: 1, role: "button", label: "Buscar" }], "Buscas recentes: Florianópolis"),
      state([], "Resultados em Florianópolis"),
    ]);
    const jev = decider({ operation: "DONE" }, { operation: "CLICK" }, { operation: "DONE" });
    const outcome = await runGoal("Search Florianópolis for January 10 to 14", { page, decider: jev, textModel: null });
    expect(outcome.status).toBe("done");
    expect(page.clicks).toBe(1);
    const second = jev.ask.mock.calls[1]![2] as { operation: { options: Record<string, string> } };
    expect(second.operation.options.DONE).toBeUndefined();
  });
});

describe("runGoal on a page that never settles", () => {
  /** Every marker read differs, as on a feed that keeps loading; the nodes' own guards stay put unless `moving` is set. */
  function restlessPage(base: PageState, moving = false): GoalPage & { typed: string[]; clicks: number } {
    let reads = 0;
    const page = {
      typed: [] as string[],
      clicks: 0,
      evaluate: vi.fn(async (script: string) => {
        reads++;
        if (script === MARKER) return `m:${reads}`;
        if (script === READ_STATE) return JSON.stringify({ ...base, marker: `m:${reads}` });
        if (script === READ_PAGE_TEXT) return JSON.stringify({ url: base.url, title: base.title, text: base.text });
        if (script.includes("c.pageKey()")) return JSON.stringify([base.page_key, moving ? `g${reads}` : base.guards[String(/nodes\.get\((\d+)\)/.exec(script)![1])]]);
        if (script.includes("elementFromPoint")) return JSON.stringify({ x: 10, y: 10 });
        return 1;
      }),
      mouse: vi.fn(async (event: { type: string }) => { if (event.type === "mouseReleased") page.clicks++; }),
      insertText: vi.fn(async (text: string) => { page.typed.push(text); }),
    };
    return page;
  }
  const typed = { baseUrl: "https://text.test/v1", model: "m", key: "k" };
  const answer = () => vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"text\":\"nathan\"}" } }] })));

  it("types into a field and finishes although the page marker changes on every read", async () => {
    const page = restlessPage(state([{ kind: "fill", node: 1, role: "textbox", label: "Pesquisa", value: "" }]));
    const jev = decider({ operation: "TYPE_TEXT" }, { operation: "DONE" });
    const outcome = await runGoal("digitar nathan", { page, decider: jev, textModel: typed, fetch: answer() });
    expect(page.typed).toEqual(["nathan"]);
    expect(outcome.status).toBe("done");
    expect(jev.ask.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("accepts a finished goal although the page marker changes on every read", async () => {
    const page = restlessPage({ ...state([{ kind: "click", node: 1, role: "button", label: "Pesquisar" }]), url: "https://example.com/explore/search/" });
    const jev = decider({ operation: "DONE" });
    const outcome = await runGoal("listar as contas", { page, decider: jev, textModel: null });
    expect(outcome.status).toBe("done");
    expect(jev.ask.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("gives up quickly when the target keeps changing under the pilot", async () => {
    const page = restlessPage(state([{ kind: "click", node: 1, role: "button", label: "Pesquisar" }]), true);
    const jev = decider({ operation: "CLICK" });
    const outcome = await runGoal("pesquisar", { page, decider: jev, textModel: null });
    expect(outcome.status).toBe("blocked");
    expect(outcome.reason).toContain("The page kept changing");
    expect(page.clicks).toBe(0);
    expect(jev.ask.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("gives up quickly when a field keeps changing under the pilot", async () => {
    const page = restlessPage(state([{ kind: "fill", node: 1, role: "textbox", label: "Pesquisa", value: "" }]), true);
    const jev = decider({ operation: "TYPE_TEXT" });
    const outcome = await runGoal("digitar nathan", { page, decider: jev, textModel: typed, fetch: answer() });
    expect(outcome.status).toBe("blocked");
    expect(outcome.reason).toContain("The page kept changing");
    expect(page.typed).toEqual([]);
    expect(jev.ask.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
