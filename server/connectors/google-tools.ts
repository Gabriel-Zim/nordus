// Gmail, Calendar, Drive, Docs and Sheets for one connected Google account, over Google's REST APIs.
// The access token is renewed from the refresh token in memory; nothing is written back.
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import type { ConnectorTool } from "./stdio-mcp.ts";

export interface GoogleAccountEnv {
  account: string;
  clientId: string;
  clientSecret: string;
  refresh: string;
  access?: string;
  expiresAt?: number;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DOCS = "https://docs.googleapis.com/v1/documents";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_READ_CHARS = 100_000;

const SERVICE_NAMES: Array<[RegExp, string]> = [
  [/gmail/i, "Gmail API"],
  [/calendar/i, "Google Calendar API"],
  [/docs\.googleapis|documents/i, "Google Docs API"],
  [/sheets/i, "Google Sheets API"],
  [/drive/i, "Google Drive API"],
];

/** Google's error, said so a person can act on it. */
export function googleErrorMessage(status: number, body: unknown, url: string): string {
  const error = (body as { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } } | undefined)?.error;
  const message = typeof error?.message === "string" ? error.message : typeof body === "string" ? body : "";
  const service = SERVICE_NAMES.find(([pattern]) => pattern.test(url))?.[1] ?? "API do Google";
  if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(`${message} ${JSON.stringify(error?.details ?? [])}`)) {
    return `O Google ainda não liberou esse serviço para o app da Nordus: falta ativar a ${service} no Google Cloud.`;
  }
  if (status === 403 && /insufficient|scope/i.test(message)) {
    return "A conta do Google foi conectada sem essa permissão. Conecte a conta de novo em Conectar apps → Google e aceite todas as permissões.";
  }
  if (status === 404) return "Não encontrei esse item no Google. Confira o endereço ou o código.";
  if (status === 403) return `O Google não deixou fazer isso com essa conta${message ? `: ${message}` : "."}`;
  if (status === 429) return "O Google pediu para esperar um pouco antes de tentar de novo.";
  if (status === 400) return `O Google recusou o pedido${message ? `: ${message}` : "."}`;
  return `O Google respondeu com erro ${status}${message ? `: ${message}` : "."}`;
}

class GoogleError extends Error {}

export function createGoogleClient(env: GoogleAccountEnv, fetcher: typeof fetch = fetch) {
  let access = env.access ?? "";
  let expiresAt = env.expiresAt ?? 0;
  let renewing: Promise<string> | null = null;

  async function renew(): Promise<string> {
    if (!env.refresh || !env.clientId || !env.clientSecret) {
      throw new GoogleError("A conta do Google precisa ser conectada de novo na Nordus (Conectar apps → Google).");
    }
    const response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: env.refresh,
        client_id: env.clientId,
        client_secret: env.clientSecret,
      }).toString(),
    });
    const tokens = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !tokens.access_token) {
      throw new GoogleError(tokens.error === "invalid_grant"
        ? "O acesso a essa conta do Google venceu ou foi retirado. Conecte a conta de novo em Conectar apps → Google."
        : "Não consegui renovar o acesso à conta do Google agora. Tente de novo em instantes.");
    }
    access = tokens.access_token;
    expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    return access;
  }

  async function token(force = false): Promise<string> {
    if (!force && access && expiresAt - Date.now() > 60_000) return access;
    renewing ??= renew().finally(() => { renewing = null; });
    return renewing;
  }

  async function send(url: string, init: RequestInit, retried = false): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await token(retried)}`);
    const response = await fetcher(url, { ...init, headers });
    if (response.status === 401 && !retried) return send(url, init, true);
    return response;
  }

  async function request(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await send(url, init);
    const text = await response.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) throw new GoogleError(googleErrorMessage(response.status, body, url));
    return body;
  }

  async function requestText(url: string): Promise<string> {
    const response = await send(url, {});
    const text = await response.text();
    if (!response.ok) {
      let body: unknown = text;
      try { body = JSON.parse(text); } catch {}
      throw new GoogleError(googleErrorMessage(response.status, body, url));
    }
    return text;
  }

  const json = (method: string, url: string, body?: unknown) => request(url, {
    method,
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return { request, requestText, json, send, token };
}
export type GoogleClient = ReturnType<typeof createGoogleClient>;

function withQuery(base: string, query: Record<string, unknown>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const str = (value: unknown) => (value === undefined || value === null ? "" : String(value));
const list = (value: unknown): string[] => Array.isArray(value)
  ? value.map(str).map((item) => item.trim()).filter(Boolean)
  : str(value).split(/[,;]/).map((item) => item.trim()).filter(Boolean);
const limit = (value: unknown, fallback: number, max: number) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
};
const id = (value: unknown, what: string) => {
  const raw = str(value).trim();
  if (!raw) throw new GoogleError(`Falta ${what}.`);
  // Accept a full Google link where an id is expected.
  return raw.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? raw.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1] ?? raw;
};
const clip = (text: string, max = MAX_READ_CHARS) => text.length > max ? `${text.slice(0, max)}\n[... cortado: ${text.length - max} caracteres a mais]` : text;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", required, properties });
const text = (description?: string) => (description ? { type: "string", description } : { type: "string" });
const strings = (description: string) => ({ type: "array", items: { type: "string" }, description });

// ---------- Gmail ----------

interface GmailPart { mimeType?: string; filename?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[]; headers?: Array<{ name: string; value: string }> }
interface GmailMessage { id: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart }

const header = (part: GmailPart | undefined, name: string) => part?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;
const decode = (data: string | undefined) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The readable body of a message and the names of its attachments. */
export function messageBody(payload: GmailPart | undefined): { text: string; attachments: Array<{ name: string; mimeType?: string; size?: number }> } {
  let plain = "";
  let html = "";
  const attachments: Array<{ name: string; mimeType?: string; size?: number }> = [];
  const walk = (part: GmailPart | undefined) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      attachments.push({ name: part.filename, mimeType: part.mimeType, size: part.body.size });
      return;
    }
    if (part.mimeType === "text/plain" && !plain) plain = decode(part.body?.data);
    else if (part.mimeType === "text/html" && !html) html = decode(part.body?.data);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return { text: plain.trim() || htmlToText(html), attachments };
}

const summary = (message: GmailMessage) => ({
  id: message.id,
  threadId: message.threadId,
  from: header(message.payload, "From"),
  to: header(message.payload, "To"),
  subject: header(message.payload, "Subject"),
  date: header(message.payload, "Date"),
  unread: message.labelIds?.includes("UNREAD") ?? false,
  snippet: message.snippet,
});

const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`);
const cleanHeader = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** An RFC 2822 message, base64url, as Gmail takes it. */
export function buildMime(input: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string; html?: boolean; inReplyTo?: string; references?: string }): string {
  const lines = [
    `To: ${cleanHeader(input.to.join(", "))}`,
    ...(input.cc?.length ? [`Cc: ${cleanHeader(input.cc.join(", "))}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${cleanHeader(input.bcc.join(", "))}`] : []),
    `Subject: ${encodeHeader(cleanHeader(input.subject))}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${cleanHeader(input.inReplyTo)}`, `References: ${cleanHeader(input.references ?? input.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: ${input.html ? "text/html" : "text/plain"}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function composeMessage(client: GoogleClient, args: Record<string, unknown>): Promise<{ raw: string; threadId?: string }> {
  const to = list(args.to);
  if (!to.length) throw new GoogleError("Falta para quem é o e-mail.");
  let subject = str(args.subject);
  let inReplyTo: string | undefined;
  let references: string | undefined;
  let threadId: string | undefined;
  if (args.reply_to_message_id) {
    const original = await client.json("GET", withQuery(`${GMAIL}/messages/${encodeURIComponent(str(args.reply_to_message_id))}`, {
      format: "metadata", metadataHeaders: ["Subject", "Message-ID", "References"],
    })) as GmailMessage;
    threadId = original.threadId;
    inReplyTo = header(original.payload, "Message-ID");
    references = [header(original.payload, "References"), inReplyTo].filter(Boolean).join(" ") || undefined;
    const originalSubject = header(original.payload, "Subject") ?? "";
    if (!subject) subject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
  }
  return {
    raw: buildMime({ to, cc: list(args.cc), bcc: list(args.bcc), subject, body: str(args.body), html: args.html === true, inReplyTo, references }),
    threadId,
  };
}

// ---------- Docs ----------

interface DocElement { paragraph?: { elements?: Array<{ textRun?: { content?: string } }> }; table?: { tableRows?: Array<{ tableCells?: Array<{ content?: DocElement[] }> }> } }

export function docText(content: DocElement[] | undefined): string {
  let out = "";
  for (const element of content ?? []) {
    if (element.paragraph) out += (element.paragraph.elements ?? []).map((part) => part.textRun?.content ?? "").join("");
    if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        out += `${(row.tableCells ?? []).map((cell) => docText(cell.content).replace(/\n+/g, " ").trim()).join(" | ")}\n`;
      }
    }
  }
  return out;
}

// ---------- Drive ----------

const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/svg+xml",
};
const READABLE = /^(text\/|application\/(json|xml|javascript|x-yaml|csv))/;
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents,owners(emailAddress)";

const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", txt: "text/plain", md: "text/markdown",
  csv: "text/csv", json: "application/json", html: "text/html", zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// ---------- Calendar ----------

/** A date ("2026-10-20") is an all-day event; anything else is a moment. */
const when = (value: unknown, timeZone?: string) => {
  const raw = str(value).trim();
  if (!raw) throw new GoogleError("Falta a data ou o horário do evento.");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw };
  return { dateTime: raw, ...(timeZone ? { timeZone } : {}) };
};

interface CalendarEvent { id?: string; summary?: string; description?: string; location?: string; start?: unknown; end?: unknown; attendees?: Array<{ email?: string; responseStatus?: string }>; htmlLink?: string; hangoutLink?: string; status?: string; organizer?: { email?: string } }
const eventSummary = (event: CalendarEvent) => ({
  id: event.id,
  title: event.summary,
  start: event.start,
  end: event.end,
  location: event.location,
  description: event.description ? clip(event.description, 2000) : undefined,
  attendees: event.attendees?.map((attendee) => ({ email: attendee.email, response: attendee.responseStatus })),
  organizer: event.organizer?.email,
  meet: event.hangoutLink,
  link: event.htmlLink,
  status: event.status,
});

// ---------- Tools ----------

export function googleTools(client: GoogleClient, account: string): ConnectorTool[] {
  const of = (description: string) => (account ? `${description} Conta: ${account}.` : description);
  return [
    // Gmail
    {
      name: "gmail_search",
      description: of("Busca e-mails no Gmail. Aceita a busca do Gmail (from:, to:, subject:, is:unread, newer_than:7d, has:attachment). Sem busca, traz os mais recentes da caixa de entrada."),
      inputSchema: obj({ query: text("Busca do Gmail, ex.: is:unread newer_than:3d"), max_results: { type: "number", description: "Até 50, padrão 10" } }),
      run: async (args) => {
        const found = await client.json("GET", withQuery(`${GMAIL}/messages`, {
          q: str(args.query).trim() || "in:inbox",
          maxResults: limit(args.max_results, 10, 50),
        })) as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };
        const messages = await Promise.all((found.messages ?? []).map((entry) => client.json("GET", withQuery(`${GMAIL}/messages/${entry.id}`, {
          format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"],
        })) as Promise<GmailMessage>));
        return { total_estimate: found.resultSizeEstimate ?? messages.length, messages: messages.map(summary) };
      },
    },
    {
      name: "gmail_read",
      description: of("Lê um e-mail inteiro do Gmail pelo id (vindo de gmail_search): remetente, assunto, texto e nomes dos anexos."),
      inputSchema: obj({ message_id: text() }, ["message_id"]),
      run: async (args) => {
        const message = await client.json("GET", withQuery(`${GMAIL}/messages/${encodeURIComponent(id(args.message_id, "o id do e-mail"))}`, { format: "full" })) as GmailMessage;
        const body = messageBody(message.payload);
        return { ...summary(message), cc: header(message.payload, "Cc"), text: clip(body.text), attachments: body.attachments };
      },
    },
    {
      name: "gmail_create_draft",
      description: of("Cria um rascunho no Gmail, sem enviar. Para responder um e-mail, passe reply_to_message_id (o assunto e a conversa vêm dele)."),
      inputSchema: obj({
        to: strings("Destinatários"), cc: strings("Cópia"), bcc: strings("Cópia oculta"), subject: text(), body: text("Texto do e-mail"),
        html: { type: "boolean", description: "true se o texto for HTML" }, reply_to_message_id: text(),
      }, ["to", "body"]),
      run: async (args) => {
        const message = await composeMessage(client, args);
        const draft = await client.json("POST", `${GMAIL}/drafts`, { message }) as { id?: string; message?: { id?: string; threadId?: string } };
        return { draft_id: draft.id, message_id: draft.message?.id, threadId: draft.message?.threadId, link: "https://mail.google.com/mail/u/0/#drafts" };
      },
    },
    {
      name: "gmail_send",
      description: of("Envia um e-mail pelo Gmail. Envia um rascunho já criado (draft_id) ou um e-mail novo. Para responder, passe reply_to_message_id."),
      inputSchema: obj({
        draft_id: text("Rascunho a enviar; com ele os outros campos são ignorados"),
        to: strings("Destinatários"), cc: strings("Cópia"), bcc: strings("Cópia oculta"), subject: text(), body: text("Texto do e-mail"),
        html: { type: "boolean", description: "true se o texto for HTML" }, reply_to_message_id: text(),
      }),
      run: async (args) => {
        const sent = args.draft_id
          ? await client.json("POST", `${GMAIL}/drafts/send`, { id: str(args.draft_id) })
          : await client.json("POST", `${GMAIL}/messages/send`, await composeMessage(client, args));
        const result = sent as { id?: string; threadId?: string };
        return { sent: true, message_id: result.id, threadId: result.threadId };
      },
    },
    // Calendar
    {
      name: "calendar_list_calendars",
      description: of("Lista as agendas que a conta vê no Google Agenda (a principal é primary)."),
      inputSchema: obj({}),
      run: async () => {
        const result = await client.json("GET", withQuery(`${CALENDAR}/users/me/calendarList`, { maxResults: 100 })) as { items?: Array<{ id?: string; summary?: string; primary?: boolean; accessRole?: string; timeZone?: string }> };
        return (result.items ?? []).map((item) => ({ id: item.id, name: item.summary, primary: item.primary ?? false, access: item.accessRole, timeZone: item.timeZone }));
      },
    },
    {
      name: "calendar_list_events",
      description: of("Lista eventos do Google Agenda. Sem datas, traz os próximos 7 dias. Datas em ISO 8601 (2026-10-20T09:00:00-03:00)."),
      inputSchema: obj({
        calendar_id: text("Padrão: primary"), time_min: text("Início do período"), time_max: text("Fim do período"),
        query: text("Texto para filtrar"), max_results: { type: "number", description: "Até 100, padrão 25" },
      }),
      run: async (args) => {
        const start = str(args.time_min) || new Date().toISOString();
        const end = str(args.time_max) || new Date(Date.parse(start) + 7 * 86_400_000).toISOString();
        const result = await client.json("GET", withQuery(`${CALENDAR}/calendars/${encodeURIComponent(str(args.calendar_id) || "primary")}/events`, {
          timeMin: start, timeMax: end, q: args.query, singleEvents: "true", orderBy: "startTime", maxResults: limit(args.max_results, 25, 100),
        })) as { items?: CalendarEvent[]; timeZone?: string };
        return { timeZone: result.timeZone, events: (result.items ?? []).map(eventSummary) };
      },
    },
    {
      name: "calendar_create_event",
      description: of("Cria um evento no Google Agenda. Início e fim em ISO 8601, ou só a data (2026-10-20) para dia inteiro. Convidados só recebem aviso se notify for true."),
      inputSchema: obj({
        title: text(), start: text(), end: text(), description: text(), location: text(), attendees: strings("E-mails dos convidados"),
        time_zone: text("Ex.: America/Sao_Paulo"), calendar_id: text("Padrão: primary"), meet: { type: "boolean", description: "true cria link do Google Meet" },
        notify: { type: "boolean", description: "true avisa os convidados por e-mail" },
      }, ["title", "start", "end"]),
      run: async (args) => {
        const timeZone = str(args.time_zone) || undefined;
        const event = {
          summary: str(args.title),
          description: args.description ? str(args.description) : undefined,
          location: args.location ? str(args.location) : undefined,
          start: when(args.start, timeZone),
          end: when(args.end, timeZone),
          attendees: list(args.attendees).map((email) => ({ email })),
          ...(args.meet ? { conferenceData: { createRequest: { requestId: `nordus-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
        };
        const created = await client.json("POST", withQuery(`${CALENDAR}/calendars/${encodeURIComponent(str(args.calendar_id) || "primary")}/events`, {
          sendUpdates: args.notify ? "all" : "none", conferenceDataVersion: args.meet ? 1 : undefined,
        }), event) as CalendarEvent;
        return eventSummary(created);
      },
    },
    {
      name: "calendar_update_event",
      description: of("Muda um evento do Google Agenda pelo id: título, horário, local, descrição, convidados, ou cancela (cancel: true). Só os campos enviados mudam."),
      inputSchema: obj({
        event_id: text(), title: text(), start: text(), end: text(), description: text(), location: text(),
        attendees: strings("Lista nova de convidados (substitui a atual)"), time_zone: text(), calendar_id: text("Padrão: primary"),
        cancel: { type: "boolean", description: "true cancela o evento" }, notify: { type: "boolean", description: "true avisa os convidados" },
      }, ["event_id"]),
      run: async (args) => {
        const timeZone = str(args.time_zone) || undefined;
        const patch: Record<string, unknown> = {};
        if (args.title !== undefined) patch.summary = str(args.title);
        if (args.description !== undefined) patch.description = str(args.description);
        if (args.location !== undefined) patch.location = str(args.location);
        if (args.start) patch.start = when(args.start, timeZone);
        if (args.end) patch.end = when(args.end, timeZone);
        if (args.attendees !== undefined) patch.attendees = list(args.attendees).map((email) => ({ email }));
        if (args.cancel === true) patch.status = "cancelled";
        if (!Object.keys(patch).length) throw new GoogleError("Diga o que mudar no evento.");
        const updated = await client.json("PATCH", withQuery(
          `${CALENDAR}/calendars/${encodeURIComponent(str(args.calendar_id) || "primary")}/events/${encodeURIComponent(id(args.event_id, "o id do evento"))}`,
          { sendUpdates: args.notify ? "all" : "none" },
        ), patch) as CalendarEvent;
        return eventSummary(updated);
      },
    },
    // Drive
    {
      name: "drive_search",
      description: of("Busca arquivos no Google Drive pelo nome ou pelo conteúdo. Para filtros avançados, use drive_query na sintaxe do Drive (ex.: mimeType='application/pdf')."),
      inputSchema: obj({
        query: text("Texto a procurar"), drive_query: text("Busca na sintaxe do Drive, somada à anterior"), folder_id: text("Só dentro desta pasta"),
        max_results: { type: "number", description: "Até 100, padrão 20" },
      }),
      run: async (args) => {
        const terms = ["trashed = false"];
        const words = str(args.query).trim();
        if (words) terms.push(`(name contains '${quote(words)}' or fullText contains '${quote(words)}')`);
        if (args.folder_id) terms.push(`'${quote(id(args.folder_id, "a pasta"))}' in parents`);
        if (args.drive_query) terms.push(`(${str(args.drive_query)})`);
        const result = await client.json("GET", withQuery(`${DRIVE}/files`, {
          q: terms.join(" and "), pageSize: limit(args.max_results, 20, 100), fields: `files(${FILE_FIELDS})`,
          orderBy: words ? undefined : "modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "allDrives",
        })) as { files?: unknown[] };
        return result.files ?? [];
      },
    },
    {
      name: "drive_read",
      description: of("Lê um arquivo do Google Drive pelo id ou link. Documentos, planilhas e apresentações do Google vêm como texto; arquivos de texto vêm inteiros; os demais vêm só com dados e link."),
      inputSchema: obj({ file_id: text("Id ou link do arquivo") }, ["file_id"]),
      run: async (args) => {
        const fileId = id(args.file_id, "o arquivo");
        const meta = await client.json("GET", withQuery(`${DRIVE}/files/${encodeURIComponent(fileId)}`, { fields: FILE_FIELDS, supportsAllDrives: "true" })) as { mimeType?: string; size?: string; name?: string };
        const mime = meta.mimeType ?? "";
        if (EXPORTS[mime]) {
          return { ...meta, content: clip(await client.requestText(withQuery(`${DRIVE}/files/${encodeURIComponent(fileId)}/export`, { mimeType: EXPORTS[mime] }))) };
        }
        if (READABLE.test(mime) && Number(meta.size ?? 0) <= 5 * 1024 * 1024) {
          return { ...meta, content: clip(await client.requestText(withQuery(`${DRIVE}/files/${encodeURIComponent(fileId)}`, { alt: "media", supportsAllDrives: "true" }))) };
        }
        return { ...meta, content: null, note: "Esse tipo de arquivo não vira texto; use o link para abrir." };
      },
    },
    {
      name: "drive_upload",
      description: of("Envia um arquivo para o Google Drive: um arquivo do computador do robô (local_path) ou um texto (content). Pode virar Documento ou Planilha do Google com convert: true."),
      inputSchema: obj({
        local_path: text("Caminho de um arquivo no computador do robô"), content: text("Texto do arquivo, quando não houver local_path"),
        name: text("Nome no Drive"), mime_type: text(), folder_id: text("Pasta de destino"),
        convert: { type: "boolean", description: "true converte texto/CSV/Office em arquivo do Google" },
      }),
      run: async (args) => {
        let data: Buffer;
        let name = str(args.name);
        const path = str(args.local_path).trim();
        if (path) {
          const size = statSync(path).size;
          if (size > MAX_UPLOAD_BYTES) throw new GoogleError("O arquivo passa de 50 MB; envie por outro caminho.");
          data = readFileSync(path);
          name ||= basename(path);
        } else if (args.content !== undefined) {
          data = Buffer.from(str(args.content), "utf8");
          name ||= "Arquivo da Nordus.txt";
        } else {
          throw new GoogleError("Diga qual arquivo enviar (local_path) ou o texto (content).");
        }
        const extension = name.split(".").pop()?.toLowerCase() ?? "";
        const mime = str(args.mime_type) || MIME_BY_EXTENSION[extension] || (path ? "application/octet-stream" : "text/plain");
        const target = args.convert === true
          ? (/csv|spreadsheet|excel/.test(mime) ? "application/vnd.google-apps.spreadsheet" : /presentation|powerpoint/.test(mime) ? "application/vnd.google-apps.presentation" : "application/vnd.google-apps.document")
          : undefined;
        const metadata = {
          name: target ? name.replace(/\.[a-z0-9]+$/i, "") : name,
          ...(target ? { mimeType: target } : {}),
          ...(args.folder_id ? { parents: [id(args.folder_id, "a pasta")] } : {}),
        };
        // A resumable session takes any size in one PUT.
        const start = await client.send(withQuery(DRIVE_UPLOAD, { uploadType: "resumable", supportsAllDrives: "true", fields: FILE_FIELDS }), {
          method: "POST",
          headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": mime, "x-upload-content-length": String(data.length) },
          body: JSON.stringify(metadata),
        });
        const location = start.headers.get("location");
        if (!start.ok || !location) {
          const body = await start.json().catch(() => ({}));
          throw new GoogleError(googleErrorMessage(start.status, body, DRIVE_UPLOAD));
        }
        return client.request(location, { method: "PUT", headers: { "content-type": mime }, body: new Uint8Array(data) });
      },
    },
    // Docs
    {
      name: "docs_read",
      description: of("Lê o texto de um Documento Google pelo id ou link."),
      inputSchema: obj({ document_id: text("Id ou link do documento") }, ["document_id"]),
      run: async (args) => {
        const doc = await client.json("GET", `${DOCS}/${encodeURIComponent(id(args.document_id, "o documento"))}`) as { documentId?: string; title?: string; body?: { content?: DocElement[] } };
        return { id: doc.documentId, title: doc.title, link: `https://docs.google.com/document/d/${doc.documentId}/edit`, text: clip(docText(doc.body?.content)) };
      },
    },
    {
      name: "docs_create",
      description: of("Cria um Documento Google novo, com texto inicial opcional."),
      inputSchema: obj({ title: text(), text: text("Texto inicial") }, ["title"]),
      run: async (args) => {
        const doc = await client.json("POST", DOCS, { title: str(args.title) }) as { documentId: string; title?: string };
        if (str(args.text)) {
          await client.json("POST", `${DOCS}/${doc.documentId}:batchUpdate`, { requests: [{ insertText: { location: { index: 1 }, text: str(args.text) } }] });
        }
        return { id: doc.documentId, title: doc.title, link: `https://docs.google.com/document/d/${doc.documentId}/edit` };
      },
    },
    {
      name: "docs_write",
      description: of("Escreve num Documento Google: acrescenta texto no fim (append) ou troca todas as ocorrências de um trecho (find e replace)."),
      inputSchema: obj({
        document_id: text("Id ou link do documento"), append: text("Texto para pôr no fim"), find: text("Trecho a trocar"), replace: text("Texto novo"),
        match_case: { type: "boolean" },
      }, ["document_id"]),
      run: async (args) => {
        const docId = id(args.document_id, "o documento");
        const requests: unknown[] = [];
        if (args.find !== undefined && str(args.find)) {
          requests.push({ replaceAllText: { containsText: { text: str(args.find), matchCase: args.match_case === true }, replaceText: str(args.replace) } });
        }
        if (str(args.append)) requests.push({ insertText: { endOfSegmentLocation: {}, text: str(args.append) } });
        if (!requests.length) throw new GoogleError("Diga o texto a acrescentar (append) ou o trecho a trocar (find e replace).");
        const result = await client.json("POST", `${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, { requests }) as { replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }> };
        const changed = result.replies?.find((reply) => reply.replaceAllText)?.replaceAllText?.occurrencesChanged;
        return { ok: true, link: `https://docs.google.com/document/d/${docId}/edit`, ...(changed !== undefined ? { replaced: changed } : {}) };
      },
    },
    // Sheets
    {
      name: "sheets_read",
      description: of("Lê uma Planilha Google pelo id ou link. Sem intervalo, traz as abas e a primeira aba; com intervalo (ex.: Vendas!A1:D50), só ele."),
      inputSchema: obj({ spreadsheet_id: text("Id ou link da planilha"), range: text("Intervalo, ex.: Página1!A1:F100") }, ["spreadsheet_id"]),
      run: async (args) => {
        const sheetId = id(args.spreadsheet_id, "a planilha");
        const meta = await client.json("GET", withQuery(`${SHEETS}/${encodeURIComponent(sheetId)}`, { fields: "properties.title,sheets.properties(title,gridProperties)" })) as {
          properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
        };
        const tabs = (meta.sheets ?? []).map((sheet) => ({ title: sheet.properties?.title, rows: sheet.properties?.gridProperties?.rowCount, columns: sheet.properties?.gridProperties?.columnCount }));
        const range = str(args.range) || (tabs[0]?.title ? `'${tabs[0].title.replace(/'/g, "''")}'!A1:Z200` : "A1:Z200");
        const values = await client.json("GET", `${SHEETS}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`) as { range?: string; values?: unknown[][] };
        return { title: meta.properties?.title, tabs, range: values.range, values: values.values ?? [], link: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` };
      },
    },
    {
      name: "sheets_write",
      description: of("Escreve numa Planilha Google: grava valores num intervalo (mode: overwrite) ou acrescenta linhas no fim da tabela (mode: append). Fórmulas começando com = funcionam."),
      inputSchema: obj({
        spreadsheet_id: text("Id ou link da planilha"), range: text("Intervalo inicial, ex.: Página1!A1"),
        values: { type: "array", items: { type: "array", items: {} }, description: "Linhas, cada uma uma lista de células" },
        mode: { type: "string", enum: ["overwrite", "append"], description: "Padrão: overwrite" },
      }, ["spreadsheet_id", "range", "values"]),
      run: async (args) => {
        const sheetId = id(args.spreadsheet_id, "a planilha");
        if (!Array.isArray(args.values) || !args.values.every(Array.isArray)) throw new GoogleError("Os valores precisam ser uma lista de linhas.");
        const range = encodeURIComponent(str(args.range));
        const result = args.mode === "append"
          ? await client.json("POST", withQuery(`${SHEETS}/${encodeURIComponent(sheetId)}/values/${range}:append`, { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" }), { values: args.values })
          : await client.json("PUT", withQuery(`${SHEETS}/${encodeURIComponent(sheetId)}/values/${range}`, { valueInputOption: "USER_ENTERED" }), { values: args.values });
        const updates = (result as { updates?: { updatedRange?: string; updatedCells?: number }; updatedRange?: string; updatedCells?: number });
        return { ok: true, range: updates.updates?.updatedRange ?? updates.updatedRange, cells: updates.updates?.updatedCells ?? updates.updatedCells };
      },
    },
    {
      name: "sheets_create",
      description: of("Cria uma Planilha Google nova, com abas opcionais."),
      inputSchema: obj({ title: text(), tabs: strings("Nomes das abas") }, ["title"]),
      run: async (args) => {
        const tabs = list(args.tabs);
        const sheet = await client.json("POST", SHEETS, {
          properties: { title: str(args.title) },
          ...(tabs.length ? { sheets: tabs.map((title) => ({ properties: { title } })) } : {}),
        }) as { spreadsheetId?: string; spreadsheetUrl?: string };
        return { id: sheet.spreadsheetId, link: sheet.spreadsheetUrl };
      },
    },
  ];
}
