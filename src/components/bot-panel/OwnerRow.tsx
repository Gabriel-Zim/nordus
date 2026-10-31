import { t } from "@/lib/i18n";
import { personNamed } from "@/state/people-directory";
import type { Bot } from "@/state/store";
import { OwnerPicker, type useOwnerRow } from "../bot-settings/OwnerPicker";
import { ColRow, ItemRow } from "./rows";

/** "Responsável" in the Sharing card: a picker for admins, the name for everyone else. The caller leaves it out when `mode` is "none". */
export function OwnerRow({ bot, owner }: { bot: Bot; owner: ReturnType<typeof useOwnerRow> }) {
  if (owner.mode === "read") {
    return <ItemRow data-panel-row="owner" title={t("people.owner.row", { name: personNamed(owner.people, bot.owner) })} hint={t("people.owner.hint")} />;
  }
  return (
    <ColRow data-panel-row="owner">
      <div>
        <div className="text-[13.5px] font-medium text-ink">{t("people.owner.title")}</div>
        <div className="mt-px text-[12.5px] leading-[1.35] text-ink-secondary">{t("people.owner.hint")}</div>
      </div>
      <OwnerPicker bot={bot} choices={owner.choices} />
    </ColRow>
  );
}
