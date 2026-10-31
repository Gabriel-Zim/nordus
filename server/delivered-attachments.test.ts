import { describe, expect, it } from "vitest";
import { deliveredAttachments } from "./delivered-attachments.ts";
import type { Message } from "./store.ts";

const row = (over: Partial<Message>): Message => ({ id: Math.random().toString(36), at: 0, role: "bot", kind: "text", text: "", ...over }) as Message;
const img = (n: number) => ({ kind: "image" as const, path: `/data/attachments/${n}.png`, mime: "image/png" });

describe("deliveredAttachments", () => {
  const rows = [
    row({ attachments: [img(0)] }),
    row({ roomRequest: { id: "r1", phase: "request" }, text: "Mensagem do MARK: artes" }),
    row({ attachments: [img(1), img(2)] }),
    row({ role: "user", attachments: [img(9)] }),
    row({ kind: "activity", attachments: [img(8)] }),
    row({ attachments: [img(2), { kind: "audio", path: "/data/attachments/v.mp3", mime: "audio/mpeg" }, { kind: "file", path: "/data/attachments/f.pdf", mime: "application/pdf", name: "f.pdf" }] }),
  ];

  it("collects the teammate's own attachments after the request line, once each, without audio", () => {
    expect(deliveredAttachments(rows, "r1").map(a => a.path)).toEqual(["/data/attachments/1.png", "/data/attachments/2.png", "/data/attachments/f.pdf"]);
  });

  it("is empty when the request line is missing, and capped", () => {
    expect(deliveredAttachments(rows, "nope")).toEqual([]);
    expect(deliveredAttachments(rows, "r1", 2)).toHaveLength(2);
  });
});
