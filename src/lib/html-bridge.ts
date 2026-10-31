// The only channel between a bot's sandboxed HTML page and the app. The page can say these few things; every message is
// checked for shape here, and the caller checks that it came from that card's own frame (event.source), never event.origin
// (a sandboxed frame's origin is "null").
export const REPLY_MAX_CHARS = 20_000;
export const DRAFT_MAX_BYTES = 200 * 1024;
export const AUDIO_MAX_BYTES = 10 * 1024 * 1024;
export const HEIGHT_MIN = 240;
export const AUDIO_MIMES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"] as const;

export type BridgeMessage =
  | { kind: "reply"; text: string }
  | { kind: "reply-too-long" }
  | { kind: "draft"; json: string }
  | { kind: "height"; height: number }
  | { kind: "record"; id: string; action: "iniciar" | "parar" | "cancelar" }
  | { kind: "transcribe"; id: string; mime: (typeof AUDIO_MIMES)[number]; audio: ArrayBuffer };

function record(data: unknown): Record<string, unknown> | null {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

export function parseBridgeMessage(data: unknown): BridgeMessage | null {
  const message = record(data);
  if (!message || message.versao !== 1) return null;
  switch (message.tipo) {
    case "nordus:responder": {
      const text = message.texto;
      if (typeof text !== "string" || !text.trim()) return null;
      return text.length > REPLY_MAX_CHARS ? { kind: "reply-too-long" } : { kind: "reply", text };
    }
    case "nordus:rascunho": {
      let json: string | undefined;
      try { json = JSON.stringify(message.dados); } catch { return null; }
      if (json === undefined || json.length > DRAFT_MAX_BYTES) return null;
      return { kind: "draft", json };
    }
    case "nordus:altura": {
      const height = message.altura;
      return typeof height === "number" && Number.isFinite(height) && height > 0 ? { kind: "height", height } : null;
    }
    case "nordus:gravar": {
      const { id, acao } = message;
      if (typeof id !== "string" || !id || id.length > 64) return null;
      if (acao !== "iniciar" && acao !== "parar" && acao !== "cancelar") return null;
      return { kind: "record", id, action: acao };
    }
    case "nordus:transcrever": {
      const { id, mime, audio } = message;
      if (typeof id !== "string" || !id || id.length > 64) return null;
      if (typeof mime !== "string" || !(AUDIO_MIMES as readonly string[]).includes(mime)) return null;
      if (!(audio instanceof ArrayBuffer)) return null;
      return { kind: "transcribe", id, mime: mime as (typeof AUDIO_MIMES)[number], audio };
    }
    default:
      return null;
  }
}

/** The height the card takes for a page's own request: never under 240 px, never over 85% of the screen. */
export function autoHeight(requested: number, viewport: number): number {
  return Math.round(Math.max(HEIGHT_MIN, Math.min(requested, viewport * 0.85)));
}

export function draftStorageKey(threadId: string, messageId: string, name: string): string {
  return `nordus:html-draft:${threadId}:${messageId}:${name}`;
}

export function saveHtmlDraft(key: string, json: string): void {
  try { localStorage.setItem(key, json); } catch { /* storage may be full or blocked */ }
}

export function loadHtmlDraft(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null || raw.length > DRAFT_MAX_BYTES ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}
