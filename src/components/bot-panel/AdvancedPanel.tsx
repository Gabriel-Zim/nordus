import { useState } from "react";
import { ChevronRight, KeyRound, ListChecks, Mail, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { membersOf } from "@/lib/team-members";
import { t } from "@/lib/i18n";
import type { BotOverview } from "@/lib/bot-overview-types";
import { firstSentence } from "@/lib/soul";
import { useStore, type Bot } from "@/state/store";
import type { ApprovalMode } from "../../../shared/approval-mode";
import type { ReplyStyle } from "../../../shared/reply-style";
import { approvalModeOptionsFor } from "../ApprovalModeSelector";
import { LocalComputerAutoWarning } from "../LocalComputerAutoWarning";
import { SoulField } from "../SoulField";
import { useBotMailbox } from "../bot-settings/EmailsTab";
import { useBotApps } from "../bot-settings/useBotApps";
import type { BotPatch, useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { AppsCard } from "./apps-and-logins";
import type { PageId, PanelTarget } from "./page-registry";
import { SettingsTab } from "./SettingsTab";
import { buttonCls, Card, ColRow, LinkRow, NavRow, rowCls, Segmented, SegmentedRow } from "./rows";

type Derived = ReturnType<typeof useBotSettingsDerived>;

/**
 * Everything the Details tab keeps behind its "Advanced" disclosure: finishing setup, the bot's instructions and reply
 * style, what it asks before acting, its apps, the vault, its mailbox and team, and every other setting. It mounts only
 * when the disclosure is open, so what it loads (apps, the mailbox) is read only then.
 */
export function AdvancedPanel({ bot, derived, overview, slackUrl, query, onQuery, onOpen, onGo }: {
  bot: Bot;
  derived: Derived;
  overview: BotOverview | null;
  slackUrl: string | null;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (page: PageId) => void;
  onGo: (target: PanelTarget) => void;
}) {
  const { state, dispatch } = useStore();
  const [editingSoul, setEditingSoul] = useState(false);
  const [localAutoWarning, setLocalAutoWarning] = useState<{ botId: string; patch: BotPatch } | null>(null);
  const apps = useBotApps(bot);
  const mailbox = useBotMailbox(bot.id);
  const { patch, approvalMode, engine, trustedModesAvailable } = derived;

  // Antigravity's old Auto still executes as Ask: show that without changing the saved mode or granting Full.
  const displayedApprovalMode = engine?.driverKind === "antigravityAgent" && approvalMode === "auto" ? "ask" : approvalMode;
  const autoOffered = approvalModeOptionsFor(engine?.driverKind ?? "", trustedModesAvailable)
    .some((option) => option.mode === "auto");
  const chooseMode = (mode: Extract<ApprovalMode, "ask" | "auto" | "full">) => {
    if (bot.busy || mode === approvalMode) return;
    if (mode === "full") {
      dispatch({ type: "updateBot", botId: bot.id, patch: { approvalMode: "full", applyToAllThreads: true } });
      return;
    }
    if (mode === "auto" && bot.computer === "local") {
      setLocalAutoWarning({ botId: bot.id, patch: { approvalMode: "auto", acknowledgeLocalAuto: true } });
      return;
    }
    patch({ approvalMode: mode });
  };
  const customMode = displayedApprovalMode === "edits" || displayedApprovalMode === "custom";
  const actsHint = customMode
    ? <span data-approval-custom>{t("botSettings.simple.customMode")}</span>
    : t(displayedApprovalMode === "auto" ? "botSettings.simple.decideHint"
      : displayedApprovalMode === "full" ? "botSettings.simple.fullHint" : "botSettings.simple.askHint");

  const soulOpen = editingSoul || Boolean(bot.soulDrift);
  const setupLeft = (overview?.setup ?? []).filter((step) => !step.done).length;
  const members = membersOf(state.bots, bot).length;
  const mailHint = mailbox === null ? t("common.checking")
    : mailbox.addresses.length === 0 ? t("emails.noAddress")
      : mailbox.unread > 0 ? t("botSettings.simple.emailUnread", { count: mailbox.unread }) : t("botSettings.simple.emailNoUnread");

  return (
    <div data-panel-advanced>
      {setupLeft > 0 && (
        <Card anchor="setup">
          <NavRow
            data-panel-page="setup"
            icon={ListChecks}
            title={t("botPanel.finishSetup")}
            hint={t("botPanel.finishSetupHint", { count: setupLeft, name: bot.name })}
            onClick={() => onOpen("setup")}
          />
        </Card>
      )}

      <Card label={t("botSettings.simple.instructions")} anchor="instructions">
        {soulOpen ? (
          <ColRow data-panel-row="soul">
            <SoulField
              bot={bot}
              onPatch={patch}
              simple={{
                label: t("botSettings.simple.instructions"),
                placeholder: t("botSettings.simple.instructionsPlaceholder", { name: bot.name }),
              }}
            />
            {editingSoul && (
              <div className="flex justify-end">
                <button type="button" data-panel-done="soul" onClick={() => setEditingSoul(false)} className={buttonCls}>
                  {t("botSettings.simple.done")}
                </button>
              </div>
            )}
          </ColRow>
        ) : (
          <button
            type="button"
            data-panel-edit="soul"
            aria-label={`${t("botSettings.simple.edit")}: ${t("botSettings.simple.instructions")}`}
            onClick={() => setEditingSoul(true)}
            className={cn(rowCls, "w-full text-left hover:bg-ink/[0.03]")}
          >
            <span className={cn("line-clamp-2 min-w-0 flex-1 text-[13px]", bot.soul?.trim() ? "text-ink" : "text-ink-secondary")}>
              {firstSentence(bot.soul ?? "") || t("botSettings.simple.noInstructions")}
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[13.5px] text-ink">
              {t("botSettings.simple.edit")}
              <ChevronRight size={14} aria-hidden="true" />
            </span>
          </button>
        )}
        <SegmentedRow
          attr="data-reply-style-choice"
          title={t("botSettings.replyStyle.title")}
          label={t("botSettings.replyStyle.title")}
          value={bot.replyStyle ?? "default"}
          onChange={(replyStyle: ReplyStyle) => patch({ replyStyle })}
          options={[
            { value: "default", label: t("botSettings.replyStyle.default"), tooltip: t("botSettings.replyStyle.defaultHint") },
            { value: "conversational", label: t("botSettings.replyStyle.conversational"), tooltip: t("botSettings.replyStyle.conversationalHint") },
          ]}
        />
        <LinkRow data-panel-link="instructions" onClick={() => onOpen("instructions")}>{t("botPanel.soulAndVersions")}</LinkRow>
      </Card>

      <Card label={t("botSettings.simple.beforeActs", { name: bot.name })} anchor="approval">
        <ColRow data-panel-row="approval">
          <Segmented
            attr="data-approval-choice"
            label={t("botSettings.simple.beforeActs", { name: bot.name })}
            value={displayedApprovalMode}
            onChange={chooseMode}
            options={[
              { value: "ask", label: t("botSettings.simple.ask"), tooltip: t("botSettings.simple.askHint"), disabled: Boolean(bot.busy) },
              { value: "auto", label: t("botSettings.simple.decide"), tooltip: t("botSettings.simple.decideHint"), disabled: Boolean(bot.busy) || !autoOffered },
              { value: "full", label: t("botSettings.simple.full"), tooltip: t("botSettings.simple.fullHint"), disabled: Boolean(bot.busy) },
            ]}
          />
          <div className="mx-0.5 text-[12.5px] leading-[1.35] text-ink-secondary">{actsHint}</div>
        </ColRow>
        <LinkRow data-panel-link="approvals" onClick={() => onOpen("approvals")}>{t("botPanel.moreApprovals")}</LinkRow>
      </Card>

      <AppsCard bot={bot} derived={derived} apps={apps} onOpenAccess={() => onOpen("apps")} />

      <Card anchor="vault">
        <NavRow data-panel-page="vault" icon={KeyRound} title={t("botSettings.simple.vault")} hint={t("botSettings.simple.vaultIntro", { name: bot.name })} onClick={() => onOpen("vault")} />
        <NavRow data-panel-page="emails" icon={Mail} title={t("botSettings.simple.emails")} hint={mailHint} onClick={() => onOpen("emails")} />
        {members > 0 && (
          <NavRow data-panel-page="members" icon={Users} title={t("botSettings.simple.team")} value={members} onClick={() => onOpen("members")} />
        )}
      </Card>

      <SettingsTab bot={bot} derived={derived} slackUrl={slackUrl} query={query} onQuery={onQuery} onOpen={onOpen} onGo={onGo} />

      <LocalComputerAutoWarning
        open={localAutoWarning !== null}
        onCancel={() => setLocalAutoWarning(null)}
        onConfirm={() => {
          const target = localAutoWarning;
          setLocalAutoWarning(null);
          if (!target) return;
          dispatch({ type: "updateBot", botId: target.botId, patch: target.patch });
        }}
      />
    </div>
  );
}
