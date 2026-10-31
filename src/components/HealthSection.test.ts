// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { DoctorReport } from "../../shared/doctor";
import { HealthSection, healthSummary } from "./HealthSection";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ api }));

const report: DoctorReport = {
  version: "0.1.112",
  startedAt: "2026-10-19T12:00:00.000Z",
  durationMs: 1200,
  status: "fail",
  counts: { ok: 1, warn: 1, fail: 1 },
  checks: [
    { id: "disk", group: "disk", label: "Espaço em disco", status: "warn", detail: "Restam 3 GB.", fix: "Apague arquivos antigos." },
    { id: "engine:claude", group: "engines", label: "Claude", status: "fail", detail: "O Claude não responde.", fix: "Entre de novo na conta do Claude.", technical: "claude --version exited 1" },
    { id: "database:app", group: "databases", label: "Banco principal", status: "ok", detail: "Tudo certo." },
  ],
};

let host: HTMLDivElement;
let root: Root;
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const refreshButton = () => host.querySelector<HTMLButtonElement>("[data-health-refresh]")!;

beforeEach(() => {
  api.mockReset();
  setLocale("pt-br");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setLocale("en");
});

describe("Nordus health", () => {
  it("says how things stand in one line", () => {
    expect(healthSummary(report)).toBe("1 falha e 1 ponto de atenção");
    expect(healthSummary({ ...report, status: "warn", counts: { ok: 1, warn: 2, fail: 0 } })).toBe("2 pontos de atenção");
    expect(healthSummary({ ...report, status: "ok", counts: { ok: 3, warn: 0, fail: 0 } })).toBe("Tudo funcionando");
  });

  it("groups the checks in a fixed order, shows a failure with its fix and folds the technical text", async () => {
    api.mockResolvedValue(report);
    flushSync(() => root.render(createElement(HealthSection)));
    await settle();
    expect(api).toHaveBeenCalledWith("/api/doctor", expect.objectContaining({ timeoutMs: expect.any(Number) }));
    expect([...host.querySelectorAll("[data-health-group]")].map((group) => group.getAttribute("data-health-group"))).toEqual(["engines", "disk", "databases"]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("1 falha e 1 ponto de atenção");
    const failed = host.querySelector('[data-health-check="engine:claude"]')!;
    expect(failed.textContent).toContain("Falha");
    expect(failed.textContent).toContain("O Claude não responde.");
    expect(failed.textContent).toContain("O que fazer: Entre de novo na conta do Claude.");
    const details = failed.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Detalhes");
    expect(details.textContent).toContain("claude --version exited 1");
    const ok = host.querySelector('[data-health-check="database:app"]')!;
    expect(ok.textContent).toContain("OK");
    expect(ok.textContent).not.toContain("O que fazer");
    expect(ok.querySelector("details")).toBeNull();
  });

  it("checks again on request, with the button off while it runs", async () => {
    api.mockResolvedValueOnce(report);
    flushSync(() => root.render(createElement(HealthSection)));
    await settle();
    let finish!: (value: DoctorReport) => void;
    api.mockReturnValueOnce(new Promise<DoctorReport>((resolve) => { finish = resolve; }));
    flushSync(() => refreshButton().click());
    expect(api).toHaveBeenLastCalledWith("/api/doctor?refresh=1", expect.anything());
    expect(refreshButton().disabled).toBe(true);
    expect(refreshButton().textContent).toBe("Verificando…");
    finish({ ...report, status: "ok", counts: { ok: 3, warn: 0, fail: 0 }, checks: report.checks.map((check) => ({ ...check, status: "ok" as const, fix: undefined })) });
    await settle();
    expect(refreshButton().disabled).toBe(false);
    expect(refreshButton().textContent).toBe("Verificar de novo");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Tudo funcionando");
  });

  it("explains a failed check in plain words", async () => {
    api.mockRejectedValue(new TypeError("Failed to fetch"));
    flushSync(() => root.render(createElement(HealthSection)));
    await settle();
    const alert = host.querySelector('[role="alert"]')!.textContent!;
    expect(alert.startsWith("Não foi possível verificar agora.")).toBe(true);
    expect(alert).not.toContain("Failed to fetch");
  });
});
