import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { useBotApps } from "../bot-settings/useBotApps";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { AppsCard, BrowserLogins } from "./apps-and-logins";
import type { PageId } from "./page-registry";
import { NoteRow, Card } from "./rows";
import { useOpenComputer } from "./ComputerTab";

/**
 * The vault: what the bot is allowed to use, in one place. Connected apps (each with its own switch) and the sign-ins its
 * browser keeps. It only gets what is switched on here.
 */
export function VaultTab({ bot, derived, onOpen }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onOpen: (page: PageId) => void;
}) {
  const apps = useBotApps(bot);
  const openComputer = useOpenComputer(bot);
  return (
    <div data-panel-vault>
      <Card>
        <NoteRow>{t("botSettings.simple.vaultIntro", { name: bot.name })}</NoteRow>
      </Card>
      <AppsCard bot={bot} derived={derived} apps={apps} onOpenAccess={() => onOpen("apps")} />
      <BrowserLogins bot={bot} browserEnabled={derived.browserEnabled} onOpenBrowser={() => openComputer("browser")} />
    </div>
  );
}
