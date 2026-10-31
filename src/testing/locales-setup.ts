// The app loads languages on demand and falls back to Brazilian Portuguese; tests keep every pack in memory and
// English as the fallback, so setLocale() is synchronous and the assertions read the same as before.
import { en, locales } from "@/locales";

(globalThis as { __nordusLocales?: unknown }).__nordusLocales = { packs: locales, fallback: en };
