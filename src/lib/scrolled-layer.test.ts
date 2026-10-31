// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { markScrolledLayer, watchScrolledLayers } from "./scrolled-layer";

afterEach(() => {
  document.body.innerHTML = "";
});

function layer() {
  document.body.innerHTML = `<aside data-room-info><div data-layer-head></div><div data-layer-body></div><div class="other"></div></aside>`;
  return {
    root: document.querySelector("aside")!,
    body: document.querySelector<HTMLElement>("[data-layer-body]")!,
    other: document.querySelector<HTMLElement>(".other")!,
  };
}

describe("scrolled layers", () => {
  it("marks the screen once its body scrolls and clears it back at the top", () => {
    const { root, body } = layer();
    body.scrollTop = 40;
    markScrolledLayer(body);
    expect(root.hasAttribute("data-scrolled")).toBe(true);
    body.scrollTop = 0;
    markScrolledLayer(body);
    expect(root.hasAttribute("data-scrolled")).toBe(false);
  });

  it("ignores scrollers that are not a layer body", () => {
    const { root, other } = layer();
    other.scrollTop = 40;
    markScrolledLayer(other);
    expect(root.hasAttribute("data-scrolled")).toBe(false);
  });

  it("hears a body's scroll through one document listener", () => {
    const { root, body } = layer();
    const stop = watchScrolledLayers();
    body.scrollTop = 40;
    body.dispatchEvent(new Event("scroll"));
    expect(root.hasAttribute("data-scrolled")).toBe(true);
    stop();
  });
});
