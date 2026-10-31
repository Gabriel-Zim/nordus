import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, Download, LoaderCircle, Paperclip, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { api, type Bot } from "@/state/store";
import { Select } from "../Select";

interface MailAttachment { n: number; name: string; type: string; size: number }
interface MailSummary {
  id: string;
  address: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  at: string;
  read: boolean;
  attachments: MailAttachment[];
  preview: string;
}
type Mail = MailSummary & { text: string };

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return bytes > 0 ? `${bytes} B` : "";
}

/** Plain-text mail arrives hard-wrapped near 72 columns; long lines are joined so paragraphs flow, lists and blank lines stay. */
export function readableMailText(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").trim().split("\n")) {
    const previous = out.at(-1);
    const joins = previous !== undefined && previous.trim() !== "" && line.trim() !== ""
      && previous.length >= 50 && !/^\s*([-*•>]|\d+[.)])\s/u.test(line);
    if (joins) out[out.length - 1] = `${previous.trimEnd()} ${line.trimStart()}`;
    else out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

const attachmentUrl = (botId: string, mailId: string, n: number) =>
  `/api/bots/${encodeURIComponent(botId)}/emails/${encodeURIComponent(mailId)}/attachments/${n}`;

/** The bot's address and how many unread mails it has, for the profile; null while it loads. */
export function useBotMailbox(botId: string | null): { addresses: string[]; unread: number } | null {
  const [state, setState] = useState<{ addresses: string[]; unread: number } | null>(null);
  useEffect(() => {
    if (!botId) return;
    let active = true;
    void api<{ addresses: string[]; emails: MailSummary[] }>(`/api/bots/${encodeURIComponent(botId)}/emails?nao_lidos=1`)
      .then((result) => { if (active) setState({ addresses: result.addresses, unread: result.emails.filter((mail) => !mail.read).length }); })
      .catch(() => { if (active) setState({ addresses: [], unread: 0 }); });
    return () => { active = false; };
  }, [botId]);
  return state;
}

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-email-address={address}
      onClick={() => void copyText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1_400); })}
      className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[13px] text-ink hover:bg-white/[0.08]"
      title={t("emails.copy")}
    >
      <span className="min-w-0 truncate">{address}</span>
      {copied ? <Check size={13} className="shrink-0 text-success" aria-hidden="true" /> : <Copy size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />}
      <span className="sr-only">{copied ? t("emails.copied") : t("emails.copy")}</span>
    </button>
  );
}

interface MailboxChoice { id: string; addresses: string[] }

/** Which mailbox this bot reads. Chosen here, saved on the server; nothing is guessed from the bot's name. */
function MailboxPicker({ botId, current, choices, onChange }: {
  botId: string;
  current: string | null;
  choices: MailboxChoice[];
  onChange: () => void;
}) {
  const [saving, setSaving] = useState(false);
  if (choices.length === 0) return null;
  const choose = async (value: string) => {
    setSaving(true);
    try {
      await api(`/api/bots/${encodeURIComponent(botId)}/emails/mailbox`, { method: "PUT", body: JSON.stringify({ mailbox: value || null }) });
      onChange();
    } finally {
      setSaving(false);
    }
  };
  return (
    <label data-email-mailbox className="flex items-center justify-between gap-3 text-[12.5px] text-ink-secondary">
      <span>{t("emails.mailbox")}</span>
      <Select
        value={current ?? ""}
        disabled={saving}
        onChange={(event) => void choose(event.target.value)}
        aria-label={t("emails.mailbox")}
        size="sm"
        className="max-w-[16rem]"
      >
        <option value="">{t("emails.mailboxNone")}</option>
        {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.addresses.join(", ")}</option>)}
      </Select>
    </label>
  );
}

/** The bot's own inbox: its address, the mail it got, and each one opened for reading. */
export function EmailsTab({ bot }: { bot: Bot }) {
  const [addresses, setAddresses] = useState<string[] | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [choices, setChoices] = useState<MailboxChoice[]>([]);
  const [emails, setEmails] = useState<MailSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Mail | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    try {
      const params = new URLSearchParams(search.trim() ? { busca: search.trim() } : {});
      const result = await api<{ addresses: string[]; emails: MailSummary[]; error?: string; mailbox?: string | null; mailboxes?: MailboxChoice[] }>(`/api/bots/${encodeURIComponent(bot.id)}/emails?${params}`);
      setAddresses(result.addresses);
      setMailbox(result.mailbox ?? null);
      setChoices(result.mailboxes ?? []);
      setEmails(result.emails);
      setError(result.error ?? null);
    } catch {
      setAddresses((current) => current ?? []);
      setError(t("emails.failed"));
    }
  }, [bot.id]);

  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const openMail = async (summary: MailSummary) => {
    setOpening(summary.id);
    try {
      const result = await api<{ email: Mail }>(`/api/bots/${encodeURIComponent(bot.id)}/emails/${encodeURIComponent(summary.id)}`);
      setOpen(result.email);
      if (!summary.read) {
        setEmails((current) => current.map((item) => item.id === summary.id ? { ...item, read: true } : item));
        void api(`/api/bots/${encodeURIComponent(bot.id)}/emails/${encodeURIComponent(summary.id)}/read`, { method: "POST" }).catch(() => undefined);
      }
    } catch {
      setError(t("emails.failed"));
    } finally {
      setOpening(null);
    }
  };

  if (addresses === null) {
    return <div className="flex justify-center py-10"><LoaderCircle size={16} className="animate-spin text-ink-secondary" aria-label={t("common.checking")} /></div>;
  }
  if (addresses.length === 0) {
    return (
      <div className="flex flex-col gap-4 py-6">
        <p data-emails-none="" className="text-center text-[13px] text-ink-secondary">{t("emails.noAddress")}</p>
        <MailboxPicker botId={bot.id} current={mailbox} choices={choices} onChange={() => void load(query)} />
      </div>
    );
  }

  if (open) {
    const images = open.attachments.filter((item) => item.type.startsWith("image/") && item.type !== "image/svg+xml");
    const files = open.attachments.filter((item) => !images.includes(item));
    return (
      <article data-email-open={open.id} className="flex flex-col gap-3">
        <button type="button" onClick={() => setOpen(null)} className="flex items-center gap-1.5 self-start rounded-full px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-white/[0.06] hover:text-ink">
          <ArrowLeft size={14} aria-hidden="true" /> {t("emails.inbox")}
        </button>
        <h3 className="text-[16px] font-semibold leading-snug text-ink">{open.subject || t("emails.noSubject")}</h3>
        <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.07] pb-3">
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium text-ink">{open.fromName ?? open.fromEmail}</div>
            {open.fromName && <div className="truncate text-[12px] text-ink-secondary">{open.fromEmail}</div>}
          </div>
          <time className="shrink-0 text-[12px] text-ink-tertiary" dateTime={open.at}>{new Date(open.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</time>
        </div>
        <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{readableMailText(open.text) || open.preview}</div>
        {images.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {images.map((item) => (
              <a key={item.n} href={attachmentUrl(bot.id, open.id, item.n)} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-[12px] border border-white/10 bg-white/[0.03]" title={item.name}>
                <img src={attachmentUrl(bot.id, open.id, item.n)} alt={item.name} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              </a>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {files.map((item) => (
              <a key={item.n} href={attachmentUrl(bot.id, open.id, item.n)} download={item.name} className="flex items-center gap-2.5 rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2 hover:bg-white/[0.06]">
                <Paperclip size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.name}</span>
                <span className="shrink-0 text-[11.5px] text-ink-tertiary">{sizeLabel(item.size)}</span>
                <Download size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {addresses.map((address) => <CopyAddress key={address} address={address} />)}
      </div>
      <label className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
        <Search size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("emails.search")}
          aria-label={t("emails.search")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
      </label>
      {error && <p role="alert" className="text-[12.5px] text-danger/80">{error}</p>}
      {emails.length === 0 && !error ? (
        <p className="py-8 text-center text-[13px] text-ink-secondary">{query ? t("emails.noMatch") : t("emails.empty")}</p>
      ) : (
        <div className="flex flex-col divide-y divide-white/[0.06] overflow-hidden rounded-[14px] border border-white/[0.07] bg-white/[0.02]">
          {emails.map((mail) => (
            <button
              key={mail.id}
              type="button"
              data-email={mail.id}
              disabled={opening !== null}
              onClick={() => void openMail(mail)}
              className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.04] disabled:cursor-wait"
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", mail.read ? "bg-transparent" : "bg-unread")} aria-label={mail.read ? undefined : t("emails.unread")} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-[13.5px] text-ink", !mail.read && "font-semibold")}>{mail.fromName ?? mail.fromEmail}</span>
                  {mail.attachments.length > 0 && <Paperclip size={12} className="shrink-0 text-ink-tertiary" aria-label={t("emails.hasAttachments")} />}
                  <span className="shrink-0 text-[11.5px] text-ink-tertiary">{opening === mail.id ? <LoaderCircle size={12} className="animate-spin" /> : when(mail.at)}</span>
                </span>
                <span className={cn("block truncate text-[13px]", mail.read ? "text-ink-secondary" : "text-ink")}>{mail.subject || t("emails.noSubject")}</span>
                <span className="block truncate text-[12px] text-ink-tertiary">{mail.preview}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <MailboxPicker botId={bot.id} current={mailbox} choices={choices} onChange={() => void load(query)} />
    </div>
  );
}
