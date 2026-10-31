import { describe, expect, it } from "vitest";
import { isCriticalLabel, looksLikeCardNumber, sanitizeTeachEvent, sanitizeTeachUrl, teachStepLabel, type TeachStep } from "./teach.ts";

const page = "https://suporte.exemplo.com/caixa?x=1";

describe("sanitizeTeachEvent", () => {
  it("descarta o valor de senha mesmo quando a pagina o mandou", () => {
    const out = sanitizeTeachEvent({ t: "type", field: "Senha", selector: "#pw", inputType: "password", value: "hunter2-segredo" }, page);
    expect(out).toEqual({ kind: "type-secret", field: "Senha", selector: "#pw", secret: "password", site: "suporte.exemplo.com" });
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });

  it("trata senha pelo rotulo pt-BR e pelo declarado, sem value", () => {
    expect(sanitizeTeachEvent({ t: "type", field: "Digite sua senha", selector: "input", value: "abc" }, page)).toMatchObject({ kind: "type-secret", secret: "password" });
    expect(sanitizeTeachEvent({ t: "type", field: "x", selector: "x", secret: "secret", value: "abc" }, page)).toMatchObject({ kind: "type-secret", secret: "secret" });
  });

  it("trata codigo de uso unico: autocomplete e campo de codigo com digitos", () => {
    const a = sanitizeTeachEvent({ t: "type", field: "Codigo", selector: "#c", autocomplete: "one-time-code", value: "123456" }, page);
    expect(a).toMatchObject({ kind: "type-secret", secret: "code" });
    const b = sanitizeTeachEvent({ t: "type", field: "Código", selector: "#c2", value: "654321" }, page);
    expect(b).toMatchObject({ kind: "type-secret", secret: "code" });
    expect(JSON.stringify([a, b])).not.toMatch(/123456|654321/);
  });

  it("trata cartao: autocomplete cc-number e numero com Luhn valido", () => {
    expect(sanitizeTeachEvent({ t: "type", field: "Numero", selector: "#n", autocomplete: "cc-number", value: "4111 1111 1111 1111" }, page)).toMatchObject({ kind: "type-secret", secret: "card" });
    const out = sanitizeTeachEvent({ t: "type", field: "Observacao", selector: "#o", value: "4111111111111111" }, page);
    expect(out).toMatchObject({ kind: "type-secret", secret: "card" });
    expect(looksLikeCardNumber("4111111111111112")).toBe(false);
  });

  it("mantem digitacao comum e numero curto em campo comum", () => {
    expect(sanitizeTeachEvent({ t: "type", field: "Mensagem", selector: "#m", value: "oi" }, page)).toEqual({ kind: "type", field: "Mensagem", selector: "#m", value: "oi" });
    expect(sanitizeTeachEvent({ t: "type", field: "Quantidade", selector: "#q", value: "123456" }, page)).toMatchObject({ kind: "type" });
  });

  it("clique, tecla e rolagem; lixo vira null", () => {
    expect(sanitizeTeachEvent({ t: "click", text: "  Responder ", role: "button", selector: "#r" }, page)).toEqual({ kind: "click", text: "Responder", role: "button", selector: "#r" });
    expect(sanitizeTeachEvent({ t: "click", text: "segredo", inputType: "password", selector: "#p" }, page)).toMatchObject({ text: "" });
    expect(sanitizeTeachEvent({ t: "key", key: "Enter" }, page)).toEqual({ kind: "key", key: "Enter" });
    expect(sanitizeTeachEvent({ t: "scroll", direction: "down", amount: 400 }, page)).toEqual({ kind: "scroll", direction: "down", amount: 400 });
    expect(sanitizeTeachEvent({ t: "scroll", direction: "left", amount: 4 }, page)).toBeNull();
    expect(sanitizeTeachEvent("x", page)).toBeNull();
    expect(sanitizeTeachEvent({ t: "nada" }, page)).toBeNull();
  });
});

describe("sanitizeTeachUrl", () => {
  it("tira fragmento e valor de token", () => {
    expect(sanitizeTeachUrl("https://a.com/p?token=abc&q=1#frag")).toBe("https://a.com/p?token=x&q=1");
  });
});

describe("isCriticalLabel", () => {
  it("pega enviar, apagar, pagar, publicar, comprar e termos", () => {
    for (const t of ["Enviar", "Send message", "Apagar conversa", "Excluir", "Pagar agora", "Publicar", "Comprar", "Aceitar termos", "Confirmar pagamento"]) expect(isCriticalLabel(t)).toBe(true);
    for (const t of ["Responder", "Abrir", "Próximo", "Cancelar"]) expect(isCriticalLabel(t)).toBe(false);
  });
});

describe("teachStepLabel", () => {
  const step = (action: TeachStep["action"]): TeachStep => ({ n: 1, at: 0, url: "https://x.com/a", title: "T", action });
  it("frases em portugues", () => {
    expect(teachStepLabel(step({ kind: "navigate", url: "https://www.site.com/x" }))).toBe("Abrir site.com/x");
    expect(teachStepLabel(step({ kind: "click", text: "Responder", role: "button", selector: "" }))).toBe('Clicar em "Responder"');
    expect(teachStepLabel(step({ kind: "type", field: "Mensagem", selector: "", value: "oi" }))).toBe('Digitar "oi" em Mensagem');
    expect(teachStepLabel(step({ kind: "type-secret", field: "", selector: "", secret: "password", site: "x.com" }))).toBe("Digitar a senha do site x.com");
    expect(teachStepLabel(step({ kind: "key", key: "Enter" }))).toBe("Apertar Enter");
    expect(teachStepLabel(step({ kind: "scroll", direction: "down", amount: 5 }))).toBe("Rolar a página");
    expect(teachStepLabel(step({ kind: "tab", url: "", title: "Título" }))).toBe('Trocar para a aba "Título"');
  });
});
