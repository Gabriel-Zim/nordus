import { describe, expect, it } from "vitest";
import { TURN_IMAGE_MAX_COUNT } from "../../server/turn-images.ts";
import { attachmentWords, fitImages, imageRoomLeft, intakeFiles, MESSAGE_IMAGE_MAX_COUNT, optimisticImageAttachment, type Attachment } from "./composer-attachments";

type Fake = { name: string; size: number; type: string; text: () => Promise<string> };
const image = (name: string): Fake => ({ name, size: 10, type: "image/png", text: async () => "" });
const doc = (name: string): Fake => ({ name, size: 10, type: "text/plain", text: async () => "notes" });
const uploaded = async (file: Fake): Promise<Attachment> => ({ kind: "image", id: file.name, name: file.name, path: `/a/${file.name}`, size: 10, mime: "image/png" });

describe("images per message", () => {
  it("caps where the server refuses a message", () => {
    expect(MESSAGE_IMAGE_MAX_COUNT).toBe(TURN_IMAGE_MAX_COUNT);
  });

  it("counts only the images already in the draft", () => {
    const draft = [{ kind: "image" }, { kind: "file" }, { kind: "image" }] as const;
    expect(imageRoomLeft(draft)).toBe(MESSAGE_IMAGE_MAX_COUNT - 2);
    expect(imageRoomLeft(Array.from({ length: 60 }, () => ({ kind: "image" as const })))).toBe(0);
  });

  it("keeps documents and the first images that fit, and names the ones left out", () => {
    const fitted = fitImages([image("a.png"), doc("n.txt"), image("b.png"), image("c.png")], 1);
    expect(fitted.files.map((file) => file.name)).toEqual(["a.png", "n.txt"]);
    expect(fitted.leftOut).toEqual(["b.png", "c.png"]);
  });

  it("uploads only what fits and says which images stayed out", async () => {
    const seen: string[] = [];
    const out = await intakeFiles([image("a.png"), image("b.png"), image("c.png")], {
      allowImages: true,
      getPath: () => "",
      uploadImage: async (file) => { seen.push(file.name); return uploaded(file); },
      imageRoom: 2,
    });
    expect(seen).toEqual(["a.png", "b.png"]);
    expect(out.attachments).toHaveLength(2);
    expect(out.notice).toBe(attachmentWords.tooManyImages("c.png", MESSAGE_IMAGE_MAX_COUNT));
  });

  it("says a too-big image in the words the app set", () => {
    const original = attachmentWords.tooBig;
    attachmentWords.tooBig = (name, size) => `${name} é grande demais; o limite é ${size}`;
    try {
      const big = { name: "foto.png", size: 11 * 1024 * 1024, type: "image/png" } as File;
      expect(() => optimisticImageAttachment(big)).toThrow("foto.png é grande demais; o limite é 10 MB");
    } finally {
      attachmentWords.tooBig = original;
    }
  });
});
