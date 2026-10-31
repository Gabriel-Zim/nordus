// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ config: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }) }));

const { CompanyField } = await import("./CompanyField");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  setLocale("en");
  fixture.config = { profile: { name: "Ana", email: "", company: "Alves Studio" } };
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const field = () => host.querySelector<HTMLInputElement>('input[aria-label="Company name"]')!;

describe("the company name in Settings", () => {
  it("shows the name saved for the workspace", async () => {
    await act(async () => root.render(createElement(CompanyField)));
    expect(field().value).toBe("Alves Studio");
  });

  it("saves a changed name when the person leaves the field, and only that", async () => {
    fixture.api.mockResolvedValue({ profile: { name: "Ana", email: "", company: "Alves & Co" } });
    await act(async () => root.render(createElement(CompanyField)));

    await act(async () => type(field(), "  Alves   & Co "));
    await act(async () => field().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));

    expect(fixture.api).toHaveBeenCalledWith("/api/config", { method: "PUT", body: JSON.stringify({ profile: { company: "Alves & Co" } }) });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "profileSaved", profile: { company: "Alves & Co" } });
  });

  it("sends nothing when the name did not change", async () => {
    await act(async () => root.render(createElement(CompanyField)));
    await act(async () => field().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("puts the saved name back when the save fails", async () => {
    fixture.api.mockRejectedValue(new Error("offline"));
    await act(async () => root.render(createElement(CompanyField)));
    await act(async () => type(field(), "Other"));
    await act(async () => field().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(field().value).toBe("Alves Studio");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
});
