// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentGallery, type GalleryFile } from "./AttachmentGallery";
import { messageMediaStreamUrl } from "./VideoAttachment";

const reply = { threadId: "origin", messageId: "reply" };
// A space keeps the name from being a bare generated one, so this private video takes the Blob flow.
const folded: GalleryFile = { path: "/store/v 04.mp4", name: "v 04.mp4", private: true, sharedBy: "clip" };
const stored: GalleryFile = { path: "/store/7c1f0e52-3b8a.mp4", name: "clip.mp4", private: true };
const storedUrl = "/api/threads/origin/messages/reply/file?stream=1&name=7c1f0e52-3b8a.mp4";
const linked: GalleryFile = { path: "/workspace/demo.mp4", name: "demo.mp4", linked: true };

let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn>;

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function render(files: GalleryFile[]) {
  await act(async () => root.render(createElement(AttachmentGallery, { files, message: reply, beneath: true })));
  await settle();
}

const previewButton = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="Preview ${name}"]`)!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetcher = vi.fn(async () => new Response("video bytes", { headers: { "content-type": "video/mp4" } }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly seen: IntersectionObserverCallback) {}
    observe(target: Element) { this.seen([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
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

describe("video attachment", () => {
  it("asks for a video moved into the final reply through the message that shares it", async () => {
    await render([folded]);
    await act(async () => previewButton("v 04.mp4").click());
    await settle();
    expect(fetcher).toHaveBeenCalled();
    for (const [url] of fetcher.mock.calls) expect(url).toBe("/api/threads/origin/messages/clip/file");
  });

  it("covers an attached video with its own frame and names it once", async () => {
    await render([folded]);
    const cover = container.querySelector<HTMLVideoElement>("[data-video-card] video")!;
    expect(cover.src).toMatch(/^blob:.*#t=0\.1$/);
    expect(cover.muted).toBe(true);
    expect(cover.controls).toBe(false);
    expect(container.textContent!.split("v 04.mp4")).toHaveLength(2);
  });

  it("opens the video large to watch, with a download, and closes back to the cover", async () => {
    await render([folded]);
    await act(async () => previewButton("v 04.mp4").click());
    await settle();
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    expect(dialog.getAttribute("aria-label")).toContain("v 04.mp4");
    const player = dialog.querySelector<HTMLVideoElement>("video")!;
    expect(player.controls).toBe(true);
    expect(player.src).toMatch(/^blob:/);
    expect(dialog.querySelector("a[download='v 04.mp4']")).not.toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("says so when the browser cannot decode the video, instead of a black player", async () => {
    await render([folded]);
    await act(async () => previewButton("v 04.mp4").click());
    await settle();
    await act(async () => document.querySelector("[role=dialog] video")!.dispatchEvent(new Event("error")));
    expect(document.querySelector("[role=dialog] [role=alert]")!.textContent).toContain("cannot be played here");
  });

  it("still loads the cover under StrictMode without IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await act(async () => root.render(createElement(StrictMode, null, createElement(AttachmentGallery, { files: [folded], message: reply, beneath: true }))));
    await settle();
    expect(container.querySelector("[data-video-card] video")).not.toBeNull();
  });

  it("keeps a plain cover for a video too big to preview, and loads it in full when opened", async () => {
    const big = String(11 * 1024 * 1024);
    fetcher.mockImplementation(async () => new Response("video bytes", { headers: { "content-type": "video/mp4", "content-length": big } }));
    await render([folded]);
    expect(container.querySelector("[data-video-card] video")).toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
    fetcher.mockImplementation(async () => new Response("video bytes", { headers: { "content-type": "video/mp4" } }));
    await act(async () => previewButton("v 04.mp4").click());
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[role=dialog] video")).not.toBeNull();
  });

  it("streams a stored video from a GET URL without fetching a Blob", async () => {
    await render([stored]);
    const cover = container.querySelector<HTMLVideoElement>("[data-video-card] video")!;
    expect(cover.getAttribute("src")).toBe(`${storedUrl}#t=0.1`);
    await act(async () => previewButton("clip.mp4").click());
    await settle();
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    expect(dialog.querySelector("video")!.getAttribute("src")).toBe(storedUrl);
    expect(dialog.querySelector("a[download='clip.mp4']")!.getAttribute("href")).toBe(storedUrl);
    expect(dialog.querySelector("[role=status]")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => dialog.querySelector("video")!.dispatchEvent(new Event("error")));
    expect(dialog.querySelector("[role=alert]")).not.toBeNull();
    await act(async () => dialog.querySelector<HTMLButtonElement>("[role=alert] button")!.click());
    expect(dialog.querySelector("video")!.getAttribute("src")).toBe(storedUrl);
  });

  it("builds a stream URL only for a stored, bare-named media file", () => {
    expect(messageMediaStreamUrl(reply, stored)).toBe(storedUrl);
    expect(messageMediaStreamUrl(reply, { path: "/store/v 04.mp4", private: true })).toBeNull();
    expect(messageMediaStreamUrl(reply, { path: "/store/notes.pdf", private: true })).toBeNull();
    expect(messageMediaStreamUrl(reply, { path: "/store/7c1f0e52-3b8a.mp4" })).toBeNull();
  });

  it("waits for a click before loading a video the bot only linked", async () => {
    await render([linked]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector("video")).toBeNull();
    await act(async () => previewButton("demo.mp4").click());
    await settle();
    expect(fetcher).toHaveBeenCalledWith("/api/threads/origin/messages/reply/file", expect.objectContaining({ body: JSON.stringify({ path: linked.path }) }));
    expect(document.querySelector("[role=dialog] video")).not.toBeNull();
  });
});
