// A password or code the person types into the sign-in card goes through the server straight into the page the bot's
// browser shows, and only on the site the card names. The bot, the model and the conversation never get the value.
import { randomBytes } from "node:crypto";

import { loginPageCheck, loginSite } from "../shared/logins.ts";
import { scrubHeldSecrets } from "../shared/redact.ts";
import type { SecretHold } from "./browser-secret-hold.ts";
import { SECRET_HOLD_MS } from "./login-fill.ts";

export type CardSecretKind = "password" | "code";

export interface CardSecretDeps {
  engine(args: string[]): Promise<Record<string, unknown> | null>;
  insertText(text: string): Promise<void>;
  press(key: string): Promise<void>;
  remember(value: string, kind: CardSecretKind): void;
}

export type CardSecretPage =
  | { ok: true; pageHost: string; field: CardSecretKind | null }
  | { ok: false; error: string };

export type CardSecretSent =
  | { ok: true; pageHost: string; kind: CardSecretKind; held: SecretHold }
  | { ok: false; error: string };

const MARK = "data-nordus-card-secret";
export const MAX_CARD_SECRET = 1024;

const FIND_FIELD = `((nonce, focus) => {
  const visible = (el) => {
    if (!(el instanceof Element) || !el.isConnected || el.getClientRects().length === 0) return false;
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
    }
    return true;
  };
  const usable = (el) => el instanceof HTMLInputElement && !el.disabled && !el.readOnly && el.type !== "hidden" && visible(el);
  const hint = (el) => [el.name, el.id, el.getAttribute("aria-label"), el.placeholder, el.getAttribute("autocomplete")].join(" ").toLowerCase();
  const tokens = (el) => (el.getAttribute("autocomplete") || "").toLowerCase().split(/\\s+/);
  const CODE = /(?:^|[^a-z])t?otp|2fa|mfa|two[-_ ]?factor|one[-_ ]?time|verif|security[-_ ]?code|passcode|\\bcode\\b/;
  const NOT_CODE = /zip|postal|promo|coupon|country|area|invite|referr/;
  const isCode = (el) => tokens(el).includes("one-time-code") || (CODE.test(hint(el)) && !NOT_CODE.test(hint(el)) && ["text", "tel", "number", "password"].includes(el.type));
  const isPassword = (el) => el.type === "password" && !isCode(el) && !tokens(el).includes("new-password");
  const kindOf = (el) => (isCode(el) ? "code" : isPassword(el) ? "password" : null);
  for (const old of document.querySelectorAll("[${MARK}]")) old.removeAttribute("${MARK}");
  const inputs = Array.from(document.querySelectorAll("input")).filter(usable);
  const active = document.activeElement;
  let target = inputs.includes(active) && kindOf(active) ? active : null;
  target = target || inputs.find((el) => isPassword(el) && tokens(el).includes("current-password")) || inputs.find(isPassword) || inputs.find(isCode) || null;
  if (!target) return JSON.stringify({ href: location.href, field: null, focused: false });
  if (focus) {
    target.setAttribute("${MARK}", nonce);
    try { target.scrollIntoView({ block: "center" }); } catch {}
    target.focus();
    if (target.value) { target.select(); }
  }
  return JSON.stringify({ href: location.href, field: kindOf(target), focused: focus && document.activeElement === target });
})`;

const CLEAR_FIELD = `((nonce) => {
  for (const el of document.querySelectorAll("[${MARK}]")) {
    if (el.getAttribute("${MARK}") !== nonce || !(el instanceof HTMLInputElement)) continue;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(el, ""); else el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.removeAttribute("${MARK}");
  }
  return "{}";
})`;

function call(script: string, ...args: unknown[]): string {
  return `${script}(${args.map((arg) => JSON.stringify(arg ?? null)).join(", ")})`;
}

function evaluated(data: Record<string, unknown> | null): Record<string, unknown> | null {
  let value: unknown = data?.result;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The page is the card's own site, and no other open tab is on that site. Fails closed when the tabs cannot be read. */
async function checkSite(deps: Pick<CardSecretDeps, "engine">, cardHost: string): Promise<{ ok: true; pageHost: string } | { ok: false; error: string }> {
  const page = await deps.engine(["get", "url"]).catch(() => null);
  const pageUrl = typeof page?.url === "string" ? page.url : "";
  if (!pageUrl || pageUrl === "about:blank") return { ok: false, error: "O navegador não está numa página de entrada. Peça para o robô abrir o site primeiro." };
  const check = loginPageCheck(pageUrl);
  if (!check.ok) return { ok: false, error: check.reason === "insecure" ? "Esta página não é segura (http), então nada é digitado nela." : "A página aberta não é uma página da web." };
  if (loginSite(check.pageHost) !== loginSite(cardHost)) {
    return { ok: false, error: `A página aberta é ${check.pageHost}, não ${loginSite(cardHost)}. Nada foi digitado.` };
  }
  const listed = await deps.engine(["tab", "list"]).catch(() => null);
  const tabs = Array.isArray(listed?.tabs) ? listed.tabs as unknown[] : null;
  if (!tabs) return { ok: false, error: "Não consegui conferir as abas abertas. Nada foi digitado." };
  const onSite = tabs.filter((tab) => {
    const url = tab && typeof tab === "object" ? (tab as { url?: unknown }).url : null;
    const seen = typeof url === "string" ? loginPageCheck(url) : null;
    return seen?.ok === true && loginSite(seen.pageHost) === loginSite(cardHost);
  });
  if (onSite.length > 1) return { ok: false, error: `Há mais de uma aba aberta em ${loginSite(cardHost)}. Feche as outras e tente de novo.` };
  return { ok: true, pageHost: check.pageHost };
}

/** What the page asks for now, without touching it. */
export async function inspectCardPage(deps: Pick<CardSecretDeps, "engine">, cardHost: string): Promise<CardSecretPage> {
  const site = await checkSite(deps, cardHost);
  if (!site.ok) return site;
  const field = evaluated(await deps.engine(["eval", call(FIND_FIELD, "", false)]).catch(() => null));
  const kind = field?.field === "password" || field?.field === "code" ? field.field : null;
  return { ok: true, pageHost: site.pageHost, field: kind };
}

/** Types the value into the page's password or code box and sends it. The value is never returned or logged. */
export async function typeCardSecret(deps: CardSecretDeps, cardHost: string, value: unknown): Promise<CardSecretSent> {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_CARD_SECRET) return { ok: false, error: "Digite o valor antes de enviar." };
  const site = await checkSite(deps, cardHost);
  if (!site.ok) return site;
  const nonce = randomBytes(12).toString("hex");
  const field = evaluated(await deps.engine(["eval", call(FIND_FIELD, nonce, true)]).catch(() => null));
  const href = typeof field?.href === "string" ? field.href : "";
  const still = loginPageCheck(href);
  if (!still.ok || loginSite(still.pageHost) !== loginSite(cardHost)) return { ok: false, error: "A página mudou de site antes de digitar. Nada foi digitado." };
  const kind = field?.field === "password" || field?.field === "code" ? field.field : null;
  if (!kind || field?.focused !== true) return { ok: false, error: "A página não está pedindo senha nem código agora. Nada foi digitado." };
  deps.remember(value, kind);
  const held: SecretHold = {
    url: href,
    ms: SECRET_HOLD_MS,
    clear: async () => { await deps.engine(["eval", call(CLEAR_FIELD, nonce)]).catch(() => null); },
  };
  try {
    await deps.insertText(value);
    await deps.press("Enter");
  } catch (error) {
    await held.clear?.();
    return { ok: false, error: scrubHeldSecrets(error instanceof Error ? error.message : String(error)) };
  }
  return { ok: true, pageHost: still.pageHost, kind, held };
}
