// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreContext } from "@/state/store";
import { AttachmentGallery, type GalleryFile } from "./AttachmentGallery";

const appended = vi.fn();
vi.mock("@/lib/drafts", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/drafts")>()), appendComposerDraft: (...args: unknown[]) => appended(...args) }));

const reply = { threadId: "origin", messageId: "reply" };
const page: GalleryFile = { path: "/store/3a9d41c7-52be.html", name: "ideias.html", private: true };
const pageUrl = "/api/threads/origin/messages/reply/file?html=1&name=3a9d41c7-52be.html";
const store = { state: { bots: [{ id: "estrategistadeconteudo", threadId: "origin" }], groups: [] } } as unknown as React.ContextType<typeof StoreContext>;

let container: HTMLDivElement;
let root: Root;

async function render(files: GalleryFile[]) {
  await act(async () => root.render(createElement(StoreContext.Provider, { value: store }, createElement(AttachmentGallery, { files, message: reply, beneath: true }))));
}
const frame = () => container.querySelector<HTMLIFrameElement>("iframe")!;
/** Gives the frame a stand-in window, so a message can be sent "from" it. */
function fakeWindow(target: HTMLIFrameElement) {
  const win = { postMessage: vi.fn() } as unknown as Window;
  Object.defineProperty(target, "contentWindow", { value: win, configurable: true });
  return win;
}
async function send(data: unknown, source: unknown) {
  await act(async () => { window.dispatchEvent(new MessageEvent("message", { data, source: source as MessageEventSource })); });
}
const say = (texto: string) => ({ tipo: "nordus:responder", versao: 1, texto });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  appended.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "ola" }), { status: 200 })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("HtmlAttachment", () => {
  it("frames a stored .html attachment in a sandbox without allow-same-origin", async () => {
    await render([page]);
    const iframe = frame();
    expect(iframe.getAttribute("src")).toBe(pageUrl);
    const sandbox = iframe.getAttribute("sandbox")!;
    expect(sandbox.split(" ").sort()).toEqual(["allow-popups", "allow-popups-to-escape-sandbox", "allow-scripts"]);
    expect(sandbox).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.getAttribute("loading")).toBe("lazy");
    expect(iframe.getAttribute("allow")).toBe("microphone");
    expect(iframe.getAttribute("title")).toBe("ideias.html");
  });

  it("offers full screen, a new tab and the existing download", async () => {
    await render([page]);
    const link = container.querySelector<HTMLAnchorElement>(`a[href="${pageUrl}"]`)!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector("[data-html-resize]")).not.toBeNull();
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Full screen"))!;
    await act(async () => open.click());
    const dialog = document.querySelector("[data-html-fullscreen]")!;
    expect(dialog.querySelector("iframe")!.getAttribute("sandbox")).not.toContain("allow-same-origin");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector("[data-html-fullscreen]")).toBeNull();
  });

  it("does not frame a file that is not a stored html page", async () => {
    await render([{ path: "/store/notes.pdf", name: "notes.pdf", private: true }, { path: "/work/page.html", name: "page.html", linked: true }]);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("puts a reply in the draft box, never sends it, and ignores messages from anything but its own frame", async () => {
    await render([page]);
    const win = fakeWindow(frame());
    await send(say("nao"), {});
    await send(say("nao"), window);
    await send(say("nao"), null);
    expect(appended).not.toHaveBeenCalled();
    await send(say("Ideia 2 com ajustes"), win);
    expect(appended).toHaveBeenCalledWith("bot:estrategistadeconteudo:origin", "Ideia 2 com ajustes");
    expect(container.ownerDocument.body.textContent).toContain("Your board changes are in the message box");
  });

  it("ignores an identical reply within a second, a wrong version and an oversized text", async () => {
    await render([page]);
    const win = fakeWindow(frame());
    await send(say("igual"), win);
    await send(say("igual"), win);
    await send({ ...say("v2"), versao: 2 }, win);
    expect(appended).toHaveBeenCalledTimes(1);
    await send(say("x".repeat(20_001)), win);
    expect(appended).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("too long");
  });

  it("takes the page's height until the person drags the handle", async () => {
    await render([page]);
    const win = fakeWindow(frame());
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    await send({ tipo: "nordus:altura", versao: 1, altura: 500 }, win);
    expect(frame().style.height).toBe("500px");
    await send({ tipo: "nordus:altura", versao: 1, altura: 5000 }, win);
    expect(frame().style.height).toBe("850px");
    const handle = container.querySelector<HTMLElement>("[data-html-resize]")!;
    await act(async () => { handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: 100 })); });
    await act(async () => { handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); });
    await send({ tipo: "nordus:altura", versao: 1, altura: 300 }, win);
    expect(frame().style.height).toBe("850px");
  });

  it("stores a board draft per message and attachment, and hands it back when the frame loads", async () => {
    await render([page]);
    const win = fakeWindow(frame());
    await send({ tipo: "nordus:rascunho", versao: 1, dados: { ideia: 2 } }, win);
    expect(localStorage.getItem("nordus:html-draft:origin:reply:3a9d41c7-52be.html")).toBe('{"ideia":2}');
    await act(async () => { frame().dispatchEvent(new Event("load")); });
    expect(win.postMessage).toHaveBeenCalledWith({ versao: 1, tipo: "nordus:rascunho", dados: { ideia: 2 } }, "*");
  });

  it("transcribes a clip through the server and answers the frame, one at a time", async () => {
    await render([page]);
    const win = fakeWindow(frame());
    await send({ tipo: "nordus:transcrever", versao: 1, id: "m1", mime: "audio/webm", audio: new ArrayBuffer(8) }, win);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("/api/threads/origin/messages/reply/transcribe?name=3a9d41c7-52be.html");
    expect((call[1] as RequestInit).headers).toEqual({ "content-type": "audio/webm" });
    expect(win.postMessage).toHaveBeenCalledWith({ versao: 1, tipo: "nordus:transcricao", id: "m1", texto: "ola" }, "*");
  });

  it("answers the frame with a short error when transcription fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    await render([page]);
    const win = fakeWindow(frame());
    await send({ tipo: "nordus:transcrever", versao: 1, id: "m2", mime: "audio/ogg", audio: new ArrayBuffer(8) }, win);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(win.postMessage).toHaveBeenCalledWith(expect.objectContaining({ tipo: "nordus:transcricao", id: "m2", erro: expect.any(String) }), "*");
  });

  describe("recording by the app (nordus:gravar)", () => {
    let stopped: number;
    let denied: string | null;
    const go = (id: string, acao: string) => ({ tipo: "nordus:gravar", versao: 1, id, acao });
    const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

    beforeEach(() => {
      stopped = 0;
      denied = null;
      class FakeRecorder {
        static isTypeSupported = () => true;
        mimeType = "audio/webm;codecs=opus";
        state = "inactive";
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start() { this.state = "recording"; }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["voz"], { type: "audio/webm" }) });
          this.onstop?.();
        }
      }
      vi.stubGlobal("MediaRecorder", FakeRecorder);
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: vi.fn(async () => {
            if (denied) throw Object.assign(new Error("no"), { name: denied });
            return { getTracks: () => [{ stop: () => { stopped += 1; } }] };
          }),
        },
      });
    });

    it("records on 'iniciar', shows the bar, and on 'parar' transcribes and releases the microphone", async () => {
      await render([page]);
      const win = fakeWindow(frame());
      await send(go("g1", "iniciar"), win);
      await settle();
      expect(win.postMessage).toHaveBeenCalledWith({ versao: 1, tipo: "nordus:gravacao", id: "g1", estado: "gravando" }, "*");
      expect(container.querySelector("[data-html-recording]")).not.toBeNull();
      await send(go("g1", "parar"), win);
      await settle();
      expect(win.postMessage).toHaveBeenCalledWith({ versao: 1, tipo: "nordus:gravacao", id: "g1", estado: "transcrevendo" }, "*");
      const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toBe("/api/threads/origin/messages/reply/transcribe?name=3a9d41c7-52be.html");
      expect((call[1] as RequestInit).headers).toEqual({ "content-type": "audio/webm" });
      expect(win.postMessage).toHaveBeenCalledWith({ versao: 1, tipo: "nordus:transcricao", id: "g1", texto: "ola" }, "*");
      expect(stopped).toBe(1);
      expect(container.querySelector("[data-html-recording]")).toBeNull();
    });

    it("cancels from the bar button without sending anything, and frees the microphone", async () => {
      await render([page]);
      const win = fakeWindow(frame());
      await send(go("g2", "iniciar"), win);
      await settle();
      const cancel = [...container.querySelectorAll("[data-html-recording] button")].find((b) => b.textContent === "Cancel") as HTMLButtonElement;
      await act(async () => cancel.click());
      await settle();
      expect(win.postMessage).toHaveBeenCalledWith({ versao: 1, tipo: "nordus:gravacao", id: "g2", estado: "cancelada" }, "*");
      expect(fetch).not.toHaveBeenCalled();
      expect(stopped).toBe(1);
    });

    it("stops from the bar's Stop button too", async () => {
      await render([page]);
      const win = fakeWindow(frame());
      await send(go("g3", "iniciar"), win);
      await settle();
      const stop = [...container.querySelectorAll("[data-html-recording] button")].find((b) => b.textContent?.includes("Stop")) as HTMLButtonElement;
      await act(async () => stop.click());
      await settle();
      expect(win.postMessage).toHaveBeenCalledWith({ versao: 1, tipo: "nordus:transcricao", id: "g3", texto: "ola" }, "*");
    });

    it("never records for another window, and 'parar' or 'cancelar' without a start does nothing", async () => {
      await render([page]);
      const win = fakeWindow(frame());
      await send(go("g4", "iniciar"), {});
      await send(go("g4", "parar"), win);
      await send(go("g4", "cancelar"), win);
      await settle();
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
      expect(win.postMessage).not.toHaveBeenCalled();
    });

    it("answers a permission error with a short message and starts nothing", async () => {
      denied = "NotAllowedError";
      await render([page]);
      const win = fakeWindow(frame());
      await send(go("g5", "iniciar"), win);
      await settle();
      expect(win.postMessage).toHaveBeenCalledWith({ versao: 1, tipo: "nordus:transcricao", id: "g5", erro: "Microphone blocked. Allow it in the browser settings." }, "*");
      expect(container.querySelector("[data-html-recording]")).toBeNull();
    });

    it("ignores a second start while recording, and a stop with the wrong id", async () => {
      await render([page]);
      const win = fakeWindow(frame());
      await send(go("g6", "iniciar"), win);
      await settle();
      await send(go("g7", "iniciar"), win);
      await send(go("zzz", "parar"), win);
      await settle();
      expect(win.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "g7", erro: expect.any(String) }), "*");
      expect(container.querySelector("[data-html-recording]")).not.toBeNull();
    });

    it("releases the microphone when the card goes away mid-recording", async () => {
      await render([page]);
      const win = fakeWindow(frame());
      await send(go("g8", "iniciar"), win);
      await settle();
      await act(async () => root.render(createElement("div")));
      expect(stopped).toBe(1);
    });
  });
});
