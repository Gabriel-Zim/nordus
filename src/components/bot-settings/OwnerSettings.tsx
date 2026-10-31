import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { requestNotificationPermission } from "@/lib/notify";
import type { Bot } from "@/state/store";
import { useCaptionChrome } from "../DesktopCapabilities";
import { Card, ColRow, SwitchRow } from "../bot-panel/rows";
import { IdentitySection } from "./IdentitySection";
import { OwnerBudget } from "./OwnerBudget";
import { SoulSection } from "./SoulSection";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";

/** What the person an agent answers to may change: how it looks and what it is told, its everyday switches and its monthly limit. */
export function OwnerSettings({ bot, derived, headerClassName, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  headerClassName?: string;
  onClose: () => void;
}) {
  const { dragProps } = useCaptionChrome();
  const { patch } = derived;
  return (
    <div data-owner-settings="" className="flex min-h-0 flex-1 flex-col">
      <div {...dragProps} className={cn("flex h-[52px] shrink-0 items-center justify-between gap-2 px-5", headerClassName)}>
        <span id="bot-settings-title" className="truncate text-[15px] font-semibold text-ink">{bot.name}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("botSettings.simple.close")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink hover:bg-ink/[0.11]"
        >
          <X size={16} className="pointer-events-none" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-7">
        <p className="text-[13px] leading-relaxed text-ink-secondary">{t("people.owner.mine", { name: bot.name })}</p>
        <Card label={t("botPanel.card.profile")} anchor="profile">
          <ColRow data-panel-row="identity">
            <IdentitySection
              bot={bot}
              patch={patch}
              activeState={derived.activeState}
              mascotMotion={derived.mascotMotion}
              parts={["avatar", "name", "title", "blurb"]}
            />
          </ColRow>
        </Card>
        <Card label={t("people.owner.instructions")} anchor="instructions">
          <ColRow data-panel-row="soul">
            <SoulSection bot={bot} patch={patch} />
          </ColRow>
        </Card>
        <Card label={t("people.owner.everyday")} anchor="everyday">
          <SwitchRow
            data-panel-row="notify"
            title={t("notifications.title")}
            hint={t("botPanel.notificationsHint")}
            color={bot.color}
            checked={bot.notifications}
            onChange={() => {
              const enabled = !bot.notifications;
              if (enabled) void requestNotificationPermission();
              patch({ notifications: enabled });
            }}
          />
          <SwitchRow
            data-panel-row="memory"
            title={t("profile.knows.title")}
            hint={t(bot.memoryEnabled === false ? "profile.knows.off" : "profile.knows.on")}
            color={bot.color}
            checked={bot.memoryEnabled !== false}
            onChange={() => patch({ memoryEnabled: bot.memoryEnabled === false })}
          />
          <SwitchRow
            data-panel-row="voice-notes"
            title={t("voice.notes")}
            hint={t("voice.notesHelp")}
            color={bot.color}
            checked={bot.voiceNotes !== false}
            onChange={() => patch({ voiceNotes: bot.voiceNotes === false })}
          />
        </Card>
        <Card label={t("people.owner.budgetTitle")} anchor="budget">
          <ColRow data-panel-row="budget">
            <OwnerBudget bot={bot} />
          </ColRow>
        </Card>
      </div>
    </div>
  );
}
