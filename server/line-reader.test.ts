import { describe, expect, it, vi } from "vitest";
import { LineReader, LineTooLongError, maxLineBytesFor } from "./line-reader.ts";

function make(max = 1024) {
  const lines: string[] = [];
  const onOverflow = vi.fn();
  const reader = new LineReader({ maxLineBytes: max, onLine: (l) => void lines.push(l), onOverflow });
  return { reader, lines, onOverflow };
}

describe("LineReader", () => {
  it("junta linhas partidas em pedaços", () => {
    const { reader, lines } = make();
    reader.push("abc");
    reader.push("def\nghi");
    reader.push("\n\nz\n");
    expect(lines).toEqual(["abcdef", "ghi", "", "z"]);
  });
  it("remove o \\r final", () => {
    const { reader, lines } = make();
    reader.push(Buffer.from("a\r\nb\r\n"));
    expect(lines).toEqual(["a", "b"]);
  });
  it("não quebra caractere multibyte dividido entre pedaços", () => {
    const { reader, lines } = make();
    const bytes = Buffer.from("olá, 世界 😀\n", "utf8");
    for (let i = 0; i < bytes.length; i++) reader.push(bytes.subarray(i, i + 1));
    expect(lines).toEqual(["olá, 世界 😀"]);
  });
  it("estoura o teto uma vez e ignora o resto", () => {
    const { reader, lines, onOverflow } = make(10);
    reader.push("ok\n");
    reader.push("123456");
    reader.push("789012\nvolta\n");
    reader.push("mais\n");
    expect(reader.overflowed).toBe(true);
    expect(onOverflow).toHaveBeenCalledTimes(1);
    const err = onOverflow.mock.calls[0]![0] as LineTooLongError;
    expect(err).toBeInstanceOf(LineTooLongError);
    expect(err.bytes).toBe(12);
    expect(lines).toEqual(["ok"]);
    reader.end();
    expect(lines).toEqual(["ok"]);
  });
  it("linha completa maior que o teto num pedaço só também estoura", () => {
    const { reader, onOverflow } = make(4);
    reader.push("abcdefgh\n");
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });
  it("end() emite o resto pendente", () => {
    const { reader, lines } = make();
    reader.push("a\nresto");
    reader.end();
    expect(lines).toEqual(["a", "resto"]);
    reader.end();
    expect(lines).toEqual(["a", "resto"]);
  });
  it("onLine retornando true encerra a leitura", () => {
    const lines: string[] = [];
    const reader = new LineReader({ maxLineBytes: 100, onLine: (l) => { lines.push(l); return true; } });
    reader.push("a\nb\n");
    expect(lines).toEqual(["a"]);
  });
  it("mensagem e env de teto", () => {
    expect(new LineTooLongError(80 * 1024 * 1024, 64 * 1024 * 1024).message)
      .toBe("A CLI enviou uma linha de 80 MB, acima do limite de 64 MB");
    expect(maxLineBytesFor("cli", {})).toBe(64 * 1024 * 1024);
    expect(maxLineBytesFor("broker", {})).toBe(4 * 1024 * 1024);
    expect(maxLineBytesFor("broker", { NORDUS_MAX_LINE_BYTES: "2048" })).toBe(2048);
    expect(maxLineBytesFor("cli", { NORDUS_MAX_LINE_BYTES: "lixo" })).toBe(64 * 1024 * 1024);
  });
});
