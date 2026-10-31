// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { parseWidgetInput, widgetActions, type WidgetRoot } from "../../../shared/widget";
import { WidgetMessage } from "./WidgetMessage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIGMA = "https://www.figma.com/design/fL6yTv6Fp5Av6HsN3rfyp1/?node-id=73-16";

function parse(input: unknown): WidgetRoot {
  const parsed = parseWidgetInput(input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
const row = (root: WidgetRoot): Message => ({ id: "w1", role: "bot", kind: "widget", at: 1, text: "fallback", widget: { v: 1, root } });
const card = (...children: unknown[]) => parse({ type: "Card", title: "Aprovar entrega", children, confirm: { label: "Aprovar", action: { type: "approve" } } });

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const store = { state: {}, dispatch: vi.fn(), flushBotPatches: vi.fn(async () => null) } as unknown as ReturnType<typeof useStore>;

let host: HTMLDivElement;
let root: Root;
const mount = (root_: WidgetRoot) => act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(WidgetMessage, { botId: "scout", threadId: "t1", message: row(root_) }) })));
const find = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const all = <T extends Element = HTMLElement>(selector: string) => Array.from(host.querySelectorAll<T>(selector));
const press = (element: HTMLElement) => act(async () => { element.click(); });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an address inside a card's words", () => {
  it("reads as the site's icon and a short phrase, with the words around it kept", () => {
    mount(card({ type: "Text", value: `Arquivo editável no Figma: ${FIGMA}` }));
    const link = find<HTMLAnchorElement>('[data-widget="w1"] a')!;
    expect(link.getAttribute("href")).toBe(FIGMA);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(link.getAttribute("title")).toBe(FIGMA);
    expect(link.querySelector("img")!.getAttribute("src")).toBe("/brand/figma.svg");
    expect(link.textContent).toBe(t("chat.link.seeOn", { site: "Figma" }));
    const words = link.parentElement!;
    expect(words.textContent).toBe(`Arquivo editável no Figma: ${t("chat.link.seeOn", { site: "Figma" })}`);
    expect(find('[data-widget="w1"]')!.textContent).not.toContain("figma.com");
  });

  it("works the same in a title and a caption, and leaves the sentence's closing mark outside the link", () => {
    mount(card({ type: "Title", value: "Veja https://figma.com/x." }, { type: "Caption", value: "Ou https://github.com/a/b?c=1, depois." }));
    expect(all<HTMLAnchorElement>('[data-widget="w1"] a').map((link) => link.getAttribute("href"))).toEqual(["https://figma.com/x", "https://github.com/a/b?c=1"]);
    expect(find('[data-widget="w1"]')!.textContent).toContain(`Veja ${t("chat.link.seeOn", { site: "Figma" })}.`);
    expect(find('[data-widget="w1"]')!.textContent).toContain(`Ou ${t("chat.link.seeOn", { site: "GitHub" })}, depois.`);
  });

  it("never loads the picture or video it points to inside the card", () => {
    mount(card({ type: "Text", value: "Prévia: https://example.com/a.png e https://example.com/b.mp4" }));
    expect(all("video")).toHaveLength(0);
    expect(all("img").map((image) => image.getAttribute("src"))).not.toContain("https://example.com/a.png");
    expect(all<HTMLAnchorElement>('[data-widget="w1"] a').map((link) => link.getAttribute("href"))).toEqual(["https://example.com/a.png", "https://example.com/b.mp4"]);
  });

  it("still cuts a one-line text at the edge", () => {
    mount(card({ type: "Text", truncate: true, value: `Arquivo: ${FIGMA}` }));
    const words = find<HTMLAnchorElement>('[data-widget="w1"] a')!.parentElement!;
    expect(words.classList.contains("truncate")).toBe(true);
  });

  it("opens the address without pressing the row it sits in", async () => {
    const list = parse({ type: "ListView", children: [{ type: "ListViewItem", onClickAction: { type: "row.open" }, children: [{ type: "Text", value: `Arquivo: ${FIGMA}` }] }] });
    const [entry] = widgetActions(list);
    mount(list);
    const holder = find(`[data-widget-ref="${entry!.ref}"]`)!;
    expect(holder.querySelector("a")).not.toBeNull();
    expect(holder.tagName).toBe("DIV");

    host.addEventListener("click", (event) => { if ((event.target as Element).closest("a")) event.preventDefault(); });
    await press(holder.querySelector<HTMLAnchorElement>("a")!);
    expect(fetchMock).not.toHaveBeenCalled();
    await press(holder);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
