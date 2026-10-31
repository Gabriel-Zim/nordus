import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { StarterRequests } from "./StarterRequests";

describe("StarterRequests", () => {
  it("offers three requests as buttons that hand the text to the caller", () => {
    setLocale("pt-br");
    const onPick = vi.fn();
    const tree = StarterRequests({ bot: { title: "Designer" }, onPick });
    const markup = renderToStaticMarkup(createElement(StarterRequests, { bot: { title: "Designer" }, onPick }));
    expect(markup.match(/<button/g)).toHaveLength(3);
    expect(markup).toContain("Comece por um destes pedidos");
    expect(markup).toContain("Como Designer, o que você pode adiantar para mim hoje?");
    const buttons = (tree.props.children as unknown[]).flat().filter((node): node is { type: string; props: { onClick: () => void } } => typeof node === "object" && node !== null && (node as { type?: string }).type === "button");
    buttons[0]!.props.onClick();
    expect(onPick).toHaveBeenCalledWith("Me explique o que você faz e como posso pedir as coisas.");
  });
});
