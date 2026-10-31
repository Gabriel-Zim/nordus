// Each bot's own inbox at @mailbot.example.com. Mail is received and stored by the nordus-mailbot Cloudflare Worker;
// this server reads it with the admin key kept in a 0600 file here, and the key never reaches a browser.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAILBOT_DOMAIN = "mailbot.example.com";
const MAILBOT_URL = process.env.NORDUS_MAILBOT_URL ?? "https://mailbot.example.com";
// Cloudflare answers 403 to requests without a User-Agent of their own.
const USER_AGENT = "nordus-lab/1";

/** Mailbox slug → its addresses (local parts), as the Worker routes them. */
export const MAILBOXES: Readonly<Record<string, readonly string[]>> = {
  "gerente-de-operacao": ["gerentedeoperacao", "news"],
  social: ["social"],
  designerdeia: ["designerdeia"],
  montadordevideo: ["editor"],
  assistentefinanceiro: ["assistentefinanceiro", "finance"],
  assistentepessoal: ["assistentepessoal"],
  ops: ["ops"],
  lumon: ["lumon"],
  fabrikam: ["fabrikam"],
  evergreen: ["evergreen"],
};

/** Which mailbox each bot reads, chosen on its profile and kept in `bot-mailboxes.json` in the data folder
 *  ({ "<bot id>": "assistentefinanceiro" }). Nothing is guessed from bot names: a bot without an entry has no email. */
export class BotMailboxChoices {
  private readonly file: string;
  private choices: Record<string, string> = {};

  constructor(dataDir: string) {
    this.file = join(dataDir, "bot-mailboxes.json");
    try {
      const saved = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        for (const [botId, slug] of Object.entries(saved)) if (typeof slug === "string" && MAILBOXES[slug]) this.choices[botId] = slug;
      }
    } catch { /* no file yet */ }
  }

  get(botId: string): string | null {
    return this.choices[botId] ?? null;
  }

  set(botId: string, slug: string | null): void {
    if (slug === null) delete this.choices[botId];
    else if (MAILBOXES[slug]) this.choices[botId] = slug;
    else throw new Error("unknown mailbox");
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.choices, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.file);
  }
}

export function mailboxAddresses(slug: string): string[] {
  return (MAILBOXES[slug] ?? []).map((local) => `${local}@${MAILBOT_DOMAIN}`);
}

function adminKey(): string | null {
  try {
    const key = readFileSync(process.env.NORDUS_MAILBOT_KEY_FILE ?? join(homedir(), "zorg", "mailbot", "admin-chave"), "utf8").trim();
    return key || null;
  } catch {
    return null;
  }
}

export function mailbotAvailable(): boolean {
  return adminKey() !== null;
}

export class MailbotError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`mailbot answered ${status}`);
    this.status = status;
  }
}

export async function mailbotFetch(path: string, init: { method?: string } = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  const key = adminKey();
  if (!key) throw new MailbotError(503);
  const response = await fetcher(`${MAILBOT_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) throw new MailbotError(response.status);
  return response;
}

export interface MailSummary {
  id: string;
  address: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  at: string;
  read: boolean;
  attachments: Array<{ n: number; name: string; type: string; size: number }>;
  preview: string;
}

type Raw = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);
function attachmentsOf(value: unknown): MailSummary["attachments"] {
  let list = value;
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.map((item: Raw, index) => ({
    n: typeof item.n === "number" ? item.n : index,
    name: text(item.nome ?? item.name) || `anexo-${index + 1}`,
    type: text(item.tipo ?? item.type) || "application/octet-stream",
    size: Number(item.tamanho ?? item.size ?? 0) || 0,
  }));
}

export function summaryOf(raw: Raw): MailSummary {
  return {
    id: text(raw.id),
    address: `${text(raw.endereco)}@${MAILBOT_DOMAIN}`,
    fromEmail: text(raw.de_email),
    fromName: text(raw.de_nome) || null,
    subject: text(raw.assunto),
    at: text(raw.data) || text(raw.recebido_em),
    read: raw.lido === 1 || raw.lido === "1" || raw.lido === true,
    attachments: attachmentsOf(raw.anexos),
    preview: text(raw.previa).replace(/\s+/g, " ").trim().slice(0, 240),
  };
}

export function mailOf(raw: Raw): MailSummary & { text: string } {
  return { ...summaryOf(raw), text: text(raw.texto) };
}
