import { t } from "@/lib/i18n";
import { readyBotTryAsking } from "@/lib/ready-bots";

const SECTION_HEADING = /^#{1,4}\s*.*(respons|tarefa|faz|fazer|serviç|servic|skills?|capacidade|duties|tasks|does|handles)/i;
const ANY_HEADING = /^#{1,4}\s/;
const BULLET = /^\s*[-*]\s+(.+?)\s*$/;
const MAX_ITEM = 90;
const MIN_ITEM = 8;

function bulletsFromSoul(soul: string): string[] {
  const found: string[] = [];
  let inSection = false;
  for (const line of soul.split("\n")) {
    if (ANY_HEADING.test(line)) {
      inSection = SECTION_HEADING.test(line);
      continue;
    }
    const bullet = inSection ? BULLET.exec(line)?.[1] : undefined;
    if (!bullet) continue;
    const plain = bullet.replace(/[*_`]/g, "").replace(/[.;:]+$/, "").trim();
    if (plain.length >= MIN_ITEM && plain.length <= MAX_ITEM) found.push(plain);
  }
  return found;
}

/** Three requests a person can start from: a gallery bot's own first jobs, else the duties its SOUL lists, else its role. */
export function starterRequests(bot: { title?: string; soul?: string }): string[] {
  const ready = readyBotTryAsking(bot.soul);
  if (ready.length) return ready.slice(0, 3);
  const requests = bulletsFromSoul(bot.soul ?? "").slice(0, 3).map((item) => t("chat.starter.help", { item: item.charAt(0).toLowerCase() + item.slice(1) }));
  const role = bot.title?.trim();
  const fillers = [
    t("chat.starter.about"),
    role ? t("chat.starter.role", { role }) : t("chat.starter.pending"),
    t("chat.starter.week"),
  ];
  for (const filler of fillers) {
    if (requests.length >= 3) break;
    requests.push(filler);
  }
  return requests;
}
