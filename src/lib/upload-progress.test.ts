import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createUploadProgress,
  fileAttachmentFromFile,
  imageAttachmentFromFile,
  intakeFiles,
  optimisticFileAttachment,
  uploadsInFlight,
} from "./composer-attachments";

type Script = (xhr: FakeXhr) => void;

/** XMLHttpRequest stand-in: each send() runs the next script, which reports upload progress and then answers. */
class FakeXhr {
  static script: Script[] = [];
  static sent: { url: string; contentType: string | undefined; bytes: number }[] = [];
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  statusText = "";
  responseText = "";
  private url = "";
  private headers = new Map<string, string>();
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers.set(key.toLowerCase(), value);
  }
  abort() {
    this.onabort?.();
  }
  send(body: Blob | Uint8Array | null) {
    const bytes = body instanceof Blob ? body.size : (body?.byteLength ?? 0);
    FakeXhr.sent.push({ url: this.url, contentType: this.headers.get("content-type"), bytes });
    const script = FakeXhr.script.shift();
    if (!script) throw new Error("no script for this request");
    queueMicrotask(() => script(this));
  }
  progress(loaded: number) {
    this.upload.onprogress?.({ loaded });
  }
  answer(status: number, json: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(json);
    this.onload?.();
  }
}

function install(...scripts: Script[]) {
  FakeXhr.script = scripts;
  FakeXhr.sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const MB = 1024 * 1024;

describe("createUploadProgress", () => {
  it("counts whole percent, never goes back and holds at 99 until done", () => {
    const seen: number[] = [];
    const progress = createUploadProgress(1000, (p) => seen.push(p));
    progress.sending(250);
    progress.sending(100); // a retry starts the part again: the number stays
    progress.sending(500);
    progress.sending(1000);
    progress.sending(5000); // never past the total
    expect(seen).toEqual([0, 25, 50, 99]);
    progress.done();
    expect(seen.at(-1)).toBe(100);
  });

  it("adds the confirmed parts to the part on the wire, capped at that part's size", () => {
    const seen: number[] = [];
    const progress = createUploadProgress(100, (p) => seen.push(p));
    progress.confirm(40);
    progress.sending(30, 30);
    progress.sending(500, 30); // more than the part holds: counted as the part
    expect(seen).toEqual([0, 40, 70]);
  });
});

describe("upload progress over XMLHttpRequest", () => {
  it("reports the live percent of a single upload, any type", async () => {
    install((xhr) => {
      expect(uploadsInFlight()).toBe(1);
      xhr.progress(250);
      xhr.progress(750);
      xhr.progress(1000);
      xhr.answer(201, { path: "/p/1.zip", name: "Gotham-Font.zip", bytes: 1000 });
    });
    const seen: number[] = [];
    const file = new File([new Uint8Array(1000)], "Gotham-Font.zip", { type: "application/zip" });
    const saved = await fileAttachmentFromFile(file, { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([0, 25, 75, 99, 100]);
    expect(saved).toMatchObject({ kind: "file", path: "/p/1.zip", name: "Gotham-Font.zip", size: 1000 });
    expect(FakeXhr.sent[0]).toMatchObject({ contentType: "application/octet-stream", bytes: 1000 });
    expect(uploadsInFlight()).toBe(0);
  });

  it("also reports an image", async () => {
    install((xhr) => {
      xhr.progress(2);
      xhr.answer(201, { path: "/p/1.png", mime: "image/png", bytes: 4 });
    });
    const seen: number[] = [];
    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.png", { type: "image/png" });
    await imageAttachmentFromFile(file, undefined, (p) => seen.push(p));
    expect(seen).toEqual([0, 50, 100]);
  });

  it("in parts: confirmed parts plus the current one, steady through a retry and a resume, ending at 100", async () => {
    vi.useFakeTimers();
    const total = 70 * MB; // parts of 32 + 32 + 6 MB
    install(
      (xhr) => { xhr.progress(16 * MB); xhr.answer(502, {}); },
      (xhr) => { xhr.progress(8 * MB); xhr.progress(32 * MB); xhr.answer(200, { received: 32 * MB }); },
      (xhr) => { xhr.progress(16 * MB); xhr.answer(409, { error: "gap", received: 20 * MB }); },
      (xhr) => { xhr.progress(24 * MB); xhr.answer(200, { received: 52 * MB }); },
      (xhr) => { xhr.progress(18 * MB); xhr.answer(200, { received: total }); },
      (xhr) => xhr.answer(201, { path: "/p/big.zip", name: "big.zip", bytes: total }),
    );
    const seen: number[] = [];
    const file = new File([new Uint8Array(total)], "big.zip", { type: "application/zip" });
    const done = fileAttachmentFromFile(file, { onProgress: (p) => seen.push(p) });
    await vi.runAllTimersAsync();
    await expect(done).resolves.toMatchObject({ path: "/p/big.zip", size: total });
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    expect(seen[0]).toBe(0);
    expect(seen).toContain(22); // 16 of 70 MB on the first try
    expect(seen).toContain(45); // first part confirmed: 32 of 70 MB
    expect(Math.max(...seen.slice(0, -1))).toBeLessThanOrEqual(99);
    expect(seen.at(-1)).toBe(100);
    expect(seen.filter((p) => p === 100)).toHaveLength(1);
    // the 409 told the sender the server holds only 20 MB, so the next part starts there
    expect(FakeXhr.sent.map((s) => /offset=(\d+)/.exec(s.url)?.[1])).toEqual(["0", "0", String(32 * MB), String(20 * MB), String(52 * MB), undefined]);
  });

  it("keeps the plain fetch path when nobody asks for progress", async () => {
    install();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ path: "/p/x.zip", name: "x.zip", bytes: 3 }), { status: 201 }));
    try {
      await fileAttachmentFromFile(new File([new Uint8Array([1, 2, 3])], "x.zip", { type: "application/zip" }));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(FakeXhr.sent).toHaveLength(0);
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("any type of file", () => {
  const stored = (name: string) => new Response(JSON.stringify({ path: `/p/${name}`, name, bytes: 3 }), { status: 201 });

  it("sends zips, fonts, design files and extensionless files as generic files", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => stored("x"));
    try {
      for (const name of ["Gotham-Font.zip", "Gotham.otf", "Gotham.ttf", "Gotham.woff2", "art.psd", "logo.ai", "ui.sketch", "ui.fig", "a.rar", "b.7z", "c.dmg", "d.exe", "IMG_1.heic", "LICENSE"]) {
        const file = new File([new Uint8Array([1, 2, 3])], name, { type: "" });
        await expect(fileAttachmentFromFile(file)).resolves.toMatchObject({ kind: "file", size: 3 });
      }
      for (const call of fetch.mock.calls) {
        expect((call[1]!.headers as Record<string, string>)["content-type"]).toBe("application/octet-stream");
      }
      expect(fetch).toHaveBeenCalledTimes(14);
    } finally {
      fetch.mockRestore();
    }
  });

  it("refuses only an empty file or one above 2 GB, and says so", async () => {
    const empty = new File([], "empty.zip");
    await expect(fileAttachmentFromFile(empty)).resolves.toBeNull();
    const huge = new File([new Uint8Array(1)], "huge.zip");
    Object.defineProperty(huge, "size", { value: 2 * 1024 * MB + 1 });
    await expect(fileAttachmentFromFile(huge)).rejects.toMatchObject({ status: 413 });
    const { attachments, notice } = await intakeFiles([empty], { allowImages: true, getPath: () => "", uploadImage: async () => null });
    expect(attachments).toEqual([]);
    expect(notice).toMatch(/empty empty\.zip|empty files/i);
    expect(notice).not.toMatch(/Send an image/);
  });

  it("lets the composer add the file itself (with its progress chip) without a notice", async () => {
    const file = new File([new Uint8Array([1])], "a.zip");
    const { attachments, notice } = await intakeFiles([file], { allowImages: true, getPath: () => "", uploadImage: async () => null, uploadFile: async () => "added" });
    expect(attachments).toEqual([]);
    expect(notice).toBeNull();
  });

  it("starts the chip at 0% and uploading", () => {
    expect(optimisticFileAttachment({ name: "a.zip", size: 9 })).toMatchObject({ kind: "file", name: "a.zip", size: 9, uploading: true, progress: 0, path: "" });
  });
});
