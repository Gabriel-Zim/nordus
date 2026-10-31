import { t } from "@/lib/i18n";

/** The server titles a question card in English; the chat shows it in the person's language. */
export function cardTitle(title: string, botName?: string): string {
  if (title === "Your bot has a question") return botName ? t("question.card.named", { name: botName }) : t("question.card.title");
  if (title === "Approval needed" || title === "Local computer approval") return t("approval.card.needed");
  return title;
}
