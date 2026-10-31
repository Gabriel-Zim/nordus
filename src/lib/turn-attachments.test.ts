import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { arrangeTurns } from "./turn-attachments";

const image = (path: string, name?: string) => ({ kind: "image" as const, path, mime: "image/png", ...(name ? { name } : {}) });
const msg = (id: string, patch: Partial<Message>) => ({ id, at: 1, role: "bot", kind: "text", text: "", ...patch }) as Message;
const from = { botId: "designerdeia", name: "DESIGNERDEIA", color: "yellow" } as Message["from"];

describe("arrangeTurns", () => {
  const ask = msg("u", { role: "user", text: "faz o carrossel" });
  const early = [1, 2, 3].map((n) => msg(`a${n}`, { from, attachments: [image(`/a/${n}.png`, `slide-${n}.png`)] }));

  it("keeps a final reply that already carries every file and drops the early copies", () => {
    const final = msg("f", { from, text: "Pronto", attachments: [image("/b/1.png"), image("/b/2.png"), image("/b/3.png")] });
    const shown = arrangeTurns([ask, ...early, final], () => false);
    expect(shown.map((m) => m.id)).toEqual(["u", "f"]);
    expect(shown[1]!.attachments).toHaveLength(3);
  });

  it("moves the early files into a final reply that has none, once each", () => {
    const again = msg("a4", { from, attachments: [image("/a/1b.png", "slide-1.png")] });
    const final = msg("f", { from, text: "Pronto" });
    const shown = arrangeTurns([ask, ...early, again, final], () => false);
    expect(shown.map((m) => m.id)).toEqual(["u", "f"]);
    expect(shown[1]!.attachments?.map((a) => a.path)).toEqual(["/a/1.png", "/a/2.png", "/a/3.png"]);
  });

  it("keeps naming the message that shares each moved file, since the server opens a file only for its own message", () => {
    const video = { kind: "file" as const, path: "/store/v04.mp4", mime: "video/mp4", name: "v04.mp4" };
    const clip = msg("clip", { from, attachments: [video] });
    const final = msg("f", { from, text: "A versão final está anexada: v04.mp4", attachments: [image("/b/own.png")] });
    const shown = arrangeTurns([ask, clip, early[0]!, final], () => false);
    expect(shown.map((m) => m.id)).toEqual(["u", "f"]);
    expect(shown[1]!.attachments?.map((a) => [a.path, a.sharedBy])).toEqual([
      ["/b/own.png", undefined], ["/store/v04.mp4", "clip"], ["/a/1.png", "a1"],
    ]);
  });

  it("holds the files back while the bot still works, and shows them if the turn ends with no reply", () => {
    expect(arrangeTurns([ask, ...early], () => true).map((m) => m.id)).toEqual(["u"]);
    expect(arrangeTurns([ask, ...early], () => false).map((m) => m.id)).toEqual(["u", "a1", "a2", "a3"]);
  });

  it("leaves another bot's reply alone", () => {
    const other = msg("o", { from: { botId: "social", name: "Social", color: "blue" } as Message["from"], text: "oi" });
    expect(arrangeTurns([ask, ...early, other], () => false).map((m) => m.id)).toEqual(["u", "a1", "a2", "a3", "o"]);
  });
});

describe("approval card after the work it asks about", () => {
  const ask = msg("u", { role: "user", text: "faz o post" });
  const piece = msg("img", { attachments: [image("/store/post.png", "post.png")] });
  const card = (id: string, extra: Partial<Message> = {}) => msg(id, {
    kind: "widget", text: "Aprova ou quer ajustar?",
    widget: { v: 1, root: { type: "Card", id: "n1", title: "Lumon · Post", confirm: { label: "Aprovar", action: { type: "aprovar" } }, cancel: { label: "Ajustar", action: { type: "ajustar" } } } },
    ...extra,
  } as Partial<Message>);
  const words = msg("w", { text: "O post está pronto para você aprovar." });

  it("shows the explanation and the piece first, then the card that decides", () => {
    const shown = arrangeTurns([ask, piece, card("c"), words], () => false);
    expect(shown.map((m) => m.id)).toEqual(["u", "w", "c"]);
    expect(shown[1]!.attachments?.map((a) => a.path)).toEqual(["/store/post.png"]);
  });

  it("moves a card raised before the reply even with no files, and keeps the answered card there", () => {
    expect(arrangeTurns([ask, card("c"), words], () => false).map((m) => m.id)).toEqual(["u", "w", "c"]);
    const answered = card("c", { widget: { ...card("c").widget!, settled: { ref: "n1", label: "Aprovar", tone: "confirm", at: 2 } } } as Partial<Message>);
    expect(arrangeTurns([ask, piece, answered, words, msg("u2", { role: "user", text: "Aprovar" })], () => false).map((m) => m.id))
      .toEqual(["u", "w", "c", "u2"]);
  });

  it("leaves a card in place when no reply follows in the turn, or another bot replies", () => {
    expect(arrangeTurns([ask, piece, card("c")], () => false).map((m) => m.id)).toEqual(["u", "img", "c"]);
    expect(arrangeTurns([ask, card("c"), msg("u2", { role: "user", text: "e aí?" }), words], () => false).map((m) => m.id))
      .toEqual(["u", "c", "u2", "w"]);
    const other = msg("o", { from: { botId: "social", name: "Social", color: "blue" } as Message["from"], text: "oi" });
    expect(arrangeTurns([ask, card("c", { from }), other], () => false).map((m) => m.id)).toEqual(["u", "c", "o"]);
  });

  it("never moves a card below a text written after it was answered, or below another task's text", () => {
    const settled = { ref: "n1", label: "Aprovar", tone: "confirm" as const, at: 5 };
    const answered = card("c", { widget: { ...card("c").widget!, settled } } as Partial<Message>);
    const later = msg("later", { at: 10, text: "Publicado no Instagram." });
    expect(arrangeTurns([ask, words, answered, later], () => false).map((m) => m.id)).toEqual(["u", "w", "c", "later"]);
    const taskA = { threadId: "A", messageId: "x", title: "Cliente A" };
    const taskB = { threadId: "B", messageId: "y", title: "Cliente B" };
    const shown = arrangeTurns([ask, { ...piece, fromTask: taskA }, card("c", { fromTask: taskA }), msg("wb", { text: "Peça do B.", fromTask: taskB })], () => false);
    expect(shown.map((m) => m.id)).toEqual(["u", "img", "c", "wb"]);
  });

  it("leaves forms and malformed widgets where they are", () => {
    const form = msg("form", { kind: "widget", widget: { v: 1, root: { type: "Card", id: "n1", children: [{ type: "Button", id: "b", label: "Enviar", onClickAction: { type: "enviar" } }] } } } as Partial<Message>);
    const broken = msg("broken", { kind: "widget", widget: { v: 1, root: null } } as unknown as Partial<Message>);
    expect(arrangeTurns([ask, form, broken, words], () => false).map((m) => m.id)).toEqual(["u", "form", "broken", "w"]);
  });

  it("keeps a widget that only shows something where the bot put it", () => {
    const chart = msg("chart", { kind: "widget", widget: { v: 1, root: { type: "Card", id: "n1", children: [{ type: "Text", id: "n2", value: "42" }] } } } as Partial<Message>);
    expect(arrangeTurns([ask, chart, words], () => false).map((m) => m.id)).toEqual(["u", "chart", "w"]);
  });
});
