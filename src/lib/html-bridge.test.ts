import { describe, expect, it } from "vitest";
import { autoHeight, parseBridgeMessage, REPLY_MAX_CHARS } from "./html-bridge";

describe("parseBridgeMessage", () => {
  it("accepts a reply only with the right type, version and a non-empty string", () => {
    expect(parseBridgeMessage({ tipo: "nordus:responder", versao: 1, texto: "oi" })).toEqual({ kind: "reply", text: "oi" });
    expect(parseBridgeMessage({ tipo: "nordus:responder", versao: 2, texto: "oi" })).toBeNull();
    expect(parseBridgeMessage({ tipo: "nordus:responder", versao: 1, texto: "   " })).toBeNull();
    expect(parseBridgeMessage({ tipo: "nordus:responder", versao: 1, texto: 5 })).toBeNull();
    expect(parseBridgeMessage({ tipo: "outro", versao: 1, texto: "oi" })).toBeNull();
    expect(parseBridgeMessage("nordus:responder")).toBeNull();
    expect(parseBridgeMessage(null)).toBeNull();
  });

  it("flags a reply over 20000 characters instead of passing it on", () => {
    expect(parseBridgeMessage({ tipo: "nordus:responder", versao: 1, texto: "a".repeat(REPLY_MAX_CHARS) })?.kind).toBe("reply");
    expect(parseBridgeMessage({ tipo: "nordus:responder", versao: 1, texto: "a".repeat(REPLY_MAX_CHARS + 1) })).toEqual({ kind: "reply-too-long" });
  });

  it("serialises a draft under 200 KB", () => {
    expect(parseBridgeMessage({ tipo: "nordus:rascunho", versao: 1, dados: { a: [1, 2] } })).toEqual({ kind: "draft", json: '{"a":[1,2]}' });
    expect(parseBridgeMessage({ tipo: "nordus:rascunho", versao: 1, dados: "x".repeat(200 * 1024) })).toBeNull();
    expect(parseBridgeMessage({ tipo: "nordus:rascunho", versao: 1 })).toBeNull();
  });

  it("accepts a positive finite height only", () => {
    expect(parseBridgeMessage({ tipo: "nordus:altura", versao: 1, altura: 600 })).toEqual({ kind: "height", height: 600 });
    for (const altura of [0, -5, Number.NaN, Infinity, "600"]) expect(parseBridgeMessage({ tipo: "nordus:altura", versao: 1, altura })).toBeNull();
  });

  it("accepts a transcription request with a known audio type and a short id", () => {
    const audio = new ArrayBuffer(4);
    expect(parseBridgeMessage({ tipo: "nordus:transcrever", versao: 1, id: "a1", mime: "audio/webm", audio })).toMatchObject({ kind: "transcribe", id: "a1" });
    expect(parseBridgeMessage({ tipo: "nordus:transcrever", versao: 1, id: "a1", mime: "audio/flac", audio })).toBeNull();
    expect(parseBridgeMessage({ tipo: "nordus:transcrever", versao: 1, id: "", mime: "audio/webm", audio })).toBeNull();
    expect(parseBridgeMessage({ tipo: "nordus:transcrever", versao: 1, id: "a1", mime: "audio/webm", audio: "bytes" })).toBeNull();
  });
});

describe("nordus:gravar", () => {
  it("accepts the three actions with a short id only", () => {
    for (const acao of ["iniciar", "parar", "cancelar"]) expect(parseBridgeMessage({ tipo: "nordus:gravar", versao: 1, id: "a", acao })).toEqual({ kind: "record", id: "a", action: acao });
    expect(parseBridgeMessage({ tipo: "nordus:gravar", versao: 1, id: "a", acao: "pausar" })).toBeNull();
    expect(parseBridgeMessage({ tipo: "nordus:gravar", versao: 1, id: "", acao: "parar" })).toBeNull();
  });
});

describe("autoHeight", () => {
  it("stays between 240 px and 85% of the screen", () => {
    expect(autoHeight(100, 800)).toBe(240);
    expect(autoHeight(500, 800)).toBe(500);
    expect(autoHeight(5000, 800)).toBe(680);
  });
});
