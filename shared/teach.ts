// Nordus: ensinar uma tarefa (frente G). Tipos e regras puras usados pelo servidor e pela interface.
// Regra de ouro: o valor de uma senha, de um codigo de uso unico ou de um cartao NUNCA entra num TeachStep.

export type TeachSecretKind = "password" | "code" | "card" | "secret";

export type TeachAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; text: string; role: string; selector: string }
  | { kind: "type"; field: string; selector: string; value: string }
  | { kind: "type-secret"; field: string; selector: string; secret: TeachSecretKind; site: string }
  | { kind: "key"; key: string; field?: string }
  | { kind: "scroll"; direction: "up" | "down"; amount: number }
  | { kind: "tab"; url: string; title: string };

export interface TeachStep {
  n: number;
  at: number;
  url: string;
  title: string;
  action: TeachAction;
  /** Nome do arquivo jpg da miniatura (dentro da pasta da gravacao). */
  shot?: string;
  critical?: boolean;
}

export interface TeachStatus {
  recording: boolean;
  startedAt?: number;
  threadId?: string;
  steps: TeachStep[];
  state?: "starting" | "recording" | "summarizing";
  /** Frase em portugues quando a gravacao nao pode comecar ou caiu (ex.: navegador desligado). */
  error?: string;
}

/** Uma gravacao terminada: o que o resumo e o rascunho leem. */
export interface TeachRecording {
  id: string;
  botId: string;
  threadId: string;
  startedAt: number;
  endedAt: number;
  steps: TeachStep[];
  /** Verdadeiro quando parou sozinha (limite de passos ou de tempo). */
  truncated?: boolean;
}

export const TEACH_MAX_STEPS = 300;
export const TEACH_MAX_MS = 30 * 60_000;

const VALUE_MAX = 2000;
const LABEL_MAX = 80;

// Mesmo criterio de server/browser-goal/page-scripts.ts (SECRET_FIELD e SECRET_AUTOCOMPLETE). Este arquivo e
// compartilhado com a interface e nao pode importar do servidor, por isso o padrao e repetido aqui.
const SECRET_FIELD = /password|passwd|passcode|pwd|senha|\botp\b|one.?time|2fa|mfa|security.?code|c[oó]digo.?de.?seguran|verif\w*.?code|\bcvc\b|\bcvv\b|card.?num|cc.?num|n[uú]mero.?do.?cart|api.?key|access.?token|secret|chave.?(?:de.?)?api|chave.?pix/i;
const SECRET_AUTOCOMPLETE = /(?:^|\s)(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-name|cc-exp(?:-month|-year)?)(?:\s|$)/i;
/** Para o script injetado na pagina (server/teach/page-script.ts) usar exatamente o mesmo criterio. */
export const TEACH_SECRET_FIELD_SOURCE = SECRET_FIELD.source;
export const TEACH_SECRET_AUTOCOMPLETE_SOURCE = SECRET_AUTOCOMPLETE.source;
/** Campo cujo nome sugere um codigo: valor so de digitos curtos nele e tratado como codigo de uso unico. */
const CODE_LIKE_FIELD = /c[oó]digo|\bcode\b|\botp\b|\bpin\b|token|verif|2fa|mfa/i;

/** Metadados de um campo, como a pagina os viu. */
export interface TeachFieldMeta {
  inputType?: string;
  autocomplete?: string;
  field?: string;
  selector?: string;
}

function secretKindFromText(text: string): TeachSecretKind {
  if (/cc-|\bcvc\b|\bcvv\b|card|cart[aã]o|cartao/i.test(text)) return "card";
  if (/one.?time|\botp\b|2fa|mfa|security.?code|c[oó]digo|verif\w*.?code/i.test(text)) return "code";
  if (/password|passwd|passcode|pwd|senha|current-password|new-password/i.test(text)) return "password";
  return "secret";
}

/** O tipo de segredo do campo, ou null quando o campo e comum. */
export function secretKindOfField(meta: TeachFieldMeta): TeachSecretKind | null {
  const auto = String(meta.autocomplete ?? "");
  const label = `${meta.field ?? ""} ${meta.selector ?? ""}`;
  if (String(meta.inputType ?? "").toLowerCase() === "password") return "password";
  if (SECRET_AUTOCOMPLETE.test(auto)) return secretKindFromText(auto);
  if (SECRET_FIELD.test(label)) return secretKindFromText(label);
  return null;
}

/** Luhn com 13 a 19 digitos (aceita espacos e hifens): numero de cartao. */
export function looksLikeCardNumber(value: string): boolean {
  if (!/^[\d\s-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function trimmed(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function hostOf(pageUrl: string): string {
  try { return new URL(pageUrl).host; } catch { return ""; }
}

/** URL sem fragmento e com o valor de parametros sensiveis (token, codigo, senha, chave) trocado por "x". */
export function sanitizeTeachUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol}//${url.host}`;
    for (const key of url.searchParams.keys()) {
      if (SECRET_FIELD.test(key) || /token|code|codigo|key|auth|session|sig|ticket|otp/i.test(key)) url.searchParams.set(key, "x");
    }
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString().slice(0, 500);
  } catch { return ""; }
}

const SCROLL_DIRS = new Set(["up", "down"]);

/** Confere de novo, no servidor, o que a pagina mandou (defesa em profundidade). Devolve null para lixo.
 * Para qualquer campo com cara de segredo o valor e descartado aqui, mesmo que a pagina o tenha mandado. */
export function sanitizeTeachEvent(raw: unknown, pageUrl: string): TeachAction | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  const t = event.t;
  if (t === "click") {
    const selector = trimmed(event.selector, 200);
    const meta = { inputType: String(event.inputType ?? ""), autocomplete: String(event.autocomplete ?? ""), field: trimmed(event.text, LABEL_MAX), selector };
    let text = trimmed(event.text, LABEL_MAX);
    // Clicar num campo secreto nunca leva o valor do campo (o texto de um input e o proprio valor).
    if (String(event.inputType ?? "").toLowerCase() === "password" || SECRET_AUTOCOMPLETE.test(meta.autocomplete)) text = "";
    if (looksLikeCardNumber(text)) text = "";
    return { kind: "click", text, role: trimmed(event.role, 40) || "generic", selector };
  }
  if (t === "type") {
    const field = trimmed(event.field, LABEL_MAX);
    const selector = trimmed(event.selector, 200);
    const site = hostOf(pageUrl);
    const meta: TeachFieldMeta = { inputType: String(event.inputType ?? ""), autocomplete: String(event.autocomplete ?? ""), field, selector };
    const declared = event.secret === "password" || event.secret === "code" || event.secret === "card" || event.secret === "secret" ? event.secret : null;
    let secret: TeachSecretKind | null = declared ?? secretKindOfField(meta);
    const value = typeof event.value === "string" ? event.value.slice(0, VALUE_MAX) : "";
    if (!secret && value) {
      if (looksLikeCardNumber(value)) secret = "card";
      else if (CODE_LIKE_FIELD.test(`${field} ${selector}`) && /^\d{4,8}$/.test(value.trim())) secret = "code";
    }
    if (secret) return { kind: "type-secret", field, selector, secret, site };
    return { kind: "type", field, selector, value };
  }
  if (t === "key") {
    const key = trimmed(event.key, 40);
    if (!key) return null;
    const field = trimmed(event.field, LABEL_MAX);
    return field ? { kind: "key", key, field } : { kind: "key", key };
  }
  if (t === "scroll") {
    if (typeof event.direction !== "string" || !SCROLL_DIRS.has(event.direction)) return null;
    const amount = Math.max(0, Math.min(100_000, Math.round(Number(event.amount) || 0)));
    return { kind: "scroll", direction: event.direction as "up" | "down", amount };
  }
  return null;
}

/** Botoes e atalhos que mudam o mundo: enviar, apagar, pagar, publicar, comprar, aceitar termos. */
export function isCriticalLabel(text: string): boolean {
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /\b(enviar|envie|send|apagar|apague|excluir|exclua|delete|remover|remova|remove|pagar|pague|pay|comprar|compre|buy|publicar|publique|publish|postar|post|finalizar compra|checkout|place order|submit|assinar|subscribe)\b/.test(plain) ||
    /confirmar (o )?pagamento|confirm payment|aceitar (os )?termos|accept (the )?terms|concordo/.test(plain);
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.host.replace(/^www\./, "")}${path}`.slice(0, 80);
  } catch { return url.slice(0, 80); }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Frase curta em portugues para a lista de passos da interface e para o resumo. */
export function teachStepLabel(step: TeachStep): string {
  const a = step.action;
  switch (a.kind) {
    case "navigate": return `Abrir ${shortUrl(a.url)}`;
    case "click": return a.text ? `Clicar em "${clip(a.text, 40)}"` : "Clicar";
    case "type": return `Digitar "${clip(a.value, 40)}"${a.field ? ` em ${clip(a.field, 40)}` : ""}`;
    case "type-secret": {
      const what = a.secret === "password" ? "a senha" : a.secret === "code" ? "o código" : a.secret === "card" ? "os dados do cartão" : "o dado secreto";
      return `Digitar ${what} do site ${a.site || shortUrl(step.url)}`;
    }
    case "key": return a.key === "Enter" ? "Apertar Enter" : `Apertar ${a.key}`;
    case "scroll": return "Rolar a página";
    case "tab": return a.title ? `Trocar para a aba "${clip(a.title, 40)}"` : "Trocar de aba";
  }
}
