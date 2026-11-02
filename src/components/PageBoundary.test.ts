// @vitest-environment happy-dom
import { createElement, useEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageBoundary } from "./PageBoundary";

function Broken() {
  useEffect(() => {
    throw new TypeError("desktop.shown is not a function");
  }, []);
  return createElement("p", null, "the page");
}

describe("PageBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the page up, with the error and a reload, when a part of it throws in an effect", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(createElement(PageBoundary, null, createElement(Broken))));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.textContent).toContain("This page hit an error.");
    expect(host.textContent).toContain("desktop.shown is not a function");
    expect(host.querySelector("button")?.textContent).toBe("Reload");
    root.unmount();
    host.remove();
  });

  it("says it in the reader's language", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { setLocale } = await import("@/lib/i18n");
    setLocale("pt-br");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      flushSync(() => root.render(createElement(PageBoundary, null, createElement(Broken))));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(host.textContent).toContain("Esta tela deu um erro.");
      expect(host.querySelector("button")?.textContent).toBe("Recarregar");
    } finally {
      root.unmount();
      host.remove();
      setLocale("en");
    }
  });

  it("shows the page itself while nothing throws", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(createElement(PageBoundary, null, createElement("p", null, "the page"))));
    expect(host.textContent).toBe("the page");
    root.unmount();
    host.remove();
  });
});
