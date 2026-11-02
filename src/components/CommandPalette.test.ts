// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dispatch = vi.fn();
vi.mock("@/state/store", () => ({
  api: vi.fn(async () => ({ hits: [] })),
  openBot: vi.fn(),
  useStore: () => ({
    state: {
      bots: [{ id: "social", name: "Social", title: "Social media", threadId: "s1", busy: true }, { id: "gerentedeoperacao", name: "GerenteDeOperacao", title: "", threadId: "d1" }],
      groups: [],
      selectedId: "gerentedeoperacao",
    },
    dispatch,
  }),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/lib/use-viewer", () => ({ useGuest: () => false }));

const { CommandPalette } = await import("./CommandPalette");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("pt-br");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(CommandPalette, {})));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

const press = (init: KeyboardEventInit) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ...init })); });

describe("the search palette", () => {
  it("opens with Ctrl+K or Cmd+K in the reader's language and lists the bots", () => {
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    press({ ctrlKey: true });
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Buscar robô ou conversa");
    expect(dialog.querySelector("input")!.placeholder).toBe("Buscar robôs, grupos e mensagens…");
    expect(dialog.textContent).toContain("Robôs");
    expect(dialog.textContent).toContain("Social");
    press({ metaKey: true });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("says in Portuguese when nothing matches", () => {
    press({ ctrlKey: true });
    const input = host.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("Nada encontrado para “zzz”");
  });
});

describe("palette actions", () => {
  const search = (text: string) => {
    const input = host.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const pick = (label: string) => {
    const button = [...host.querySelectorAll("button")].find((entry) => entry.textContent === label)!;
    act(() => button.click());
  };

  it("offers a new conversation with the open bot, a new bot, stop all, settings and shortcuts", () => {
    press({ ctrlKey: true });
    const text = host.textContent!;
    expect(text).toContain("Ações");
    expect(text).toContain("Nova conversa com GerenteDeOperacao");
    expect(text).toContain("Criar um bot novo");
    expect(text).toContain("Parar tudo que está rodando (1)");
    expect(text).toContain("Abrir as configurações");
    expect(text).toContain("Ver os atalhos de teclado");
  });

  it("finds an action by its words and runs it", () => {
    press({ ctrlKey: true });
    search("parar");
    expect(host.textContent).not.toContain("Abrir as configurações");
    dispatch.mockClear();
    pick("Parar tudo que está rodando (1)");
    expect(dispatch).toHaveBeenCalledWith({ type: "interrupt", botId: "social", threadId: "s1" });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("starts the new conversation with Enter once it is the only match", () => {
    press({ ctrlKey: true });
    search("nova conversa");
    dispatch.mockClear();
    act(() => { host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(dispatch).toHaveBeenCalledWith({ type: "newTask", botId: "gerentedeoperacao" });
  });
});
