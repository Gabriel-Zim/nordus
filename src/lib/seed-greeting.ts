import { t } from "@/lib/i18n";

const GREETING = /^Hi, I'm (.+)\. What would you like me to do\?$/;

/** A new bot's first message is the server's standard hello in English. It reads as the bot's own hello when it has one,
 *  else the standard one in the person's language, always with the name the bot has now (it may have been renamed). */
export function localizedGreeting(text: string, bot?: { name: string; greeting?: string }): string {
  const match = GREETING.exec(text.trim());
  if (!match) return text;
  const own = bot?.greeting?.trim();
  if (own) return own;
  return t("chat.greeting", { name: bot?.name || match[1]! });
}
