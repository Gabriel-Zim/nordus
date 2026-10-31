// Everything at once: for tests and tooling only. The app imports choices.ts, load.ts and pt-br.json instead,
// so the other languages stay out of the main bundle.
import en from "./en.json";
import de from "./de.json";
import es from "./es.json";
import fr from "./fr.json";
import hi from "./hi.json";
import ja from "./ja.json";
import ptBr from "./pt-br.json";
import zh from "./zh.json";
import zhTw from "./zh-tw.json";
import uk from "./uk.json";
import vi from "./vi.json";
import tr from "./tr.json";
import type { LocalePack } from "./choices";

export { en };
export { localeChoices } from "./choices";
export type { LocaleKey, LocalePack } from "./choices";

export const locales: Record<string, LocalePack> = {
  en,
  de,
  es,
  fr,
  hi,
  ja,
  pt: ptBr,
  "pt-br": ptBr,
  zh,
  "zh-hant": zhTw,
  "zh-hk": zhTw,
  "zh-mo": zhTw,
  "zh-tw": zhTw,
  uk,
  vi,
  tr,
};
