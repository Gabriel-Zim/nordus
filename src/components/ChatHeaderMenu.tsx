import { useState } from "react";
import { Bug, Copy, Download, Gauge, LifeBuoy, ListChecks, Monitor, MoreHorizontal, Search } from "lucide-react";

import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { usageSummary } from "@/lib/chat-usage-summary";
import { useStore, type Bot, type Message } from "@/state/store";
import {
  copyTranscriptToClipboard,
  downloadMarkdownTranscript,
  formatTranscriptMarkdown,
  slugifyTranscriptFilename,
} from "@/lib/export-transcript";
import { SIDEBAR_INLINE, useMediaQuery } from "@/lib/use-media-query";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { cn } from "@/lib/cn";
import { ProblemReportDialog } from "./lazy-screens";
import { ShortcutHint } from "./ShortcutHint";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";

export function ChatHeaderMenu({ bot, messages, findOpen, onFind }: {
  bot: Bot;
  messages: readonly Message[];
  findOpen: boolean;
  onFind: () => void;
}) {
  const { state, dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const usage = usageSummary(bot, state.instances);
  const advanced = useAdvancedMode();
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);
  const [reporting, setReporting] = useState(false);
  const canReport = useOwnerOrAdmin() === true;
  const hasMessages = messages.length > 0;
  // On a phone the header keeps only the name and this menu, as on iOS: the computer moves in here.
  const phone = !useMediaQuery(SIDEBAR_INLINE, true);
  const transcript = () => formatTranscriptMarkdown({ title: bot.name, messages, botName: bot.name, isGroup: false });
  const items: SidebarMenuItem[] = [
    ...(phone ? [{
      key: "computer",
      label: t("chat.computer"),
      icon: <Monitor size={16} />,
      active: state.computerOpen,
      onSelect: () => dispatch({ type: "toggleComputer" }),
    } satisfies SidebarMenuItem] : []),
    {
      key: "find",
      separatorBefore: phone,
      label: t("chat.find"),
      icon: <Search size={16} />,
      active: findOpen,
      trailing: <ShortcutHint id="find-conversation" />,
      onSelect: onFind,
    },
    {
      key: "copy",
      heading: t("chat.export.heading"),
      separatorBefore: true,
      label: t("chat.export.copy"),
      icon: <Copy size={16} />,
      disabled: !hasMessages,
      keepOpen: true,
      trailing: copyStatus && <span role="status" className="text-[11px] text-ink-secondary">{t(copyStatus === "copied" ? "chat.export.copied" : "chat.export.copyFailed")}</span>,
      onSelect: () => { void copyTranscriptToClipboard(transcript()).then((ok) => setCopyStatus(ok ? "copied" : "failed")); },
    },
    {
      key: "download",
      label: t("chat.export.download"),
      icon: <Download size={16} />,
      disabled: !hasMessages,
      onSelect: () => downloadMarkdownTranscript(slugifyTranscriptFilename(bot.name), transcript()),
    },
    ...(usage ? [{
      key: "usage",
      label: t("chat.usage.menu"),
      icon: <Gauge size={16} />,
      separatorBefore: true,
      trailing: <span title={usage.detail} data-testid="usage-chip" className={cn("tabular-nums text-[12px]", usage.tone === "danger" ? "text-danger" : usage.tone === "warning" ? "text-warning" : "text-ink-secondary")}>{usage.short}</span>,
      onSelect: () => dispatch({ type: "toggleSettings", open: true, section: "usage" }),
    } satisfies SidebarMenuItem] : []),
    ...(remoteClient ? [] : [{
      key: "activity",
      label: t("activity.title"),
      icon: <ListChecks size={16} />,
      active: state.activityOpen,
      separatorBefore: !usage,
      onSelect: () => dispatch({ type: "toggleActivity" }),
    } satisfies SidebarMenuItem, {
      key: "inspector",
      label: t("chat.inspector"),
      icon: <Bug size={16} />,
      active: advanced && state.inspectorOpen,
      disabled: !advanced,
      heading: !advanced ? t("chat.advancedOnly") : undefined,
      separatorBefore: true,
      onSelect: () => dispatch({ type: "toggleInspector" }),
    } satisfies SidebarMenuItem]),
    ...(canReport ? [{
      key: "report",
      label: t("report.menu"),
      icon: <LifeBuoy size={16} />,
      separatorBefore: true,
      onSelect: () => setReporting(true),
    } satisfies SidebarMenuItem] : []),
  ];
  return (
    <>
      {reporting && <ProblemReportDialog threadId={bot.threadId} onClose={() => setReporting(false)} />}
      <SidebarPopoverMenu
        items={items}
        ariaLabel={t("chat.more")}
        placement="below"
        renderTrigger={({ open }) => (
          <span
            data-testid="chat-more"
            data-preload="activity inspector computer bot-settings"
            className={cn(
              "flex rounded-md p-1.5 hover:bg-raised",
              open || findOpen || state.inspectorOpen || state.activityOpen ? "text-accent" : "text-ink-secondary hover:text-ink",
            )}
            title={t("chat.more")}
          >
            <MoreHorizontal size={18} />
          </span>
        )}
      />
    </>
  );
}
