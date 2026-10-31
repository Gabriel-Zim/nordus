import { activeLocale, t } from "@/lib/i18n";
import type { OptionCardData } from "@/state/store";

export interface OutboundCall {
  app: string | null;
  label: string;
}

const SUMMARY_GROUPS = 3;

/** Per call, `App · Label` then its JSON arguments; JSON.stringify never writes a raw newline. */
export function parseOutboundCalls(subtitle: string): OutboundCall[] {
  const calls: OutboundCall[] = [];
  for (const block of subtitle.split("\n\n")) {
    const heading = (block.split("\n")[0] ?? "").trim();
    if (!heading) return [];
    const at = heading.indexOf(" · ");
    if (at < 0) {
      calls.push({ app: null, label: heading });
      continue;
    }
    const app = heading.slice(0, at).trim();
    const label = heading.slice(at + " · ".length).trim();
    if (!app || !label) return [];
    calls.push({ app, label });
  }
  return calls;
}

export function outboundCalls(card: Pick<OptionCardData, "outboundRequest" | "subtitle">): OutboundCall[] {
  if (!card.outboundRequest) return [];
  const calls = card.outboundRequest.calls;
  if (calls && calls.length > 0) return calls;
  return parseOutboundCalls(card.subtitle);
}

export function outboundApp(calls: OutboundCall[]): string | null {
  if (calls.length === 0 || calls.some((call) => !call.app)) return null;
  const apps = new Set(calls.map((call) => call.app));
  return apps.size === 1 ? calls[0]!.app : null;
}

export function collapseOutboundCalls(calls: OutboundCall[], namingApps: boolean): string {
  const order: OutboundCall[] = [];
  const counts = new Map<string, number>();
  for (const call of calls) {
    const key = JSON.stringify([call.app, call.label]);
    if (!counts.has(key)) order.push(call);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = order.slice(0, SUMMARY_GROUPS).map((call) => {
    const name = namingApps && call.app ? `${call.app} · ${call.label}` : call.label;
    const count = counts.get(JSON.stringify([call.app, call.label])) ?? 1;
    return count > 1 ? `${name} ×${count}` : name;
  });
  const line = parts.join(", ");
  const hidden = order.length - parts.length;
  return hidden > 0 ? `${line}, ${t("approval.outbound.more", { count: hidden })}` : line;
}

const TARGET_KEY = /"(?:account|brand|client|cliente|profile|page|channel|workspace)(?:Name|_name)?"\s*:\s*"([^"\\]{2,60})"/i;
const AMOUNT_KEY = /"(?:amount|valor|price|total|budget|cost)"\s*:\s*"?(\d+(?:[.,]\d+)?)"?/i;
const CURRENCY_KEY = /"(?:currency|moeda)"\s*:\s*"([A-Za-z]{3})"/i;

export interface OutboundFacts {
  target?: string;
  amount?: string;
}

/** Whose account the held call goes to and what it charges, read from its arguments; an amount counts only with its currency. */
export function outboundFacts(card: Pick<OptionCardData, "outboundRequest" | "subtitle">, locale?: string): OutboundFacts {
  if (!card.outboundRequest) return {};
  let target: string | undefined;
  let currency: string | undefined;
  let total = 0;
  let counted = 0;
  for (const block of card.subtitle.split("\n\n")) {
    target ??= TARGET_KEY.exec(block)?.[1]?.trim();
    const amount = AMOUNT_KEY.exec(block)?.[1];
    const code = CURRENCY_KEY.exec(block)?.[1]?.toUpperCase();
    if (!amount || !code || (currency && currency !== code)) continue;
    currency = code;
    total += Number(amount.replace(",", "."));
    counted += 1;
  }
  const facts: OutboundFacts = {};
  if (target) facts.target = target;
  if (currency && counted > 0 && Number.isFinite(total)) {
    try {
      facts.amount = new Intl.NumberFormat(locale ?? activeLocale(), { style: "currency", currency }).format(total).replace(/\u00a0/g, " ");
    } catch {
    }
  }
  return facts;
}

export interface OutboundSummary {
  headline: string;
  summary: string;
  opaque?: true;
}

const OPAQUE_TOOL = "COMPOSIO_PROXY_EXECUTE";

export function outboundSummary(card: Pick<OptionCardData, "outboundRequest" | "subtitle">): OutboundSummary | undefined {
  if (!card.outboundRequest) return undefined;
  const calls = outboundCalls(card);
  const app = outboundApp(calls);
  if (card.outboundRequest.tool === OPAQUE_TOOL) {
    return {
      headline: t("approval.outbound.runCode", { app: app ?? card.outboundRequest.app ?? "Composio" }),
      summary: "",
      opaque: true,
    };
  }
  return {
    headline: app ? t("approval.outbound.sendTo", { app }) : t("approval.outbound.sendOnBehalf"),
    summary: collapseOutboundCalls(calls, app === null),
  };
}

/** Composio names its tools TOOLKIT_ACTION_WORDS, all upper case. */
const COMPOSIO_TOOL = /^[A-Z][A-Z0-9]+_([A-Z0-9_]+)$/;

export function composioActionPhrase(tool: string): string | undefined {
  const match = COMPOSIO_TOOL.exec(tool);
  if (!match) return undefined;
  return match[1]!.replace(/_+/g, " ").trim().toLowerCase() || undefined;
}

/** A lesson card's one line: a client's rule reads "Regra da LUMON: …", as the server titles it, so the person sees
 * which ficha it goes to; a bot's own lesson is the lesson itself. */
export function lessonLine(card: Pick<OptionCardData, "lessonRequest" | "subtitle">): string {
  if (!card.lessonRequest) return "";
  const { lesson, client } = card.lessonRequest;
  return client ? `Regra da ${client.toUpperCase()}: ${lesson}` : lesson;
}
