// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { QuietHoursRow } from "./NotificationSettingsRows";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  setLocale("pt-br");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  setLocale("en");
});

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("the quiet hours row", () => {
  it("starts off from 22h to 8h, and turning it on saves to the server and shows the hours", async () => {
    const fetch = vi.fn(async (_path: string, init?: RequestInit) => reply({
      quietHours: init?.body ? JSON.parse(String(init.body)) : { enabled: false, start: "22:00", end: "08:00" }, timeZone: "America/Sao_Paulo", canEdit: true,
    }));
    vi.stubGlobal("fetch", fetch);
    flushSync(() => root.render(createElement(QuietHoursRow)));
    await vi.waitFor(() => expect(host.textContent).toContain("Horário silencioso"));
    expect(host.textContent).toContain("Aprovação, pergunta, pedido de login e alerta de gasto sempre tocam");
    expect(host.querySelector("input[type=time]")).toBeNull();

    flushSync(() => host.querySelector<HTMLButtonElement>("[aria-label='Ligar o horário silencioso']")!.click());
    await vi.waitFor(() => expect(host.querySelectorAll("input[type=time]")).toHaveLength(2));
    expect(fetch).toHaveBeenLastCalledWith("/api/notifications/quiet-hours", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ enabled: true, start: "22:00", end: "08:00", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    }));
    const [start, end] = host.querySelectorAll<HTMLInputElement>("input[type=time]");
    expect([start!.value, end!.value]).toEqual(["22:00", "08:00"]);
  });

  it("stays hidden for someone who cannot change it", async () => {
    const fetch = vi.fn(async () => reply({ quietHours: { enabled: false, start: "22:00", end: "08:00" }, timeZone: "America/Sao_Paulo", canEdit: false }));
    vi.stubGlobal("fetch", fetch);
    flushSync(() => root.render(createElement(QuietHoursRow)));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.textContent).toBe("");
  });
});
