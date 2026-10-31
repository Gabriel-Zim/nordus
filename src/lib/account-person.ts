// Nordus: a conta aparece pelo nome da pessoa ("Conta: Jordan"), nunca pelo motor nem pela instância.
import { t } from "@/lib/i18n";

const BRASILIA_ZONE = "America/Sao_Paulo";

type AccountLike = { displayName: string; snapshot?: { account?: { email?: string } } };

const ENGINE = /^(?:claude(?:\s+code)?|codex|chat\s?gpt|openai|grok|gemini|antigravity|cursor|open\s?code(?:\s+go)?)\b/i;
const GENERIC = /^(?:code|edit|max|pro|plus|plan|plano|team|conta|account|default|padr[aã]o|\d+)$/i;

/** "Claude (Jordan)", "Claude · Jordan" e "Claude Jordan" viram "Jordan"; só "Claude" vira o e-mail da conta. */
export function accountPersonName(account: AccountLike): string {
  const shown = account.displayName.trim();
  const inside = /\(([^()]+)\)\s*$/.exec(shown)?.[1]?.trim();
  if (inside && !GENERIC.test(inside)) return inside;
  const rest = shown.replace(ENGINE, "").replace(/^[\s·:|/–—-]+/, "").replace(/\s*\([^()]*\)\s*$/, "").trim();
  if (rest && !GENERIC.test(rest)) return rest;
  const email = account.snapshot?.account?.email?.trim();
  return email || shown;
}

const parts = (at: number) => Object.fromEntries(new Intl.DateTimeFormat("pt-BR", {
  timeZone: BRASILIA_ZONE, year: "numeric", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
}).formatToParts(new Date(at)).map((part) => [part.type, part.value]));

/** "15h40", "9h": o jeito de falar a hora. */
export function spokenHour(at: number): string {
  const p = parts(at);
  const hour = String(Number(p.hour === "24" ? "0" : p.hour));
  return p.minute === "00" ? `${hour}h` : `${hour}h${p.minute}`;
}

/** "Volta às 15h40, a fila espera.": a frase de quando a conta no limite volta, no relógio de Brasília. */
export function accountBackPhrase(resetsAt: number | string | null | undefined, now: number): string | null {
  const at = typeof resetsAt === "string" ? Date.parse(resetsAt) : resetsAt;
  if (at == null || !Number.isFinite(at) || at <= now) return null;
  const day = (value: number) => { const p = parts(value); return `${p.year}-${p.month}-${p.day}`; };
  const when = day(at) === day(now) ? `às ${spokenHour(at)}`
    : day(at) === day(now + 86_400_000) ? `amanhã às ${spokenHour(at)}`
      : `em ${parts(at).day}/${parts(at).month} às ${spokenHour(at)}`;
  return `Volta ${when}, a fila espera.`;
}

/** "Conta: Jordan": the account as a person sees it. */
export function accountText(account: AccountLike): string {
  return `${t("model.account")}: ${accountPersonName(account)}`;
}
