import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { SkeletonMessages, SkeletonRows } from "./Skeleton";

describe("skeletons", () => {
  it("draws list rows as a busy status with a spoken label and no motion for people who ask for less", () => {
    setLocale("pt-br");
    const markup = renderToStaticMarkup(createElement(SkeletonRows, { count: 4 }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="Carregando conversas"');
    expect(markup.match(/size-9/g)).toHaveLength(4);
    expect(markup).toContain("motion-safe:animate-pulse");
    expect(markup).not.toMatch(/(?<!motion-safe:)animate-spin/);
  });

  it("draws earlier messages as bubbles on both sides", () => {
    setLocale("pt-br");
    const markup = renderToStaticMarkup(createElement(SkeletonMessages));
    expect(markup).toContain('aria-label="Carregando mensagens anteriores…"');
    expect(markup).toContain("justify-end");
    expect(markup).toContain("justify-start");
  });
});
