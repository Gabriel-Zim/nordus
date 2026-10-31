import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Attachment } from "@/lib/composer-attachments";
import { ComposerAttachments, uploadPercentLabel } from "./ComposerAttachments";

function strip(items: Attachment[]): string {
  return renderToStaticMarkup(createElement(ComposerAttachments, {
    placement: "inside",
    items,
    onAdd: () => undefined,
    onRemove: () => undefined,
    onChangeCitation: () => undefined,
    onDisplayInChatBox: () => undefined,
    notice: null,
    onNotice: () => undefined,
    uploadImage: async () => null,
  }));
}

describe("upload percentage on the composer chip", () => {
  it("formats whole percent inside 0-100", () => {
    expect(uploadPercentLabel(37.4)).toBe("37%");
    expect(uploadPercentLabel(-5)).toBe("0%");
    expect(uploadPercentLabel(140)).toBe("100%");
  });

  it("shows 37% and a thin bar on a generic file that is still uploading", () => {
    const html = strip([{ kind: "file", id: "a", path: "", name: "Gotham-Font.zip", size: 5, uploading: true, progress: 37 }]);
    expect(html).toContain("Gotham-Font.zip");
    expect(html).toContain("37%");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="37"');
    expect(html).toContain("width:37%");
  });

  it("shows the number on an image tile too", () => {
    const html = strip([{ kind: "image", id: "i", path: "", name: "a.png", size: 5, mime: "image/png", previewUrl: "blob:x", uploading: true, progress: 62 }]);
    expect(html).toContain("62%");
  });

  it("is a plain card, with no number or bar, once the file is stored", () => {
    const html = strip([{ kind: "file", id: "a", path: "/store/1.zip", name: "Gotham-Font.zip", size: 5 }]);
    expect(html).toContain("Gotham-Font.zip");
    expect(html).not.toContain("%");
    expect(html).not.toContain("progressbar");
  });
});
