// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotEditorStore, initialState, reducer, type Action, type AppState, type Bot, type ConfigStatus } from "@/state/store";
import { BotCreationDraft } from "@/lib/bot-creation-draft";
import { setLocale } from "@/lib/i18n";
import { BotContextMenu } from "./Sidebar";
import { BotTagPicker } from "./TagPicker";
import { DraftTag } from "./NewBotDialog";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(), useShowThreads: () => false,
}));

const designergrafico: Bot = { id: "designergrafico", threadId: "t1", name: "DesignerGrafico", title: "Diretora de arte", description: "Capas e carrosséis",
  soul: "Nunca diga o nome do cliente.", color: "green", notifications: true, unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" } };
const jevWith = (decider: Partial<NonNullable<ConfigStatus["decider"]>>) =>
  ({ decider: { provider: "jev", configured: true, enabled: true, jobs: {}, ...decider } }) as unknown as ConfigStatus;
const jevOn = jevWith({});

let root: Root, container: HTMLDivElement, state: AppState;
let view: () => ReactNode = () => null;
const actions: Action[] = [];
const dispatch = (action: Action) => { actions.push(action); state = reducer(state, action); draw(); };
const draw = () => flushSync(() => root.render(createElement(BotEditorStore, {
  value: { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} },
  children: view(),
})));
const drawMenu = () => {
  view = () => [
    createElement(BotContextMenu, { key: "menu", menu: { botId: "designergrafico", x: 40, y: 40 }, onClose: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), onMoveToSection: vi.fn(), onNewFolder: vi.fn(), onNewTaskFolder: vi.fn() }),
    createElement(BotTagPicker, { key: "picker" }),
  ];
  draw();
};
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === label);
const picker = () => document.querySelector<HTMLElement>("[data-tag-picker]");
const search = () => picker()!.querySelector<HTMLInputElement>("input")!;
const option = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("[data-tag-option]")].find((node) => node.textContent?.trim() === label);
const tagPatches = () => actions.filter((action) => action.type === "updateBot");
const type = (text: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search(), text);
  flushSync(() => search().dispatchEvent(new Event("input", { bubbles: true })));
};
const pressEnter = () => flushSync(() => search().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
const thinking = () => document.querySelector('[role="status"]')?.textContent ?? null;

const jevAnswers = (tags: string[]) => vi.fn(async (_url: unknown, _init?: RequestInit) =>
  new Response(JSON.stringify({ tags }), { headers: { "content-type": "application/json" } }));
const asked = (fetch: { mock: { calls: unknown[][] } }) => fetch.mock.calls.filter(([url]) => url === "/api/bot-tag-suggestions");
const askedBody = (fetch: { mock: { calls: unknown[][] } }, at = 0) => JSON.parse(String((asked(fetch)[at]![1] as RequestInit).body));

beforeEach(() => {
  setLocale("en"); document.documentElement.dataset.reducedMotion = "true";
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  state = { ...initialState, bots: [structuredClone(designergrafico)], selectedId: "other", config: jevOn };
  actions.length = 0;
});
afterEach(() => { flushSync(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); setLocale("en"); });

describe("tag from the bot menu", () => {
  it("opens from Create tag, offers what the simulated Jev suggests, and saves the pick on the bot", async () => {
    const jev = jevAnswers(["Diretor de Arte", "Designer"]);
    vi.stubGlobal("fetch", jev); drawMenu();
    expect(picker()).toBeNull();
    flushSync(() => menuItem("Create tag")!.click());
    await expect.poll(() => document.body.textContent).toContain("Jev suggests");
    expect(asked(jev)).toHaveLength(1);
    expect(askedBody(jev)).toEqual({ name: "DesignerGrafico", title: "Diretora de arte", description: "Capas e carrosséis" });
    flushSync(() => option("Diretor de Arte")!.click());
    expect(tagPatches()).toEqual([{ type: "updateBot", botId: "designergrafico", patch: { tag: "Diretor de Arte" } }]);
  });

  it("still opens with the whole catalog when Jev is down, and the pick is saved", async () => {
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    vi.stubGlobal("fetch", down); drawMenu();
    flushSync(() => menuItem("Create tag")!.click());
    await expect.poll(() => down.mock.calls.length).toBe(1);
    await expect.poll(thinking).toBeNull();
    expect(document.body.textContent).not.toContain("Jev suggests");
    expect(picker()).not.toBeNull();
    flushSync(() => option("Designer")!.click());
    expect(tagPatches()).toEqual([{ type: "updateBot", botId: "designergrafico", patch: { tag: "Designer" } }]);
  });

  it("treats a server error like no suggestion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }))); drawMenu();
    flushSync(() => menuItem("Create tag")!.click());
    await expect.poll(thinking).toBeNull();
    expect(document.body.textContent).not.toContain("Jev suggests");
    expect(option("Designer")).toBeTruthy();
  });

  it("edits and removes a tag without asking Jev again", async () => {
    const jev = jevAnswers(["Designer"]);
    vi.stubGlobal("fetch", jev);
    state = { ...state, bots: [{ ...designergrafico, tag: "Designer" }] }; drawMenu();
    flushSync(() => menuItem("Edit tag")!.click());
    await expect.poll(() => picker()).not.toBeNull();
    expect(asked(jev)).toEqual([]);
    flushSync(() => option("Remove tag")!.click());
    expect(tagPatches()).toEqual([{ type: "updateBot", botId: "designergrafico", patch: { tag: "" } }]);
  });

  it("changes nothing when the same tag is picked again", async () => {
    vi.stubGlobal("fetch", jevAnswers([]));
    state = { ...state, bots: [{ ...designergrafico, tag: "Designer" }] }; drawMenu();
    flushSync(() => menuItem("Edit tag")!.click());
    await expect.poll(() => option("Designer")).toBeTruthy();
    flushSync(() => option("Designer")!.click());
    expect(tagPatches()).toEqual([]);
  });

  it("keeps the tag when Enter is pressed on the empty search", async () => {
    vi.stubGlobal("fetch", jevAnswers([]));
    state = { ...state, bots: [{ ...designergrafico, tag: "Designer" }] }; drawMenu();
    flushSync(() => menuItem("Edit tag")!.click());
    await expect.poll(() => picker()).not.toBeNull();
    pressEnter();
    expect(tagPatches()).toEqual([]);
    expect(picker()).not.toBeNull();
  });

  it("takes Jev's first suggestion when Enter is pressed on the empty search", async () => {
    vi.stubGlobal("fetch", jevAnswers(["Diretor de Arte", "Designer"])); drawMenu();
    flushSync(() => menuItem("Create tag")!.click());
    await expect.poll(() => document.body.textContent).toContain("Jev suggests");
    pressEnter();
    expect(tagPatches()).toEqual([{ type: "updateBot", botId: "designergrafico", patch: { tag: "Diretor de Arte" } }]);
  });

  it("takes the first matching tag when Enter is pressed after typing", async () => {
    vi.stubGlobal("fetch", jevAnswers(["Designer"])); drawMenu();
    flushSync(() => menuItem("Create tag")!.click());
    await expect.poll(() => picker()).not.toBeNull();
    type("front");
    pressEnter();
    expect(tagPatches()).toEqual([{ type: "updateBot", botId: "designergrafico", patch: { tag: "Desenvolvedor Front-end" } }]);
  });

  it("creates the typed tag when Enter is pressed and nothing in the catalog matches", async () => {
    vi.stubGlobal("fetch", jevAnswers(["Designer"])); drawMenu();
    flushSync(() => menuItem("Create tag")!.click());
    await expect.poll(() => picker()).not.toBeNull();
    type("QG de Design");
    pressEnter();
    expect(tagPatches()).toEqual([{ type: "updateBot", botId: "designergrafico", patch: { tag: "QG de Design" } }]);
  });

  it("asks Jev nothing for a bot that says nothing about its job", async () => {
    const jev = jevAnswers(["Designer"]);
    vi.stubGlobal("fetch", jev);
    state = { ...state, bots: [{ ...designergrafico, name: "Pixel", title: "", description: "" }] }; drawMenu();
    flushSync(() => menuItem("Create tag")!.click());
    await expect.poll(() => option("Designer")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked(jev)).toEqual([]);
    expect(thinking()).toBeNull();
  });

  it("asks Jev nothing while Jev or its tag job is off", async () => {
    for (const config of [jevWith({ enabled: false }), jevWith({ jobs: { tagSuggest: false } }), null]) {
      const jev = jevAnswers(["Designer"]);
      vi.stubGlobal("fetch", jev);
      state = { ...state, config }; drawMenu();
      flushSync(() => menuItem("Create tag")!.click());
      await expect.poll(() => option("Designer")).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(asked(jev)).toEqual([]);
      expect(thinking()).toBeNull();
      flushSync(() => root.render(null));
    }
  });
});

describe("tag field of the New bot dialog", () => {
  let draft: BotCreationDraft;
  let shown: boolean;
  const drawDraft = (profile: { name: string; title: string; description: string; soul?: string }) => {
    draft = new BotCreationDraft({ profile, memory: {}, skills: [], routines: [] }, () => draw());
    shown = true;
    view = () => shown ? createElement(DraftTag, { draft }) : null;
    draw();
  };
  const leaveAndComeBack = () => { shown = false; draw(); shown = true; draw(); };
  const designerGraficoDraft = { name: "DesignerGrafico", title: "Diretora de arte", description: "", soul: "Nunca diga o nome do cliente." };
  const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label);

  it("fills the tag with Jev's first suggestion and lists the others, from the name, title and description only", async () => {
    const jev = jevAnswers(["Diretor de Arte", "Designer"]);
    vi.stubGlobal("fetch", jev); drawDraft(designerGraficoDraft);
    await expect.poll(() => draft.bot.tag, { timeout: 4_000 }).toBe("Diretor de Arte");
    expect(container.textContent).toContain("Suggested by Jev");
    expect(container.textContent).toContain("Designer");
    expect(askedBody(jev)).toEqual({ name: "DesignerGrafico", title: "Diretora de arte", description: "" });
  });

  it("leaves the tag empty and the dialog usable when Jev is down", async () => {
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    vi.stubGlobal("fetch", down); drawDraft(designerGraficoDraft);
    await expect.poll(() => down.mock.calls.length, { timeout: 4_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(draft.bot.tag).toBeUndefined();
    expect(container.textContent).toContain("Choose a tag");
    expect(container.textContent).not.toContain("Suggested by Jev");
  });

  it("keeps what the person chose over a later suggestion", async () => {
    vi.stubGlobal("fetch", jevAnswers(["Designer", "Branding"])); drawDraft(designerGraficoDraft);
    await expect.poll(() => draft.bot.tag, { timeout: 4_000 }).toBe("Designer");
    flushSync(() => button("Branding")!.click());
    expect(draft.bot.tag).toBe("Branding");
  });

  it("asks Jev nothing while the bot has only its drawn name, and asks once it has a title", async () => {
    const jev = jevAnswers(["Social Media"]);
    vi.stubGlobal("fetch", jev); drawDraft({ name: "Pixel", title: "", description: "" });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(asked(jev)).toEqual([]);
    expect(thinking()).toBeNull();
    draft.patch({ title: "Posts do Instagram" });
    await expect.poll(() => draft.bot.tag, { timeout: 4_000 }).toBe("Social Media");
    expect(askedBody(jev)).toEqual({ name: "Pixel", title: "Posts do Instagram", description: "" });
  });

  it("shows Jev thinking instead of the last answer while a new question is out, and ignores an answer it stopped waiting for", async () => {
    let release: (() => void) | undefined;
    const jev = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const title = JSON.parse(String(init!.body)).title as string;
      if (title === "Diretora de arte") return new Response(JSON.stringify({ tags: ["Diretor de Arte", "Designer"] }));
      if (title === "Contas") {
        await new Promise<void>((resolve) => { release = resolve; });
        return new Response(JSON.stringify({ tags: ["Financeiro"] }));
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", jev); drawDraft(designerGraficoDraft);
    await expect.poll(() => button("Designer"), { timeout: 4_000 }).toBeTruthy();
    draft.patch({ title: "Contas" });
    await expect.poll(() => asked(jev).length, { timeout: 4_000 }).toBe(2);
    expect(thinking()).toBe("Jev is suggesting a tag");
    expect(button("Designer")).toBeUndefined();
    draft.patch({ title: "Posts do Instagram" });
    await expect.poll(() => asked(jev).length, { timeout: 4_000 }).toBe(3);
    release!();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(draft.bot.tag).toBe("Diretor de Arte");
    expect(button("Financeiro")).toBeUndefined();
    expect(thinking()).toBe("Jev is suggesting a tag");
  });

  it("keeps a removed tag removed after the person leaves the Identity section and comes back", async () => {
    vi.stubGlobal("fetch", jevAnswers(["Designer"])); drawDraft(designerGraficoDraft);
    await expect.poll(() => draft.bot.tag, { timeout: 4_000 }).toBe("Designer");
    flushSync(() => container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click());
    flushSync(() => option("Remove tag")!.click());
    expect(draft.bot.tag).toBe("");
    leaveAndComeBack();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(draft.bot.tag).toBe("");
  });

  it("still says the tag came from Jev after the person comes back to the Identity section", async () => {
    vi.stubGlobal("fetch", jevAnswers(["Designer"])); drawDraft(designerGraficoDraft);
    await expect.poll(() => draft.bot.tag, { timeout: 4_000 }).toBe("Designer");
    leaveAndComeBack();
    expect(container.textContent).toContain("Suggested by Jev");
  });
});
