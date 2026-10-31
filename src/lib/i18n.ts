import ptBr from "@/locales/pt-br.json";
import { LOCALE_PACK_CODE, localeChoices, type LocaleKey, type LocalePack } from "@/locales/choices";
import { loadLocalePack } from "@/locales/load";

/** Nordus opens in Brazilian Portuguese whatever the browser says; a language chosen in Settings still wins. */
export const DEFAULT_LOCALE = "pt-br";

type Seam = { packs: Record<string, LocalePack>; fallback: Record<string, string | undefined> };
const seam = (globalThis as { __nordusLocales?: Seam }).__nordusLocales;
const packs: Record<string, LocalePack> = seam ? seam.packs : { "pt-br": ptBr, pt: ptBr };
const fallbackPack = (seam?.fallback ?? ptBr) as Record<string, string | undefined>;
const available = (): ReadonlySet<string> => new Set([...Object.keys(LOCALE_PACK_CODE), ...Object.keys(packs)]);

export function resolveLocale(tag: string | undefined, available: ReadonlySet<string>): string {
  if (!tag) return "en";
  let candidate = tag.toLowerCase();
  while (candidate) {
    if (available.has(candidate)) return candidate;
    const separator = candidate.lastIndexOf("-");
    if (separator < 0) break;
    candidate = candidate.slice(0, separator);
  }
  return "en";
}

const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

export function setLocale(tag: string | undefined): string {
  const resolved = resolveLocale(tag, available());
  const loaded = packs[resolved];
  active = resolved;
  // A pack not fetched yet shows the fallback until it lands, then the screen redraws.
  if (loaded) activePack = loaded;
  else void loadLocale(resolved);
  // Screen readers choose pronunciation from <html lang>, and index.html ships "en".
  const root = typeof document === "undefined" ? undefined : document?.documentElement;
  if (root) {
    root.lang = documentLanguage(resolved);
    root.dir = RTL_LANGUAGES.has(root.lang.split("-")[0]!) ? "rtl" : "ltr";
  }
  return resolved;
}

export function documentLanguage(code: string): string {
  const canonical = LOCALE_PACK_CODE[code];
  const shown = (canonical && localeChoices.find((choice) => choice.code === canonical)?.code) || code;
  return shown
    .split("-")
    .map((part, index) =>
      index === 0 ? part.toLowerCase()
        : part.length === 2 ? part.toUpperCase()
          : part.length === 4 ? part[0]!.toUpperCase() + part.slice(1).toLowerCase()
            : part.toLowerCase())
    .join("-");
}

/** React cannot see the module variable t() reads, so memoized subtrees take this as a prop. */
export function activeLocale(): string {
  return active;
}

let active = "en";
let activePack: LocalePack = fallbackPack;
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();

/** Fetches a language pack (a no-op once loaded). Resolves when it is usable; a failure leaves the fallback in place. */
export function loadLocale(tag: string | undefined): Promise<void> {
  const resolved = resolveLocale(tag, available());
  if (packs[resolved]) return Promise.resolve();
  const file = LOCALE_PACK_CODE[resolved];
  if (!file) return Promise.resolve();
  const pending = loading.get(file) ?? loadLocalePack(file).then((pack) => {
    for (const [code, canonical] of Object.entries(LOCALE_PACK_CODE)) if (canonical === file) packs[code] = pack;
  }).finally(() => loading.delete(file));
  loading.set(file, pending);
  return pending.then(() => {
    if (active !== resolved || !packs[resolved] || activePack === packs[resolved]) return;
    activePack = packs[resolved]!;
    for (const listener of listeners) listener();
  }, (error: unknown) => {
    console.warn(`[i18n] language ${resolved} could not be loaded; keeping the previous one.`, error);
  });
}

/** Called after a pack that was loading becomes the one t() reads. */
export function onLocaleLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let missedKey = false;

export function extendFallback(extra: Record<string, string>): void {
  Object.assign(fallbackPack, extra);
  if (!missedKey) return;
  missedKey = false;
  for (const listener of listeners) listener();
}

let restLoad: Promise<unknown> | undefined;

export function loadRestOfCatalog(): Promise<unknown> {
  return (restLoad ??= import("virtual:nordus-catalog-rest").catch((error: unknown) => {
    restLoad = undefined;
    console.warn("[i18n] the rest of the catalog could not be loaded.", error);
  }));
}

export function hasLocaleKey(key: string): boolean {
  return Object.hasOwn(fallbackPack, key);
}

setLocale(import.meta.env?.MODE === "test" ? globalThis.navigator?.language : DEFAULT_LOCALE);

export function tFromServer(key: string | undefined, fallback: string | undefined): string | undefined {
  return key && hasLocaleKey(key) ? t(key as LocaleKey) : fallback;
}

export function waitingOnLabel(waitingOn: readonly { name: string; onPerson?: boolean }[] | undefined, fallback: string, preview = false): string {
  const first = waitingOn?.[0];
  if (!first) return fallback;
  const more = waitingOn.length - 1;
  const params = { name: first.name, count: more };
  if (first.onPerson) {
    if (preview) return more > 0 ? t("sidebar.preview.waitingOnPersonMore", params) : t("sidebar.preview.waitingOnPerson", params);
    return more > 0 ? t("task.waitingOnPersonMore", params) : t("task.waitingOnPerson", params);
  }
  if (preview) return more > 0 ? t("sidebar.preview.waitingOnNamedMore", params) : t("sidebar.preview.waitingOnNamed", params);
  return more > 0 ? t("task.waitingOnNamedMore", params) : t("task.waitingOnNamed", params);
}

export function t(key: LocaleKey, params?: Record<string, string | number>): string {
  let template = activePack[key] ?? fallbackPack[key];
  if (template === undefined) {
    missedKey = true;
    if (import.meta.env?.PROD) void loadRestOfCatalog();
    template = key;
  }
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
