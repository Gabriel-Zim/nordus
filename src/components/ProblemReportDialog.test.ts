// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ProblemReportDialog } from "./ProblemReportDialog";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
  openBotThread: vi.fn(),
  bots: [{ id: "tecnico", threadId: "tecnico-main", name: "TECNICO" }],
}));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  openBotThread: fixture.openBotThread,
  useStore: () => ({ state: { bots: fixture.bots }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));

let host: HTMLDivElement;
let root: Root;
const onClose = vi.fn<() => void>();
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const q = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const type = (field: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  flushSync(() => field.dispatchEvent(new Event("input", { bubbles: true })));
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label)!;

beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.openBotThread.mockReset();
  onClose.mockReset();
  setLocale("pt-br");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(ProblemReportDialog, { threadId: "thread 1", onClose })));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setLocale("en");
});

describe("problem report", () => {
  it("builds the preview from the description and the chosen excerpt, then sends the edited text", async () => {
    expect(q('[role="radiogroup"]').getAttribute("aria-label")).toBe("Quantas mensagens do fim da conversa levar");
    expect(q('[role="radio"][aria-checked="true"]').textContent).toBe("Nada");
    type(q("[data-report-description]"), "  O robô travou  ");
    flushSync(() => button("5").click());
    fixture.api.mockResolvedValueOnce({ text: "Relato\nsenha: [oculto]", target: { botId: "tecnico", name: "TECNICO", fallback: false } });
    flushSync(() => button("Montar prévia").click());
    await settle();
    expect(fixture.api).toHaveBeenCalledWith("/api/threads/thread%201/problem-report/preview", { method: "POST", body: JSON.stringify({ excerpt: 5, description: "O robô travou" }) });
    expect(q<HTMLTextAreaElement>("[data-report-text]").value).toBe("Relato\nsenha: [oculto]");
    expect(document.body.textContent).toContain("Segredos como senhas e chaves já foram ocultados.");
    expect(q("[data-report-target]").textContent).toBe("Vai para: TECNICO");
    expect(document.body.textContent).not.toContain("Chief of Staff");

    type(q("[data-report-text]"), "Relato editado");
    fixture.api.mockResolvedValueOnce({ target: { botId: "tecnico", name: "TECNICO", fallback: false }, threadId: "new-task" });
    flushSync(() => button("Enviar ao TECNICO").click());
    await settle();
    expect(fixture.api).toHaveBeenLastCalledWith("/api/threads/thread%201/problem-report", { method: "POST", body: JSON.stringify({ text: "Relato editado", description: "O robô travou" }) });
    expect(q('[role="status"]').textContent).toBe("Relato enviado. TECNICO abriu uma tarefa para investigar.");

    flushSync(() => button("Abrir a tarefa").click());
    expect(fixture.openBotThread).toHaveBeenCalledWith(fixture.dispatch, fixture.bots[0], "new-task", true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("names the fallback robot and drops a stale preview when the excerpt changes", async () => {
    fixture.api.mockResolvedValueOnce({ text: "Relato", target: { botId: "cos", name: "CHIEF OF STAFF", fallback: true } });
    flushSync(() => button("Montar prévia").click());
    await settle();
    expect(document.body.textContent).toContain("O TECNICO não existe neste servidor, então vai para o Boss.");
    expect(button("Enviar ao CHIEF OF STAFF")).toBeDefined();
    flushSync(() => button("5").click());
    expect(document.querySelector("[data-report-text]")).toBeNull();
    expect(button("Montar prévia")).toBeDefined();
  });

  it("keeps the edited text and says what went wrong when sending fails", async () => {
    fixture.api.mockResolvedValueOnce({ text: "Relato", target: { botId: "tecnico", name: "TECNICO", fallback: false } });
    flushSync(() => button("Montar prévia").click());
    await settle();
    fixture.api.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    flushSync(() => button("Enviar ao TECNICO").click());
    await settle();
    expect(q('[role="alert"]').textContent!.startsWith("Não deu certo.")).toBe(true);
    expect(q<HTMLTextAreaElement>("[data-report-text]").value).toBe("Relato");
    expect(onClose).not.toHaveBeenCalled();
  });
});
