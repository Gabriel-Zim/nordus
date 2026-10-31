import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TeachStatus } from "../../shared/teach.ts";
import type { CdpEvents, CdpEventHandler } from "./cdp.ts";
import { TEACH_BINDING } from "./page-script.ts";
import { TeachError, TeachRecorder } from "./recorder.ts";

const PASSWORD = "Sup3r-Secreta-9981";
const OTP = "482913";
const JPEG = Buffer.from("fakejpeg").toString("base64");

/** Um Chrome falso em memoria: guarda as chamadas e deixa o teste soltar eventos. */
function fakeChrome(pages: Array<{ targetId: string; url: string; title: string }>) {
  const calls: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = [];
  const handlers = new Set<CdpEventHandler>();
  let closed = false;
  const cdp: CdpEvents = {
    async send(method, params = {}, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Target.getTargets") return { targetInfos: pages.map((p) => ({ ...p, type: "page" })) };
      if (method === "Target.attachToTarget") return { sessionId: `s-${params.targetId}` };
      if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 1000, clientHeight: 600 } };
      if (method === "Page.captureScreenshot") return { data: JPEG };
      return {};
    },
    on(handler) { handlers.add(handler); return () => { handlers.delete(handler); }; },
    close() { closed = true; handlers.clear(); },
  };
  const emit = (method: string, params: Record<string, unknown>, sessionId?: string) => { for (const h of handlers) h(method, params, sessionId); };
  const binding = (sessionId: string, payload: unknown) => emit("Runtime.bindingCalled", { name: TEACH_BINDING, payload: JSON.stringify(payload) }, sessionId);
  return { cdp, calls, emit, binding, isClosed: () => closed };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "teach-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

async function begin(chrome: ReturnType<typeof fakeChrome>, extra: Partial<ConstructorParameters<typeof TeachRecorder>[0]> = {}) {
  const changes: TeachStatus[] = [];
  const recorder = new TeachRecorder({ dir, cdpUrl: async () => "ws://127.0.0.1:1/devtools/browser/x", connect: async () => chrome.cdp, onChange: (_b, s) => changes.push(s), ...extra });
  const started = await recorder.start({ botId: "bot1", threadId: "t1", owner: "dono" });
  await recorder.whenReady("bot1");
  return { recorder, started, changes };
}

describe("TeachRecorder", () => {
  it("anexa nas paginas, liga o script e grava clique, digitacao, navegacao e troca de aba", async () => {
    const chrome = fakeChrome([{ targetId: "A", url: "https://suporte.exemplo.com/", title: "Suporte" }, { targetId: "B", url: "https://outra.com/", title: "Outra" }]);
    const { recorder, started } = await begin(chrome);
    expect(started.state).toBe("starting");
    expect(recorder.status("bot1").state).toBe("recording");
    for (const m of ["Page.enable", "Runtime.enable", "Runtime.addBinding", "Page.addScriptToEvaluateOnNewDocument", "Runtime.evaluate"]) {
      expect(chrome.calls.filter((c) => c.method === m && c.sessionId === "s-A")).toHaveLength(1);
    }
    chrome.emit("Page.frameNavigated", { frame: { id: "f", url: "https://suporte.exemplo.com/caixa" } }, "s-A");
    chrome.emit("Page.frameNavigated", { frame: { id: "f", url: "https://suporte.exemplo.com/caixa" } }, "s-A"); // repetida
    chrome.emit("Page.frameNavigated", { frame: { id: "g", parentId: "f", url: "https://ads.com/" } }, "s-A"); // subframe
    chrome.binding("s-A", { t: "click", text: "Responder", role: "button", selector: "#r" });
    chrome.binding("s-A", { t: "type", field: "Mensagem", selector: "#m", value: "o" });
    chrome.binding("s-A", { t: "type", field: "Mensagem", selector: "#m", value: "oi, tudo bem?" });
    chrome.binding("s-A", { t: "scroll", direction: "down", amount: 100 });
    chrome.binding("s-A", { t: "scroll", direction: "down", amount: 50 });
    chrome.binding("s-A", { t: "click", text: "Enviar", role: "button", selector: "#e" });
    chrome.binding("s-B", { t: "click", text: "Outro", role: "link", selector: "a" });
    await recorder.idle("bot1");
    const kinds = recorder.status("bot1").steps.map((s) => s.action.kind);
    expect(kinds).toEqual(["navigate", "click", "type", "scroll", "click", "tab", "click"]);
    const steps = recorder.status("bot1").steps;
    expect(steps[2]!.action).toMatchObject({ kind: "type", value: "oi, tudo bem?" });
    expect(steps[3]!.action).toMatchObject({ kind: "scroll", amount: 150 });
    expect(steps[4]!.critical).toBe(true);
    expect(steps[1]!.critical).toBeUndefined();
    expect(steps[1]!.shot).toBe("2.jpg");
    const { recording } = (await recorder.stop("bot1", "dono"))!;
    expect(recording.steps).toHaveLength(7);
    expect(existsSync(join(dir, "bot1", recording.id, "recording.json"))).toBe(true);
    expect(chrome.isClosed()).toBe(true);
    expect(recorder.status("bot1")).toMatchObject({ recording: false, state: "summarizing" });
    recorder.done("bot1");
    expect(recorder.status("bot1")).toEqual({ recording: false, steps: [] });
  });

  it("nunca guarda valor de senha nem de OTP, e nao tira print do passo secreto", async () => {
    const chrome = fakeChrome([{ targetId: "A", url: "https://login.exemplo.com/", title: "Entrar" }]);
    const { recorder } = await begin(chrome);
    chrome.binding("s-A", { t: "type", field: "E-mail", selector: "#u", value: "eu@exemplo.com" });
    chrome.binding("s-A", { t: "type", field: "Senha", selector: "#p", inputType: "password", value: PASSWORD, secret: "password" });
    chrome.binding("s-A", { t: "type", field: "Codigo", selector: "#c", autocomplete: "one-time-code", value: OTP });
    chrome.binding("s-A", { t: "click", text: "Continuar", role: "button", selector: "#go" });
    await recorder.idle("bot1");
    const steps = recorder.status("bot1").steps;
    expect(steps.map((s) => s.action.kind)).toEqual(["type", "type-secret", "type-secret", "click"]);
    expect(steps[1]!.shot).toBeUndefined();
    expect(steps[2]!.shot).toBeUndefined();
    // 60 s sem print depois de codigo: o clique que veio em seguida tambem nao tem print.
    expect(steps[3]!.shot).toBeUndefined();
    const { recording } = (await recorder.stop("bot1", "dono"))!;
    const everything = JSON.stringify(recording) + JSON.stringify(recorder.status("bot1")) +
      readFileSync(join(dir, "bot1", recording.id, "recording.json"), "utf8");
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(OTP);
    for (const f of readdirSync(join(dir, "bot1", recording.id))) {
      if (f.endsWith(".jpg")) continue;
      expect(readFileSync(join(dir, "bot1", recording.id, f), "utf8")).not.toContain(PASSWORD);
    }
  });

  it("segura 409 quando ja grava, e so o dono (ou admin) para", async () => {
    const chrome = fakeChrome([{ targetId: "A", url: "https://a.com/", title: "A" }]);
    const { recorder } = await begin(chrome);
    await expect(recorder.start({ botId: "bot1", threadId: "t2", owner: "dono" })).rejects.toMatchObject({ status: 409 });
    await expect(recorder.stop("bot1", "outro")).rejects.toBeInstanceOf(TeachError);
    expect(await recorder.stop("bot1", "outro", { admin: true })).not.toBeNull();
    expect(await recorder.stop("bot1", "dono")).toBeNull();
  });

  it("falha limpa quando o navegador nao aparece", async () => {
    const changes: TeachStatus[] = [];
    const recorder = new TeachRecorder({ dir, cdpUrl: async () => null, onChange: (_b, s) => changes.push(s) });
    await recorder.start({ botId: "bot1", threadId: "t1", owner: "dono" });
    await recorder.whenReady("bot1");
    expect(recorder.status("bot1").recording).toBe(false);
    expect(changes[changes.length - 1]!.error).toMatch(/navegador/);
  });

  it("para sozinha no limite de passos e avisa", async () => {
    const chrome = fakeChrome([{ targetId: "A", url: "https://a.com/", title: "A" }]);
    let auto = 0;
    const { recorder } = await begin(chrome, { maxSteps: 3, onAutoStop: () => { auto++; } });
    for (let i = 0; i < 6; i++) chrome.binding("s-A", { t: "click", text: `b${i}`, role: "button", selector: `#b${i}` });
    await recorder.idle("bot1");
    await new Promise((r) => setTimeout(r, 20));
    expect(auto).toBe(1);
    expect(recorder.status("bot1")).toMatchObject({ recording: false, state: "summarizing" });
    expect(recorder.status("bot1").steps).toHaveLength(3);
  });

  it("cancel descarta tudo; miniatura so de passo existente", async () => {
    const chrome = fakeChrome([{ targetId: "A", url: "https://a.com/", title: "A" }]);
    const { recorder } = await begin(chrome);
    chrome.binding("s-A", { t: "click", text: "x", role: "button", selector: "#x" });
    await recorder.idle("bot1");
    expect(recorder.shotPath("bot1", 1)).toMatch(/1\.jpg$/);
    expect(recorder.shotPath("bot1", 9)).toBeNull();
    expect(recorder.shotPath("../x", 1)).toBeNull();
    recorder.cancel("bot1");
    expect(recorder.status("bot1")).toEqual({ recording: false, steps: [] });
    expect(chrome.isClosed()).toBe(true);
  });
});
