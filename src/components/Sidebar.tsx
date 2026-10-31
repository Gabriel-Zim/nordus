import { track } from "@/lib/analytics";
import { OrganizationIdentity } from "./OrganizationIdentity";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Archive,
  BellDot,
  Bot as BotIcon,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardCopy,
  Copy,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Library,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Pin,
  PinOff,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
  Star,
} from "lucide-react";
import { api, useStore, visibleMessages, currentTaskBot, botOpensTo, openBot, openThread, openWhereBotWaits, type Action, type AppState, type Bot, type BotProject, type Group, type InstanceInfo, type Message, type Task } from "@/state/store";
import { localizedTaskTitle } from "@/lib/task-title";
import { approvalModeFor } from "../../shared/approval-mode";
import { liveActivityLabel } from "@/lib/live-activity";
import { botStepNow } from "@/lib/work-steps";
import { llmThreadTitlesEnabled } from "@/lib/feature-flags";

import { BotAvatar } from "./Avatar";
import { StatusDot, type RoboSvg } from "./RoboAvatar";
import { engineDown, roboEstado, type RoboEstado } from "@/lib/robo-estado";
import { useVmStopped } from "@/lib/vm-stopped";
import { waveRobot } from "@/lib/robo-wave";
import { BotModelBadge, BotModelMark } from "./BotModelBadge";
import { cn } from "@/lib/cn";
import { searchMatchesThreads, useSearchDisclosure } from "@/lib/search-disclosure";
import { useHeldMenuMotion, useMenuMotion } from "./MenuMotion";
import { lastNonReceipt } from "@/lib/receipts";
import { botPreview, groupPreview } from "./sidebar-preview";
import { activeLocale, t, waitingOnLabel } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import type { LocaleKey } from "@/locales";
import { ConfirmDialog } from "./ConfirmDialog";
import { BulkSelectFilters, ThreadListFooter, deleteThreadsInBulk, useBulkSelect } from "./BulkSelectBar";
import { BotDeleteMenuItem, useDeleteAllThreads } from "./BotMenuDelete";
import { StackedCritters } from "./StackedCritters";
import { formatListDate } from "@/lib/list-date";
import { SidebarRailApproval, SidebarRailWaiting } from "./SidebarRailApproval";
import { useWaitingApproval } from "@/lib/use-waiting-approval";
import { SidebarRailCard, useRailCardTrigger } from "./SidebarRailCard";
import { botRailCard, roomRailCard } from "./sidebar-preview";
import { dividerRelease, effectiveSidebarDensity, isSidebarToggleShortcut, SIDEBAR_RAIL_WIDTH, SIDEBAR_RESIZE_HANDLE_CLASS } from "@/lib/sidebar-rail";
import { SIDEBAR_INLINE, useMediaQuery } from "@/lib/use-media-query";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { WorkingDots } from "./WorkingIndicator";
import { nextRename } from "@/lib/rename";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { MIN_QUERY, SearchResults } from "./SearchResults";
import { SkeletonRows } from "./Skeleton";
import { NewTaskFolderDialog, SidebarNewChatPanel, TeamDialog, TeamLibraryPanel } from "./lazy-screens";
import { openCommandPalette } from "./CommandPalette";
import { commandPaletteKeys } from "@/lib/keyboard-shortcuts";
import { ShareTeamDialog } from "./lazy-screens";
import { TeamSettingsDialog } from "./lazy-screens";
import { RenameTitle } from "./RenameTitle";
import { BotPickerList } from "./BotPickerList";
import { BotProjectDialog, FolderActions, FolderIcon, navigateThreadMenu } from "./BotProjects";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { draggedFolder, FOLDER_DRAG_TYPE, moveFolder, placeFolder } from "@/lib/folder-order";
import { botUnreadThreadIds, folderUnreadThreadIds, markBotRead, markFolderRead } from "@/lib/folder-read";
import { HelperThreadGroup, orderedThreadList, partitionHelperThreads, SidebarThreadRow, stampClock, threadRecency, useRelativeNow, useRevealedThreadRow, useSnoozeExpiry, visibleSidebarThreads } from "./SidebarThreadRow";
import {
  loadCollapsedSections,
  loadSectionOrder,
  loadSidebarAttentionPinned,
  loadSidebarWidth,
  clampSidebarWidth,
  saveCollapsedSections,
  saveSectionOrder,
  saveSidebarAttentionPinned,
  saveSidebarWidth,
  setSidebarDensity,
  toggleCollapsedSection,
  useSidebarDensity,
  usePinnedCircles,
  useUniversalPins,
  type SidebarDensity,
} from "@/lib/sidebar-preferences";
import {
  ATTENTION_SECTION_ID,
  BOT_CHATS_SECTION_ID,
  BOTS_SECTION_ID,
  CHANNELS_SECTION_ID,
  PINNED_SECTION_ID,
  PINNED_THREADS_SECTION_ID,
  TOOLS_SECTION_ID,
  mergeSectionOrder,
  moveSection,
  orderedSidebarSections,
  partitionSidebarBots,
  partitionSidebarGroups,
  placeSection,
  pinnedCircleThreadListVisible,
  sameSectionOrder,
  sidebarLayoutInteractive,
  sidebarSectionCollapsed,
  sidebarSectionLabel,
  userSectionId,
  userSectionName,
  type SectionDropPlace,
} from "@/lib/sidebar-layout";
import { sidebarSectionAttention } from "@/lib/sidebar-attention";
import { botListItemPointerIntent } from "@/lib/sidebar-selection";
import { phoneSettingsAction, SidebarPhoneButton } from "./SidebarPhoneButton";
import { SidebarAppsButton, SidebarBoardNav, SidebarFooterNav, SidebarSettingsButton, SidebarTodayNav, SidebarToolsMenu } from "./SidebarFooterNav";
import { SidebarInboxNav } from "./SidebarInboxNav";
import { NotificationsHeaderButton } from "./NotificationsHeaderButton";
import { GlassBar, GlassScrollFrame, GlassScroller } from "./GlassScrollFrame";
import { DesktopWorkspaceSwitcher } from "./DesktopWorkspaceSwitcher";
import { useCloudOwner } from "./CloudOwner";
import { SidebarProfileMenu } from "./SidebarProfileMenu";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { useShowThreads } from "@/lib/thread-preferences";
import { botShowsUnread } from "@/lib/bot-unread";
import { attentionForPerson, botWait, leadersWithWaitingMember, ledMemberIds } from "@/lib/team-members";
import { sidebarFlatItems } from "@/lib/sidebar-order";
import { attentionHasRunningWork, attentionJumpAction, attentionTriggerLabel, attentionUnpinAction, AttentionThreadRows, crossBotAttentionThreads, crossBotPinnedThreads, SidebarBotActivity, sidebarBotActivityTasks, botWorkingIn } from "./SidebarBotActivity";
import { needsYouEntries } from "./NeedsYouPanel";
import { SidebarAttentionPanel } from "./SidebarAttentionPanel";
import { SidebarPinnedThreadsPanel } from "./SidebarPinnedThreadsPanel";
import { useLiveMedia } from "@/lib/live-call-media";
import { LiveCallPill, liveBadgeFor } from "./LiveCallPill";
import { BotTagPicker, botTagMenuItem } from "./TagPicker";
import { ShortcutHint } from "./ShortcutHint";
import { roomThreadSpeakerId, roomThreadWorking } from "@/lib/room-threads";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { useAdvancedMode } from "@/lib/interface-mode";
import { PinnedBotRoster, PinnedCircleThreadSection } from "./PinnedCircleThreads";
import { archiveBotWithNotice, onArchiveNotice } from "./bot-archive";
import { ArchivedBotsPanel, botConfirmCopy, type BotConfirmKind } from "./ArchivedBotsPanel";
import { NewRoomWho } from "./people/NewRoomWho";
import { DirectMessagesBlock } from "./people/DirectMessagesBlock";
import { useGuest } from "@/lib/use-viewer";
import { OPEN_TO_EVERYONE, type NewRoomPeople } from "@/lib/room-people";

export { PinnedBotCircle, PinnedCircleThreadPanel, PinnedCircleThreadSection } from "./PinnedCircleThreads";
export { ArchivedBotRow, ArchivedBotsPanel, archivedDeleteAllCopy, botConfirmCopy, type BotConfirmKind } from "./ArchivedBotsPanel";

/** Coupled to electron/window-chrome.mjs: trafficLightPosition.y = 16 and 14px-tall buttons. */
export const MAC_TRAFFIC_LIGHT_CENTER_Y = 23;

const SECTION_LABEL_KEYS: Record<string, LocaleKey> = {
  [PINNED_SECTION_ID]: "sidebar.section.pinned",
  [CHANNELS_SECTION_ID]: "sidebar.section.channels",
  [BOT_CHATS_SECTION_ID]: "sidebar.section.botChats",
  [BOTS_SECTION_ID]: "sidebar.section.bots",
};

function sectionLabel(id: string): string {
  const key = SECTION_LABEL_KEYS[id];
  return key ? t(key) : sidebarSectionLabel(id);
}

interface MenuState {
  botId: string;
  x: number;
  y: number;
}

function openBotContextMenu(onMenu: (menu: MenuState) => void, botId: string, event: React.MouseEvent) {
  event.preventDefault();
  onMenu({ botId, x: event.clientX, y: event.clientY });
}

export function GroupListItem({
  group,
  density,
  quiet = false,
  query = "",
  onMenu,
  flat = false,
  waiting = false,
}: {
  group: Group;
  density: SidebarDensity;
  quiet?: boolean;
  query?: string;
  onMenu: (menu: { groupId: string; x: number; y: number }) => void;
  /** Someone in the room waits on the person; the avatar rail shows it as its state dot. */
  waiting?: boolean;
  /** Nordus list: only the room's own row, no conversations under it, no chevron and no "new conversation". */
  flat?: boolean;
}) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const selected = state.activeView === "chat" && state.selectedId === group.id;
  const [threadsOpen, setThreadsOpen] = useSearchDisclosure(`group:${group.id}`, query ?? "", searchMatchesThreads(query ?? "", group.tasks), selected);
  const wasSelected = useRef(selected);
  useEffect(() => {
    if (selected && !wasSelected.current) setThreadsOpen(true);
    wasSelected.current = selected;
  }, [selected]);
  const hasThreadList = (group.tasks?.length ?? 1) > 1 || Boolean(query);
  const expanded = !flat && !group.dm && threadsOpen && density !== "icons" && hasThreadList;
  const groupStatus = Boolean(group.busyBotId) || Boolean(group.working);
  const roomBusy = groupStatus;
  const members = group.memberIds
    .map((id) => state.bots.find((b) => b.id === id))
    .filter((b): b is Bot => Boolean(b));
  const iconOnly = density === "icons";
  const rail = useRailCardTrigger(iconOnly);
  const estado = roboEstado({ waiting, working: groupStatus });
  return (
    <>
    <div className={cn("group relative", !iconOnly && "mb-1")}>
    <button
      data-sidebar-group-row={group.id}
      data-preload="group"
      {...rail.triggerProps}
      aria-current={selected && !expanded ? "page" : undefined}
      onClick={() => dispatch({ type: "select", id: group.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ groupId: group.id, x: e.clientX, y: e.clientY });
      }}
      // The ContextMenu key's native event carries no useful coordinates.
      onKeyDown={(e) => {
        if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onMenu({ groupId: group.id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      className={cn(
        // Nordus: a room row is shaped exactly like a bot row, so the one list reads evenly.
        "relative flex w-full items-center rounded-xl text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-accent/60",
        density === "icons" ? "justify-center px-1 py-1.5" : density === "compact" ? "gap-2.5 py-1.5 pl-2 pr-9" : "gap-3 py-2 pl-2.5 pr-9",
        selected && !expanded ? "bg-raised" : "hover:bg-raised/50",
      )}
      aria-label={iconOnly ? group.name : undefined}
    >
      {iconOnly ? (
        <span className="relative flex shrink-0">
          <StackedCritters members={members} density={density} />
          <StatusDot estado={estado} className="absolute right-0.5 bottom-0.5 ring-2 ring-panel" />
        </span>
      ) : <StackedCritters members={members} density={density} px={density === "compact" ? 40 : 48} />}
      <div className={cn("min-w-0 flex-1", density === "icons" && "hidden")}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="nb-name truncate text-[15px] text-ink">{group.name}</span>
          {(expanded || (quiet && !groupStatus)) && group.unread && <span className="size-1.5 shrink-0 rounded-full bg-unread" aria-label={t("task.unreadMany")} />}
        </div>
        {!expanded && (!quiet || groupStatus) && <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12px] leading-[16px] text-ink-tertiary">{groupPreview(group, state.bots, state.instances, advanced)}</span>
          {group.unread && <span className="size-2 shrink-0 rounded-full bg-unread" />}
        </div>}
      </div>
      {density === "icons" && group.unread && (
        <span className="absolute bottom-1.5 right-1.5 size-2 rounded-full border border-panel bg-unread" />
      )}
    </button>
    {rail.anchor && <SidebarRailCard
      anchor={rail.anchor}
      data={roomRailCard(group, state.bots, state.instances, advanced, { waiting, working: groupStatus, unread: Boolean(group.unread) })}
      avatar={<StackedCritters members={members} density="compact" px={28} />}
      {...rail.cardProps}
    />}
    {!flat && !group.dm && density !== "icons" && hasThreadList && <button type="button" aria-label={t(expanded ? "task.collapseNamed" : "task.expandNamed", { name: group.name })} aria-expanded={expanded}
      onClick={() => setThreadsOpen((open) => !open)} className="absolute left-0.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-secondary outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60">
      <ChevronRight aria-hidden="true" size={12} className={cn("transition-transform", expanded && "rotate-90")} />
    </button>}
    {!flat && !group.dm && density !== "icons" && <button type="button" disabled={roomBusy} aria-label={t("task.newShort")} title={t(roomBusy ? "task.newBusy" : "task.newShort")}
      onClick={() => { setThreadsOpen(true); dispatch({ type: "newGroupTask", groupId: group.id }); }}
      className="pointer-events-none absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary opacity-0 hover:bg-raised hover:text-ink disabled:opacity-40 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70 touch:disabled:opacity-40"><Plus size={14} /></button>}
    </div>
    {expanded && <GroupThreadList group={group} selected={selected} density={density} query={group.name.toLowerCase().includes(query.toLowerCase()) ? "" : query} />}
    </>
  );
}

export function GroupThreadList({ group, selected, density = "comfortable", query = "" }: { group: Group; selected: boolean; density?: SidebarDensity; query?: string }) {
  const { state, dispatch } = useStore();
  const now = useRelativeNow();
  const [showAll, setShowAll] = useState(false);
  const tasks = (group.tasks ?? [{ threadId: group.threadId, title: group.name, createdAt: group.createdAt }]).map((task) => {
    const speakerId = roomThreadSpeakerId(group, task.threadId);
    const waiting = Boolean(speakerId) && state.bots.find((bot) => bot.id === speakerId)?.activity === "waiting-on-you";
    return {
      ...task, busy: roomThreadWorking(group, task.threadId), unread: task.threadId === group.threadId && group.unread,
      activity: waiting ? "waiting-on-you" as const : undefined,
    };
  });
  const bulk = useBulkSelect();
  const visible = orderedThreadList(visibleSidebarThreads(tasks, group.threadId, query, [], showAll || bulk.active));
  const selection = bulk.forRows(visible);
  useRevealedThreadRow(state.revealThread, selected ? group.threadId : null);
  const latest = useRef(group);
  latest.current = group;
  const groupId = group.id;
  const actions = useMemo(() => ({
    onSelect: (task: { threadId: string }) => {
      if (task.threadId !== latest.current.threadId) dispatch({ type: "switchGroupTask", groupId, threadId: task.threadId });
      else dispatch({ type: "select", id: groupId });
    },
    onRename: (task: { threadId: string }, title: string) => dispatch({ type: "renameGroupTask", groupId, threadId: task.threadId, title }),
    onDelete: (task: { threadId: string }) => dispatch({ type: "deleteGroupTask", groupId, threadId: task.threadId }),
    onPin: (task: { threadId: string; title: string }, pinned: boolean) => dispatch({ type: "pinGroupTask", groupId, threadId: task.threadId, pinned, title: task.title }),
  }), [groupId, dispatch]);
  const locale = activeLocale();
  return <div className="mb-2 space-y-0.5" role="group" aria-label={t("task.namedList", { name: group.name })}>
    {bulk.active && <BulkSelectFilters rows={visible} selected={selection} now={now} onChange={bulk.setSelected} onDone={bulk.finish} />}
    {visible.map((task) => <SidebarThreadRow key={task.threadId} task={task} ownerId={group.id} current={selected && task.threadId === group.threadId} compact={density === "compact"}
      now={stampClock(threadRecency(task), now)} locale={locale} {...actions} selectMode={bulk.active} checked={selection.has(task.threadId)} onToggleSelect={bulk.toggle} />)}
    <ThreadListFooter bulk={bulk} rows={visible} selected={selection} total={tasks.length} canShowAll={!query && !showAll && tasks.length > visible.length} canSelect={tasks.length > 1 && !group.dm}
      onShowAll={() => setShowAll(true)} maxDeletable={tasks.length - 1} freshConversation={false} onDelete={(threadIds) => deleteThreadsInBulk({ groupId }, threadIds, dispatch)} />
  </div>;
}

export function roomDeleteCopy(group: Pick<Group, "name" | "dm">) {
  const isBotChat = Boolean(group.dm);
  return {
    title: t("sidebar.room.deleteConfirmTitle", { name: group.name }),
    body: isBotChat
      ? t("sidebar.room.deleteChatBody", { name: group.name })
      : t("sidebar.room.deleteChannelBody", { name: group.name }),
    confirmLabel: isBotChat ? t("sidebar.room.deleteChat") : t("sidebar.room.deleteChannel"),
    tone: "danger" as const,
  };
}

function RoomContextMenu({
  menu,
  onClose,
  onMoveToSection,
  onDelete,
}: {
  menu: { groupId: string; x: number; y: number } | null;
  onClose: () => void;
  onMoveToSection: (groupId: string) => void;
  onDelete: (groupId: string) => void;
}) {
  const motion = useHeldMenuMotion(menu);
  const shown = motion.value;
  const { state, dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const group = shown ? state.groups.find((g) => g.id === shown.groupId) : undefined;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(group?.name ?? "");

  useEffect(() => {
    if (!menu) return;
    setDraft(state.groups.find((g) => g.id === menu.groupId)?.name ?? "");
    setRenaming(false);
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-room-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!motion.shown || !group || !shown) return null;
  const isBotChat = Boolean(group.dm);
  const saveRename = () => {
    const name = nextRename(group.name, draft);
    if (name) dispatch({ type: "patchGroup", groupId: group.id, patch: { name } });
    onClose();
  };
  const top = Math.min(shown.y, window.innerHeight - 204);
  const left = Math.min(shown.x, window.innerWidth - 240);
  return createPortal(
    <div
      data-room-menu
      data-sidebar
      style={{ top, left }}
      className={cn("fixed z-40 w-[228px] overflow-hidden rounded-xl border border-hairline/50 bg-menu py-1.5 shadow-2xl shadow-black/60", motion.className)} {...motion.exitProps}
    >
      {!remoteClient && (renaming ? (
        <div className="flex items-center gap-1 px-2 py-1">
          <input
            autoFocus
            value={draft}
            maxLength={100}
            aria-label={t("sidebar.room.renameAria", { name: group.name })}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                saveRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="min-w-0 flex-1 rounded-lg bg-raised px-2 py-1.5 text-[14px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={saveRename}
            aria-label={isBotChat ? t("sidebar.room.saveChatName") : t("sidebar.room.saveChannelName")}
            title={t("common.save")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={isBotChat ? t("sidebar.room.cancelChatRename") : t("sidebar.room.cancelChannelRename")}
            title={t("common.cancel")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(group.name);
            setRenaming(true);
          }}
          className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
        >
          <Pencil size={16} className="text-ink-secondary" />
          {isBotChat ? t("sidebar.room.renameChat") : t("sidebar.room.renameChannel")}
        </button>
      ))}
      {!remoteClient && !isBotChat && (
        <button
          onClick={() => {
            onClose();
            onMoveToSection(group.id);
          }}
          className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
        >
          <FolderPlus size={16} className="text-ink-secondary" />
          {t("sidebar.section.moveToContext")}
        </button>
      )}
      <button
        onClick={() => {
          void copyText(group.threadId);
          onClose();
        }}
        className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
      >
        <ClipboardCopy size={16} className="text-ink-secondary" />
        {t("sidebar.copyConversationId")}
      </button>
      {!remoteClient && <button
        onClick={() => {
          onClose();
          onDelete(group.id);
        }}
        className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-danger hover:bg-raised/70"
      >
        <Trash2 size={16} />
        {isBotChat ? t("sidebar.room.deleteChat") : t("sidebar.room.deleteChannel")}
      </button>}
    </div>,
    document.body,
  );
}

function NewRoomPanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [who, setWho] = useState<NewRoomPeople>(OPEN_TO_EVERYONE);
  const bots = state.bots.filter((b) => !b.hidden);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const create = () => {
    if (!picked.size || !who.ready) return;
    dispatch({
      type: "createGroup",
      memberIds: [...picked],
      name: name.trim() || undefined,
      section: section.trim() || undefined,
      people: who.people,
    });
    track("room_created", { members: picked.size, context: Boolean(section.trim()) });
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[90vh] w-[340px] overflow-y-auto rounded-2xl border border-hairline/50 bg-card p-4 shadow-2xl">
        <div className="mb-3 text-[15px] font-semibold text-ink">{t("sidebar.newChannel.title")}</div>
        <input
          autoFocus
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("sidebar.newChannel.name")}
          className="mb-3 w-full rounded-lg bg-raised/70 px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <input
          value={section}
          maxLength={60}
          onChange={(e) => setSection(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("sidebar.newChannel.context")}
          aria-label={t("sidebar.newChannel.contextAria")}
          className="mb-3 w-full rounded-lg bg-raised/70 px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <BotPickerList
          bots={bots}
          picked={picked}
          onToggle={toggle}
          emptyHint={t("sidebar.newChannel.emptyHint")}
        />
        <NewRoomWho onChange={setWho} />
        <button
          onClick={create}
          disabled={!picked.size || !who.ready}
          className="mt-3 w-full rounded-lg bg-accent py-2 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {picked.size === 0
            ? t("sidebar.newChannel.create")
            : picked.size === 1
              ? t("sidebar.newChannel.createOne")
              : t("sidebar.newChannel.createMany", { count: picked.size })}
        </button>
      </div>
    </div>
  );
}

function SectionPicker({
  current,
  anchor,
  onClose,
  onAssign,
}: {
  current: string | undefined;
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  onAssign: (section: string) => void;
}) {
  const { state } = useStore();
  const [name, setName] = useState("");
  const motion = useHeldMenuMotion(anchor);
  const shown = motion.value;
  const heldCurrent = useRef(current);
  if (anchor) heldCurrent.current = current;
  const trimmed = name.trim();

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-section-picker]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [anchor, onClose]);

  const sections = [
    ...new Set([
      ...(state.sections ?? []),
      ...state.bots.filter((b) => !b.hidden && b.section).map((b) => b.section!),
      ...state.groups.filter((g) => g.section).map((g) => g.section!),
    ]),
  ];

  const assign = (section: string) => {
    onAssign(section);
    onClose();
  };

  if (!motion.shown || !shown) return null;
  const sectionCurrent = heldCurrent.current;
  const top = Math.max(8, Math.min(shown.y, window.innerHeight - 300));
  const left = Math.min(shown.x, window.innerWidth - 260);

  return (
    <div
      data-section-picker
      style={{ top, left }}
      className={cn("fixed z-40 w-[236px] overflow-hidden rounded-xl border border-hairline/50 bg-menu py-2 shadow-2xl shadow-black/60", motion.className)} {...motion.exitProps}
    >
      <div className="px-3.5 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
        {t("sidebar.section.moveToContext")}
      </div>
      {sections.length > 0 && (
        <div className="flex flex-col gap-0.5 px-1.5 py-1">
          {sections.map((section) => (
            <button
              key={section}
              onClick={() => assign(section)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
                section === sectionCurrent ? "bg-raised text-ink" : "text-ink hover:bg-raised/70",
              )}
            >
              <span className="truncate">{section}</span>
              {section === sectionCurrent && <Check size={14} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-1.5 px-2.5 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed || trimmed.length > 60) return;
          assign(trimmed);
        }}
      >
        <input
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("sidebar.section.newContext")}
          aria-label={t("sidebar.section.newContextAria")}
          className="w-full rounded-lg bg-raised/70 px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <button
          type="submit"
          disabled={!trimmed || trimmed.length > 60}
          className={cn(
            "shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium",
            trimmed ? "bg-accent text-panel" : "bg-raised/70 text-ink-secondary",
          )}
        >
          {t("common.add")}
        </button>
      </form>
      {sectionCurrent && (
        <>
          <div className="mx-2 my-1 border-t border-hairline/40" />
          <button
            onClick={() => assign("")}
            className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] text-danger hover:bg-raised/70"
          >
            <FolderMinus size={15} />
            {t("sidebar.section.removeFromContext")}
          </button>
        </>
      )}
    </div>
  );
}

export function BotContextMenu({
  menu,
  onClose,
  onArchive,
  onDelete,
  onMoveToSection,
  onNewFolder,
  onNewTaskFolder,
}: {
  menu: MenuState | null;
  onClose: () => void;
  onArchive: (bot: Bot) => void;
  onDelete: (bot: Bot) => void;
  onMoveToSection: (botId: string) => void;
  onNewFolder: (botId: string) => void;
  onNewTaskFolder: (botId: string) => void;
}) {
  const motion = useHeldMenuMotion(menu);
  const shown = motion.value;
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const canChooseFolder = useOwnerOrAdmin();
  const clearThreads = useDeleteAllThreads();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const bot = shown ? state.bots.find((b) => b.id === shown.botId) : undefined;
  const menuRef = useRef<HTMLDivElement>(null);
  const latestMenu = useRef(menu);
  useLayoutEffect(() => { latestMenu.current = menu; }, [menu]);
  const readInFlight = useRef(false);
  const [readingBotId, setReadingBotId] = useState<string | null>(null);
  const [readError, setReadError] = useState<{ botId: string; message: string } | null>(null);
  useEffect(() => { setReadError(null); }, [menu?.botId]);
  const readAll = async (owner: Bot) => {
    if (readInFlight.current) return;
    readInFlight.current = true;
    setReadingBotId(owner.id);
    setReadError(null);
    const openedMenu = menu;
    try {
      await markBotRead(owner, api, (updated) => dispatch({ type: "botPatched", bot: updated }));
      if (latestMenu.current === openedMenu) onClose();
    } catch (error) {
      const guidance = t("sidebar.bot.markAllReadFailed");
      setReadError({ botId: owner.id, message: error instanceof Error ? `${guidance} ${error.message}` : guidance });
    } finally {
      readInFlight.current = false;
      setReadingBotId(null);
    }
  };
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !shown) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      element.style.top = `${Math.max(8, Math.min(shown.y, window.innerHeight - height - 8))}px`;
      element.style.left = `${Math.max(8, Math.min(shown.x, window.innerWidth - width - 8))}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
  // Kept apart from the listeners: onClose is fresh every render, and re-running this would pull focus back to the
  // first item.
  useEffect(() => {
    if (!menu) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-bot-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!motion.shown || !bot || !shown) return clearThreads.dialog;
  const deleting = state.deletingBots[bot.id] === true;
  const engine = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
  const canCoordinate = engine?.capabilities?.agentsMcp === true;
  const visibleBotCount = state.bots.filter((candidate) => !candidate.hidden).length;
  const archiveBlocked = Boolean(bot.chiefOfStaff) || visibleBotCount <= 1;
  const archiveHint = bot.chiefOfStaff
    ? t("sidebar.bot.archiveBlockedChief")
    : visibleBotCount <= 1
      ? t("sidebar.bot.archiveBlockedLast")
      : undefined;
  const openForSettings = () => {
    if (state.selectedId === bot.id) dispatch({ type: "select", id: bot.id });
    else openBot(dispatch, bot, showThreads);
  };
  const item = (
    icon: React.ReactNode,
    label: string,
    onClick?: () => void,
    opts?: { danger?: boolean; disabled?: boolean; hint?: string; keepOpen?: boolean },
  ) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      disabled={opts?.disabled}
      onClick={() => {
        onClick?.();
        if (!opts?.keepOpen) onClose();
      }}
      title={opts?.hint}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px]",
        opts?.danger ? "text-danger" : "text-ink",
        opts?.disabled ? "cursor-default opacity-40" : "hover:bg-raised/70",
      )}
    >
      {icon}
      {label}
    </button>
  );
  const divider = (key: string) => <div key={key} className="mx-2 my-1 border-t border-hairline/40" />;

  return <>{clearThreads.dialog}{createPortal(
    <div
      ref={menuRef}
      data-bot-menu
      data-sidebar
      role="menu"
      aria-label={t("sidebar.bot.actions", { name: bot.name })}
      onKeyDown={navigateThreadMenu}
      style={{ top: shown.y, left: shown.x }}
      className={cn("fixed z-40 max-h-[calc(100dvh-16px)] w-[228px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-xl border border-hairline/50 bg-menu py-1.5 shadow-2xl shadow-black/60", motion.className)} {...motion.exitProps}
    >
      {showThreads && <>
        {item(<Plus size={16} className="text-ink-secondary" />, t("task.newShort"), () => dispatch({ type: "newTask", botId: bot.id }))}
        {canChooseFolder && item(<FolderOpen size={16} className="shrink-0 text-ink-secondary" />, t("task.folder.new"), () => onNewTaskFolder(bot.id))}
        {item(<FolderPlus size={16} className="text-ink-secondary" />, t("folder.new"), () => onNewFolder(bot.id))}
      </>}
      {item(<Trash2 size={16} />, t("task.deleteAll"), () => clearThreads.ask(bot.id), { danger: true })}
      {divider("threads")}
      {remoteClient ? [
        item(<FolderPlus size={16} className="text-ink-secondary" />, t("sidebar.bot.moveToSection"), () => {
          onClose();
          onMoveToSection(bot.id);
        }),
        botTagMenuItem(item, bot, shown),
        item(<Pencil size={16} className="text-ink-secondary" />, t("sidebar.bot.editProfile"), () => {
          openForSettings();
          if (!state.settingsOpen) dispatch({ type: "toggleSettings", open: true });
        }),
        item(<ClipboardCopy size={16} className="text-ink-secondary" />, t("sidebar.copyConversationId"), () => {
          void copyText(bot.threadId);
        }),
      ] : [
        item(
          bot.pinned ? <PinOff size={16} className="text-ink-secondary" /> : <Pin size={16} className="text-ink-secondary" />,
          bot.pinned ? t("sidebar.bot.unpin") : t("sidebar.bot.pin"),
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } }),
        ),
        item(
          <Star size={16} className={bot.chiefOfStaff ? "fill-accent text-accent" : "text-ink-secondary"} />,
          bot.chiefOfStaff ? t("sidebar.bot.removeChief") : t("sidebar.bot.makeChief"),
          () => dispatch({ type: "updateBot", botId: bot.id, patch: { chiefOfStaff: !bot.chiefOfStaff } }),
          {
            disabled: !bot.chiefOfStaff && !canCoordinate,
            hint: !bot.chiefOfStaff && !canCoordinate ? t("sidebar.bot.chiefNeedsEngine") : undefined,
          },
        ),
        item(<FolderPlus size={16} className="text-ink-secondary" />, t("sidebar.bot.moveToSection"), () => {
          onClose();
          onMoveToSection(bot.id);
        }),
        botTagMenuItem(item, bot, shown),
        item(<BellDot size={16} className="text-ink-secondary" />, t("sidebar.bot.markUnread"), () =>
          dispatch({ type: "markUnread", botId: bot.id }),
        ),
        item(
          readingBotId === bot.id ? <Loader2 size={16} className="animate-spin text-ink-secondary" /> : <CheckCheck size={16} className="text-ink-secondary" />,
          readingBotId === bot.id ? t("sidebar.bot.markingAllRead") : t("sidebar.bot.markAllRead"),
          () => { void readAll(bot); },
          { disabled: readingBotId !== null || botUnreadThreadIds(bot).length === 0, keepOpen: true },
        ),
        divider("d1"),
        item(<Pencil size={16} className="text-ink-secondary" />, t("sidebar.bot.editProfile"), () => {
          openForSettings();
          if (!state.settingsOpen) dispatch({ type: "toggleSettings", open: true });
        }),
        item(<Copy size={16} className="text-ink-secondary" />, t("sidebar.bot.duplicate"), () =>
          dispatch({ type: "duplicateBot", botId: bot.id }),
        ),
        divider("d2"),
        item(<ClipboardCopy size={16} className="text-ink-secondary" />, t("sidebar.copyConversationId"), () => {
          void copyText(bot.threadId);
        }),
        divider("d3"),
        item(
          <Archive size={16} className="text-ink-secondary" />,
          t("sidebar.bot.archive"),
          () => onArchive(bot),
          {
            disabled: archiveBlocked,
            hint: archiveHint,
          },
        ),
        <BotDeleteMenuItem
          key="delete"
          deleting={deleting}
          onClick={() => {
            onClose();
            onDelete(bot);
          }}
        />,
      ]}
      {readError?.botId === bot.id && <p role="alert" className="px-3.5 py-2 text-[12px] text-danger">{readError.message}</p>}
    </div>,
    document.body,
  )}</>;
}

/** A confirmation may span live fleet updates; never authorize from its snapshot. */
export function currentArchivableBot(bots: readonly Bot[], id: string): Bot | undefined {
  const active = bots.filter((candidate) => !candidate.hidden);
  if (active.length <= 1) return undefined;
  return active.find((candidate) => candidate.id === id && !candidate.chiefOfStaff);
}

const NO_FOLDERS: BotProject[] = [];

export function BotThreadList({ bot, selected, density, query, pendingQueued, reveal, locale, generatedTitles, dispatch, activityLabel, hidden = false }: BotRowProps & {
  activityLabel?: string;
  hidden?: boolean;
}) {
  const now = useRelativeNow();
  const tasks = (bot.tasks ?? [{ threadId: bot.threadId, title: t("task.newShort"), createdAt: 0 }])
    .filter((task) => !task.routineRunId)
    .map((task) => ({ ...task, queued: Boolean(pendingQueued[task.threadId]?.length) }));
  const projects = bot.projects ?? NO_FOLDERS;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ projectId: string; left: number; top: number } | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [readStatus, setReadStatus] = useState("");
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reorderStatus, setReorderStatus] = useState("");
  const [folderDrop, setFolderDrop] = useState<{ id: string; place: "before" | "after" } | null>(null);
  const draggingFolder = useRef<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [permissionRefresh, setPermissionRefresh] = useState<{ threadId: string; kind: "local-auto" } | null>(null);
  const currentProjectId = tasks.find((task) => task.threadId === bot.threadId)?.projectId;
  useEffect(() => {
    if (selected && currentProjectId) setCollapsed((previous) => {
      if (!previous.has(currentProjectId)) return previous;
      const next = new Set(previous);
      next.delete(currentProjectId);
      return next;
    });
  }, [selected, currentProjectId]);
  useSnoozeExpiry(tasks);
  const bulk = useBulkSelect();
  const { own: ownTasks, helpers } = bulk.active ? { own: tasks, helpers: [] } : partitionHelperThreads(tasks, bot.threadId, query, projects);
  const visibleTasks = orderedThreadList(visibleSidebarThreads(ownTasks, bot.threadId, query, projects, showAll || bulk.active));
  const visibleProjectIndex = (projectId: string) => visibleTasks.findIndex((task) => task.projectId === projectId);
  const folderRank = (projectId: string) => {
    const index = visibleProjectIndex(projectId);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  const orderedProjects = query ? projects : [...projects].sort((a, b) => folderRank(a.id) - folderRank(b.id) || projects.indexOf(a) - projects.indexOf(b));
  useRevealedThreadRow(reveal, selected ? bot.threadId : null);
  const latest = useRef(bot);
  latest.current = bot;
  const botId = bot.id;
  const actions = useMemo(() => ({
    onSelect: (task: { threadId: string }) => {
      if (task.threadId !== latest.current.threadId) dispatch({ type: "switchTask", botId, threadId: task.threadId });
      else dispatch({ type: "select", id: botId });
    },
    onRename: (task: { threadId: string }, title: string) => dispatch({ type: "renameTask", botId, threadId: task.threadId, title }),
    onRegenerateTitle: generatedTitles ? (task: { threadId: string }, onSettled: (ok: boolean) => void) => dispatch({ type: "regenerateTaskTitle", botId, threadId: task.threadId, onSettled }) : undefined,
    onDelete: (task: { threadId: string }) => dispatch({ type: "deleteTask", botId, threadId: task.threadId }),
    onMove: (task: { threadId: string }, projectId: string | null) => dispatch({ type: "updateTask", botId, threadId: task.threadId, patch: { projectId } }),
    onArchive: (task: { threadId: string }, archivedAt: number | null) => dispatch({ type: "updateTask", botId, threadId: task.threadId, patch: { archivedAt } }),
    onPin: (task: { threadId: string }, pinned: boolean) => dispatch({ type: "updateTask", botId, threadId: task.threadId, patch: { pinned } }),
    onSnooze: (task: { threadId: string }, snoozedUntil: number | null) => dispatch({ type: "updateTask", botId, threadId: task.threadId, patch: { snoozedUntil } }),
    onLink: (task: { threadId: string }, link: string | null) => dispatch({ type: "updateTask", botId, threadId: task.threadId, patch: { link } }),
    onRefreshPermissions: (task: { threadId: string }) => {
      const current = latest.current;
      const mode = approvalModeFor(current);
      const threadMode = approvalModeFor(currentTaskBot(current, task.threadId));
      if (mode === "auto" && current.computer === "local" && threadMode !== "auto") {
        setPermissionRefresh({ threadId: task.threadId, kind: "local-auto" });
        return;
      }
      dispatch({ type: "refreshTaskPermissions", botId, threadId: task.threadId });
    },
  }), [botId, dispatch, generatedTitles]);
  const renderThread = (task: (typeof tasks)[number]) => {
    const thread = currentTaskBot(bot, task.threadId);
    return <SidebarThreadRow key={task.threadId} task={{ ...task, busy: thread.busy, activity: thread.activity, waitingForTeammates: thread.waitingForTeammates }} ownerId={bot.id} current={selected && task.threadId === bot.threadId} compact={density === "compact"} folders={projects}
      activityLabel={task.threadId === bot.threadId ? activityLabel : undefined} now={stampClock(threadRecency(task), now)} locale={locale} {...actions}
      selectMode={bulk.active} checked={selection.has(task.threadId)} onToggleSelect={bulk.toggle} />;
  };
  const ungrouped = visibleTasks.filter((task) => !projects.some((project) => project.id === task.projectId));
  const shownRows = [...orderedProjects.filter((project) => query || bulk.active || !collapsed.has(project.id)).flatMap((project) => visibleTasks.filter((task) => task.projectId === project.id)), ...ungrouped]
    .map((task) => { const thread = currentTaskBot(bot, task.threadId); return { ...task, busy: thread.busy, activity: thread.activity }; });
  const selection = bulk.forRows(shownRows);
  const projectToEdit = projects.find((project) => project.id === editingProject);
  const projectIds = projects.map((project) => project.id);
  const saveOrder = (ids: string[], onSaved?: () => void) => {
    if (reordering || ids.every((id, index) => id === projectIds[index])) return;
    setReordering(true); setReorderError(null); setReorderStatus(t("folder.reordering"));
    dispatch({ type: "reorderProjects", botId: bot.id, projectIds: ids,
      onSaved: () => { setReordering(false); setReorderStatus(t("folder.reordered")); onSaved?.(); },
      onError: (message) => { setReordering(false); setReorderStatus(""); setReorderError(message); } });
  };
  const resetFolderDrag = () => { draggingFolder.current = null; setFolderDrop(null); };
  const readFolder = async (projectId: string, onSaved: () => void) => {
    if (markingRead) return;
    setMarkingRead(true); setReadError(null); setReadStatus(t("folder.markingRead"));
    try {
      await markFolderRead(bot, projectId, api, (updated) => dispatch({ type: "botPatched", bot: updated }));
      setReadStatus(t("folder.markedRead"));
      onSaved();
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error));
      setReadStatus("");
    } finally { setMarkingRead(false); }
  };
  return (
    <div hidden={hidden} className="mb-2 space-y-0.5" role="group" aria-label={t("task.namedList", { name: bot.name })}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) event.stopPropagation(); }}
      onDrop={(event) => { if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); resetFolderDrag(); } }}>
      {!hidden && <>
      {bulk.active && <BulkSelectFilters rows={shownRows} selected={selection} now={now} onChange={bulk.setSelected} onDone={bulk.finish} />}
      {orderedProjects.map((project) => {
        const index = projects.indexOf(project);
        const projectTasks = tasks.filter((task) => task.projectId === project.id);
        const visible = visibleTasks.filter((task) => task.projectId === project.id);
        if (query && visible.length === 0 && !project.name.toLowerCase().includes(query.toLowerCase())) return null;
        const open = Boolean(query) || bulk.active || !collapsed.has(project.id);
        const waiting = projectTasks.some((task) => task.activity === "waiting-on-you");
        const working = projectTasks.some((task) => task.busy);
        return <div key={project.id} data-sidebar-project={project.id}>
          <div data-sidebar-folder-row={project.id} draggable={!reordering}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setFolderMenu({ projectId: project.id, left: event.clientX, top: event.clientY }); }}
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(FOLDER_DRAG_TYPE, JSON.stringify({ botId: bot.id, projectId: project.id }));
              draggingFolder.current = project.id;
            }}
            onDragEnd={(event) => { event.stopPropagation(); resetFolderDrag(); }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
              event.stopPropagation();
              if (!draggingFolder.current || reordering) { event.dataTransfer.dropEffect = "none"; return; }
              event.preventDefault(); event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              setFolderDrop({ id: project.id, place: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
            }}
            onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFolderDrop(null); }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
              event.preventDefault(); event.stopPropagation();
              const from = draggedFolder(event.dataTransfer.getData(FOLDER_DRAG_TYPE), bot.id, projectIds);
              const rect = event.currentTarget.getBoundingClientRect();
              if (from) saveOrder(placeFolder(projectIds, from, project.id, event.clientY < rect.top + rect.height / 2 ? "before" : "after"));
              resetFolderDrag();
            }}
            className={cn("group/folder flex items-center gap-0.5 rounded-md pl-0.5 text-ink-secondary hover:bg-raised/30",
              folderDrop?.id === project.id && draggingFolder.current !== project.id && (folderDrop.place === "before" ? "shadow-[0_-2px_var(--color-accent)]" : "shadow-[0_2px_var(--color-accent)]"))}>
            <button type="button" aria-expanded={open} onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
              return next;
            })} className="flex size-6 shrink-0 items-center justify-center rounded outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60" aria-label={t(open ? "task.collapseNamed" : "task.expandNamed", { name: project.name })}>
              <ChevronRight aria-hidden="true" size={11} className={cn("shrink-0 transition-transform", open && "rotate-90")} />
            </button>
            <button type="button" aria-label={t("folder.iconNamed", { name: project.name })} title={t("folder.iconNamed", { name: project.name })} onClick={() => setEditingProject(project.id)} className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-raised"><FolderIcon emoji={project.emoji} size={14} /></button>
            <button type="button" data-sidebar-folder-label={project.id} draggable={!reordering} aria-expanded={open} onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
              return next;
            })} className="flex min-h-8 min-w-0 flex-1 cursor-grab select-none items-center gap-1.5 py-1 text-left text-[13px] font-semibold active:cursor-grabbing" title={project.name}>
              <span className="truncate">{project.name}</span>
              <span className="shrink-0 text-[10px] font-normal opacity-50">{projectTasks.length}</span>
              {!open && (waiting ? <span className="text-[10px] text-warning">{t("task.waiting")}</span> : working ? <Loader2 size={10} className="shrink-0 animate-spin text-success" /> : projectTasks.some((task) => task.unread) ? <span className="size-1.5 shrink-0 rounded-full bg-unread" aria-label={t("task.unreadMany")} /> : null)}
            </button>
            <button type="button" title={t("task.newIn", { name: project.name })} aria-label={t("task.newIn", { name: project.name })} onClick={() => dispatch({ type: "newTask", botId: bot.id, projectId: project.id })}
              className="flex size-6 items-center justify-center rounded opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/folder:opacity-100 max-md:opacity-70 touch:opacity-70"><Plus size={12} /></button>
            <FolderActions project={project} canMoveUp={index > 0} canMoveDown={index < projects.length - 1} canMarkRead={folderUnreadThreadIds(bot, project.id).length > 0} saving={reordering || markingRead}
              menu={folderMenu?.projectId === project.id ? folderMenu : null} onMenuChange={(menu) => setFolderMenu(menu ? { ...menu, projectId: project.id } : null)}
              onEdit={() => setEditingProject(project.id)} onMove={(direction, onSaved) => saveOrder(moveFolder(projectIds, project.id, direction), onSaved)}
              onMarkRead={(onSaved) => { void readFolder(project.id, onSaved); }} />
          </div>
          {open && <div role="group" aria-label={t("task.namedList", { name: project.name })}>
            {visible.map(renderThread)}
            {projectTasks.length === 0 && <p className="px-2.5 py-1 text-[11px] text-ink-tertiary">{t("task.empty")}</p>}
          </div>}
        </div>;
      })}
      {reorderError && <p role="alert" className="px-2.5 py-1 text-[12px] text-danger">{reorderError}</p>}
      <span role="status" className="sr-only">{reorderStatus}</span>
      {readError && <p role="alert" className="px-2.5 py-1 text-[12px] text-danger">{readError}</p>}
      <span role="status" className="sr-only">{readStatus}</span>
      {projects.length > 0 && ungrouped.length > 0 && <div className="pl-6 pr-3 pb-1 pt-2 text-[10.5px] text-ink-tertiary">{t("task.list")}</div>}
      {ungrouped.map(renderThread)}
      <HelperThreadGroup tasks={orderedThreadList(helpers)} busy={helpers.some((task) => currentTaskBot(bot, task.threadId).busy)} renderThread={renderThread} />
      <ThreadListFooter bulk={bulk} rows={shownRows} selected={selection} total={ownTasks.length} canShowAll={!query && !showAll && ownTasks.length > visibleTasks.length} canSelect={tasks.length > 1}
        onShowAll={() => setShowAll(true)} freshConversation onDelete={(threadIds) => deleteThreadsInBulk({ botId: bot.id }, threadIds, dispatch)} />
      <LocalComputerAutoWarning
        open={permissionRefresh?.kind === "local-auto"}
        onCancel={() => setPermissionRefresh(null)}
        onConfirm={() => {
          const threadId = permissionRefresh?.threadId;
          setPermissionRefresh(null);
          if (threadId) dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId, acknowledgeLocalAuto: true });
        }}
      />
      {projectToEdit && <BotProjectDialog bot={bot} project={projectToEdit} onClose={() => setEditingProject(null)} />}
      </>}
    </div>
  );
}

export interface BotRowProps {
  /** Nordus list: only the bot's own row (its main conversation), no conversations or folders under it. */
  flat?: boolean;
  bot: Bot;
  waiting: boolean;
  waitingBot: Bot;
  waitingThreadId?: string;
  teamWork?: string;
  teamWorkWhere?: string;
  teamWorkOthers?: number;
  selected: boolean;
  deleting: boolean;
  mascotMotion: AppState["mascotMotion"];
  reveal: AppState["revealThread"];
  pendingQueued: AppState["pendingQueued"];
  instances: InstanceInfo[];
  liveCall: AppState["liveCall"];
  locale: string;
  generatedTitles: boolean;
  density: SidebarDensity;
  quiet: boolean;
  query: string;
  dispatch: Dispatch<Action>;
  onMenu: (menu: MenuState) => void;
}

export function botRowProps(
  state: AppState,
  dispatch: Dispatch<Action>,
  bot: Bot,
  layout: Pick<BotRowProps, "density" | "quiet" | "query" | "onMenu">,
): BotRowProps {
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  const reveal = state.revealThread;
  return {
    ...layout,
    bot,
    ...botWait(state.bots, bot, state.selectedId, state.groups),
    selected,
    deleting: state.deletingBots[bot.id] === true,
    mascotMotion: selected && state.mascotMotion?.botId === bot.id ? state.mascotMotion : null,
    reveal: reveal && (bot.threadId === reveal.threadId || bot.tasks?.some((task) => task.threadId === reveal.threadId)) ? reveal : null,
    pendingQueued: state.pendingQueued,
    instances: state.instances,
    liveCall: state.liveCall,
    locale: activeLocale(),
    generatedTitles: llmThreadTitlesEnabled(state.config),
    dispatch,
  };
}

export function useRowRoboEstado(bot: Bot, instances: InstanceInfo[], waiting: boolean, working: boolean): RoboEstado {
  const vmStopped = useVmStopped(bot);
  return roboEstado({ activity: bot.activity, waiting, working, engineDown: engineDown(bot, instances), vmStopped });
}

function useVisibleMessages(bot: Bot): Message[] {
  const { messages, activeLeafId } = bot;
  return useMemo(() => visibleMessages({ messages, activeLeafId }), [messages, activeLeafId]);
}

export const BotListItem = memo(function BotListItem(props: BotRowProps) {
  const advanced = useAdvancedMode();
  const { bot, waiting, waitingBot, waitingThreadId, teamWork, teamWorkWhere, teamWorkOthers = 0, selected, deleting, reveal, pendingQueued, instances, liveCall, density, quiet, query, dispatch, onMenu, flat } = props;
  // The flat Nordus list reads as if conversations were hidden: the row opens the main one and nothing lists under it.
  const showThreads = useShowThreads() && !flat;
  const liveMedia = useLiveMedia();
  const remoteClient = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const [renaming, setRenaming] = useState(false);
  // The tag keeps at least ~8 letters; when the name, the date and that minimum no longer fit,
  // the tag leaves the name line for the right side of the preview line.
  const [tagBelow, setTagBelow] = useState(false);
  const nameLineRef = useRef<HTMLDivElement>(null);
  const nameTextRef = useRef<HTMLSpanElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [threadsOpen, setThreadsOpen] = useSearchDisclosure(`bot:${bot.id}`, showThreads ? query : "", searchMatchesThreads(query, bot.tasks, bot.projects));
  useEffect(() => { if (reveal && showThreads) setThreadsOpen(true); }, [reveal, showThreads]);
  const hasThreadList = (bot.tasks?.filter((task) => !task.routineRunId).length ?? 1) > 1 || (bot.projects?.length ?? 0) > 0 || Boolean(query);
  const iconOnly = density === "icons";
  const expanded = showThreads && !iconOnly && threadsOpen && hasThreadList;
  useEffect(() => {
    if (iconOnly) setRenaming(false);
  }, [iconOnly]);
  // Nordus: a quiet list. The avatar is 48 px in comfortable rows, 40 px in compact ones.
  const avatarSize = iconOnly ? 44 : density === "compact" ? 40 : 48;
  const visible = useVisibleMessages(bot);
  const last = lastNonReceipt(visible);
  const title = bot.title.trim();
  const details = [title, bot.chiefOfStaff ? t("sidebar.bot.chiefOfStaff") : ""].filter(Boolean);
  const rowClass = cn(
    "flex w-full items-center rounded-xl text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-accent/60",
    iconOnly
      ? "justify-center px-1 py-1.5"
      : density === "compact"
        ? cn("gap-2.5 py-1.5", showThreads ? "pl-6 pr-9 group-hover:pr-[5.75rem] group-focus-within:pr-[5.75rem] max-md:pr-[5.75rem] touch:pr-[5.75rem]" : "pl-2 pr-9")
        : cn("gap-3 py-2", showThreads ? "pl-6 pr-9 group-hover:pr-[5.75rem] group-focus-within:pr-[5.75rem] max-md:pr-[5.75rem] touch:pr-[5.75rem]" : "pl-2.5 pr-9"),
    selected ? "bg-raised" : "hover:bg-raised/50",
  );
  const activityTasks = sidebarBotActivityTasks(bot, pendingQueued);
  // The hover card opens for every bot on the rail; in the open list only for one that waits for the person, so it can
  // say what the bot wants and take the answer there.
  const rail = useRailCardTrigger(iconOnly || waiting);
  const approval = useWaitingApproval(waitingBot, waitingThreadId, useVisibleMessages(waitingBot), iconOnly || Boolean(rail.anchor));
  const openWaiting = () => openWhereBotWaits(dispatch, waitingBot, waitingThreadId, showThreads);
  const ownWorking = botWorkingIn(bot, activityTasks);
  const working = !waiting && (ownWorking || Boolean(teamWork));
  const teammateWait = !waiting && !working && (Boolean(bot.waitingForTeammates) || activityTasks.some((task) => Boolean(task.waitingForTeammates)));
  const queued = activityTasks.some((task) => task.queued);
  const unread = botShowsUnread(bot);
  const onLiveCall = liveBadgeFor(bot.id, liveMedia, liveCall);
  const statusLine = deleting || working || waiting || teammateWait || queued;
  const stepNow = !working ? null : ownWorking ? botStepNow(bot) : teamWork ?? null;
  const estado = useRowRoboEstado(bot, instances, waiting, working || teammateWait || queued);
  const robo = useRef<RoboSvg | null>(null);
  const workBubble = working && !iconOnly && !renaming ? workBubbleLines(activityTasks, stepNow) : null;
  const body = (
    <>
      <span className="relative flex shrink-0" title={iconOnly || workBubble ? undefined : [bot.name, ...details].join(" · ")}>
        <BotAvatar bot={bot} estado={estado} ativo={selected} roboRef={robo} size={avatarSize} />
        {!iconOnly && !renaming && <StatusDot estado={estado} className="absolute bottom-0.5 left-0.5 ring-2 ring-panel" />}
        {iconOnly && <StatusDot estado={estado} className="absolute right-0.5 bottom-0.5 ring-2 ring-panel" />}
        {advanced && iconOnly && <BotModelBadge bot={bot} instances={instances} avatarSize={avatarSize} />}
        {bot.chiefOfStaff && iconOnly && (
          <span className="absolute -right-1.5 -top-1.5 flex rounded-[5px] border-2 border-panel bg-accent p-[2px]">
            <Star size={9} strokeWidth={2.5} className="shrink-0 fill-white text-white" role="img" aria-label={t("sidebar.bot.chiefOfStaff")} data-testid="chief-crown">
              <title>{t("sidebar.bot.chiefOfStaff")}</title>
            </Star>
          </span>
        )}
        {onLiveCall && iconOnly && (
          <span className="absolute -right-1 -top-1 flex rounded-full bg-panel p-0.5">
            <Phone className="size-3 shrink-0 text-success" role="img" aria-label={t("call.live.badge")} data-testid="live-call-badge">
              <title>{t("call.live.badge")}</title>
            </Phone>
          </span>
        )}
      </span>
      <div className={cn("min-w-0 flex-1", iconOnly && "hidden")}>
        <div ref={nameLineRef} className="flex items-baseline justify-between gap-2">
          <span className="nb-name flex min-w-0 grow items-center gap-1.5 truncate text-[15px] leading-5 text-ink">
            <span ref={nameTextRef} className="flex min-w-0 shrink-0 max-w-full">
            <RenameTitle
              key={iconOnly ? "icons" : "expanded"}
              value={bot.name}
              onCommit={(name) => {
                if (remoteClient) {
                  void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
                    .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
                    .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
                } else {
                  dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
                }
              }}
              onEditingChange={setRenaming}
              className="shrink-0 truncate"
              inputClassName="w-full rounded bg-inset px-1 py-0.5 text-[15px] font-bold normal-case tracking-normal"
            />
            </span>
            {bot.tag && !renaming && !iconOnly && !tagBelow && (
              <span data-bot-tag="" className="min-w-[4.1rem] max-w-full self-center truncate rounded-[3px] bg-[var(--color-accent-soft)] px-1 py-px text-[8px] font-bold uppercase leading-[11px] tracking-[0.3px] text-[var(--color-accent-chip-ink)]">{bot.tag}</span>
            )}
            {bot.chiefOfStaff && !renaming && (
              <Star size={12} strokeWidth={2.25} className="shrink-0 fill-accent text-accent" role="img" aria-label={t("sidebar.bot.chiefOfStaff")} data-testid="boss-star">
                <title>{t("sidebar.bot.chiefOfStaff")}</title>
              </Star>
            )}
            {title && !renaming && <span className="sr-only">{`, ${title}`}</span>}
            {onLiveCall && !iconOnly && !renaming && (
              <Phone className="size-3 shrink-0 text-success" role="img" aria-label={t("call.live.badge")} data-testid="live-call-badge">
                <title>{t("call.live.badge")}</title>
              </Phone>
            )}
          </span>
          {advanced && density === "compact" && <BotModelMark bot={bot} instances={instances} />}
          {!iconOnly && last && <span ref={dateRef} data-bot-date="" className="shrink-0 text-[11.5px] leading-5 text-ink-tertiary">{formatListDate(last.at)}</span>}
          {(expanded || (quiet && !statusLine)) && unread && <span className="size-1.5 shrink-0 rounded-full bg-unread" aria-label={t("task.unreadMany")} />}
        </div>
        {(!expanded || deleting) && (!quiet || statusLine) && <div className="flex items-center justify-between gap-2">
          {deleting ? (
            <span role="status" className="flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px] text-ink-secondary">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              {t("sidebar.bot.deletingRow")}
            </span>
          ) : (
            <span data-bot-preview="" className={cn("flex min-w-0 items-center gap-1.5 truncate text-[13.5px] leading-[18px]", waiting ? "text-warning" : "text-ink-secondary")}>
              {working && stepNow ? (
                <>
                  <span data-bot-step="" dir="auto" role="status" title={ownWorking ? undefined : teamWorkWhere} className="truncate text-ink-secondary">{stepNow}</span>
                  {!ownWorking && teamWorkOthers > 0 && <span data-team-others="" className="shrink-0 text-ink-tertiary">+{teamWorkOthers}</span>}
                </>
              ) : working ? (
                <span className="flex h-[1.5em] items-center" role="status">
                  <WorkingDots size={3.5} />
                  <span className="sr-only">{t("sidebar.preview.working")}</span>
                </span>
              ) : (
                <span dir="auto" className="truncate">{waiting ? t("sidebar.preview.waiting") : teammateWait ? waitingOnLabel(bot.waitingOn ?? activityTasks.find((task) => task.waitingOn)?.waitingOn, t("sidebar.preview.waitingOnTeammate"), true) : queued ? t("task.queued") : botPreview(bot, visible, instances, advanced)}</span>
              )}
            </span>
          )}
          {advanced && density === "comfortable" && <BotModelMark bot={bot} instances={instances} />}
          {bot.tag && tagBelow && !renaming && !iconOnly && (
            <span data-bot-tag="" data-bot-tag-below="" className="max-w-[45%] shrink-0 truncate rounded-[3px] bg-[var(--color-accent-soft)] px-1 py-px text-[8px] font-bold uppercase leading-[11px] tracking-[0.3px] text-[var(--color-accent-chip-ink)]">{bot.tag}</span>
          )}
          {unread && (
            <span className="size-2 shrink-0 rounded-full bg-unread" aria-label={t("task.unreadMany")} />
          )}
        </div>}
      </div>
      {workBubble && (
        <span data-work-bubble="" aria-hidden="true">
          <span data-work-bubble-main="" dir="auto">{workBubble.main}</span>
          {workBubble.step && <span data-work-bubble-step="" dir="auto">{workBubble.step}</span>}
        </span>
      )}
    </>
  );
  useLayoutEffect(() => {
    const line = nameLineRef.current;
    const name = nameTextRef.current;
    if (!line || !name || !bot.tag || iconOnly) {
      setTagBelow(false);
      return;
    }
    const measure = () => {
      const extras = (bot.chiefOfStaff ? 20 : 0) + (onLiveCall ? 20 : 0);
      const need = name.scrollWidth + (dateRef.current?.offsetWidth ?? 0) + extras + 88 + 18;
      setTagBelow(need > line.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    return () => observer.disconnect();
  }, [bot.tag, bot.name, bot.chiefOfStaff, onLiveCall, iconOnly, last?.at]);
  const onContextMenu = (event: React.MouseEvent) => {
    if (rail.wasLongPress()) {
      event.preventDefault();
      return;
    }
    openBotContextMenu(onMenu, bot.id, event);
  };
  const onSelect = (event: React.MouseEvent) => {
    if (renaming || rail.wasLongPress()) return;
    const insideRenameInput = event.target instanceof HTMLInputElement;
    if (botListItemPointerIntent(event.type, insideRenameInput) === "select") {
      waveRobot(robo.current);
      openWaiting();
    }
  };

  return (
    <>
    <div className={cn("group relative", !iconOnly && "mb-1")}
      onMouseEnter={() => robo.current?.nbAvatar?.acordar(true)} onMouseLeave={() => robo.current?.nbAvatar?.acordar(false)}>
      {/* Keep this wrapper mounted: replacing it remounts RenameTitle and leaves the row stuck in rename mode. */}
      <div
        role={renaming ? undefined : "button"}
        tabIndex={renaming ? undefined : 0}
        aria-label={
          !renaming && iconOnly
            ? deleting
              ? t("sidebar.bot.deletingAria", { name: bot.name })
              : `${bot.name}${bot.title?.trim() ? ` · ${bot.title.trim()}` : ""}${bot.chiefOfStaff ? ` · ${t("sidebar.bot.chiefOfStaff")}` : ""}${onLiveCall ? ` · ${t("call.live.badge")}` : ""}${waiting ? ` · ${t("sidebar.preview.waiting")}` : working ? ` · ${stepNow ?? t("chat.activity.working")}` : teammateWait ? ` · ${t("sidebar.preview.waitingOnTeammate")}` : queued ? ` · ${t("task.queued")}` : ""}${unread ? ` · ${t("task.unread")}` : ""}`
            : undefined
        }
        aria-busy={deleting || undefined}
        aria-current={selected && !expanded && !renaming ? "page" : undefined}
        data-sidebar-bot-row={bot.id}
        {...rail.triggerProps}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (renaming) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openWaiting();
          }
        }}
        onContextMenu={onContextMenu}
        className={rowClass}
      >
        {body}
      </div>
      {rail.anchor && <SidebarRailCard
        anchor={rail.anchor}
        data={botRailCard(bot, visible, instances, advanced, { waiting, working: working || teammateWait, unread, step: ownWorking || !teamWorkWhere ? stepNow : teamWorkOthers ? `${teamWorkWhere} +${teamWorkOthers}` : teamWorkWhere })}
        avatar={<BotAvatar bot={bot} estado={estado} size={28} />}
        {...rail.cardProps}
      >
        {approval && (approval.pending
          ? <SidebarRailApproval pending={approval.pending} threadId={approval.threadId} bot={waitingBot} onDetails={openWaiting} />
          : <SidebarRailWaiting loading={approval.loading} onDetails={openWaiting} />)}
      </SidebarRailCard>}
      {showThreads && !iconOnly && hasThreadList && <button
        type="button"
        aria-label={t(threadsOpen ? "task.collapseNamed" : "task.expandNamed", { name: bot.name })}
        aria-expanded={threadsOpen}
        onClick={() => setThreadsOpen((open) => !open)}
        className="absolute left-0.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-secondary outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60"
      ><ChevronRight aria-hidden="true" size={13} className={cn("transition-transform", threadsOpen && "rotate-90")} /></button>}
      {!renaming && iconOnly && unread && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 size-2 rounded-full border border-panel bg-unread" />
      )}
      {!renaming && iconOnly && approval && (
        <span data-rail-approval-badge="" aria-label={t("sidebar.rail.approvalBadge")} className="pointer-events-none absolute right-1 top-0.5 flex size-4 items-center justify-center rounded-full border-2 border-panel bg-warning text-[9px] font-bold leading-none text-black">!</span>
      )}
      {!renaming && !deleting && !iconOnly && <>
        {showThreads && <button type="button" aria-label={t("task.newShort")} title={t("task.newShort")} onClick={() => { setThreadsOpen(true); dispatch({ type: "newTask", botId: bot.id }); }}
          className="pointer-events-none absolute right-[3.75rem] top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary opacity-0 hover:bg-raised hover:text-ink group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70"><Plus size={14} /></button>}
        {showThreads && <button type="button" aria-label={t("folder.newNamed", { name: bot.name })} title={t("folder.new")} onClick={() => { setThreadsOpen(true); setCreatingProject(true); }}
          className="pointer-events-none absolute right-8 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary opacity-0 hover:bg-raised hover:text-ink group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70"><FolderPlus size={14} /></button>}
        <button type="button" aria-label={t("sidebar.bot.actions", { name: bot.name })} title={t("sidebar.bot.actions", { name: bot.name })} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ botId: bot.id, x: rect.left, y: rect.bottom }); }}
          className="pointer-events-none absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary opacity-0 hover:bg-raised hover:text-ink group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70"><MoreHorizontal size={15} /></button>
      </>}
      {deleting && iconOnly && (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-card p-1 text-ink-secondary">
          <Loader2 size={12} className="animate-spin" />
        </span>
      )}
    </div>
    {!flat && !iconOnly && threadsOpen && hasThreadList && <BotThreadList {...props} hidden={!showThreads}
      activityLabel={liveActivityLabel(last)}
      query={bot.name.toLowerCase().includes(query.toLowerCase()) || bot.title.toLowerCase().includes(query.toLowerCase()) ? "" : query} />}
    {/* Nordus list: nothing under the bot's row; a wait shows in its preview and is answered from its hover card. */}
    {!expanded && !flat && <SidebarBotActivity bot={bot} rowThreadId={selected ? bot.threadId : botOpensTo(bot, showThreads)} density={density} pendingQueued={pendingQueued} dispatch={dispatch} />}
    {showThreads && creatingProject && <BotProjectDialog bot={bot} onClose={() => setCreatingProject(false)} />}
    </>
  );
});

export function TeamMenuItems({ onAddBots, onRename, onShare, onDelete, onSetForAll }: {
  onAddBots: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onSetForAll?: () => void;
}) {
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-raised";
  return (
    <>
      <button type="button" role="menuitem" autoFocus className={item} onClick={onAddBots}><Users size={14} />{t("team.addBots")}</button>
      {onSetForAll && <button type="button" role="menuitem" className={item} onClick={onSetForAll}><SlidersHorizontal size={14} />{t("teamSettings.menu")}</button>}
      <button type="button" role="menuitem" className={item} onClick={onRename}><Pencil size={14} />{t("team.rename")}</button>
      <button type="button" role="menuitem" className={item} onClick={onShare}><Share2 size={14} />{t("team.share")}</button>
      <button type="button" role="menuitem" className={cn(item, "text-danger")} onClick={onDelete}><Trash2 size={14} />{t("team.delete")}</button>
    </>
  );
}

export function Sidebar({ open, onClose, collapseToIcons = false }: {
  open: boolean;
  onClose: () => void;
  collapseToIcons?: boolean;
}) {
  const { state, dispatch } = useStore();
  const now = useRelativeNow();
  const cloudOwner = useCloudOwner(state.config?.cloudHome === true);
  const endHowTo = useCallback(() => {
    track("cloud_howto", { result: "closed" });
    dispatch({ type: "cloudHowTo", open: false });
  }, [dispatch]);
  const showThreads = useShowThreads();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const { capabilities } = useDesktopCapabilities();
  const importReturnRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState<{ kind: BotConfirmKind; bot: Bot } | null>(null);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [sectionPicker, setSectionPicker] = useState<MenuState | null>(null);
  const [newTeam, setNewTeam] = useState(false);
  const [teamMenu, setTeamMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [teamSettings, setTeamSettings] = useState<string | null>(null);
  const teamSettingsAllowed = useOwnerOrAdmin();
  const teamMotion = useHeldMenuMotion(teamMenu);
  const teamMenuReturn = useRef<HTMLElement | null>(null);
  const closeTeamMenu = () => {
    (teamMenuReturn.current?.isConnected ? teamMenuReturn.current : sidebarRef.current)?.focus();
    setTeamMenu(null);
  };
  const openTeamMenu = (name: string, x: number, y: number, returnTo: HTMLElement) => {
    teamMenuReturn.current = returnTo;
    setTeamMenu({ name, x: Math.max(8, Math.min(x, window.innerWidth - 266)), y: Math.max(8, Math.min(y, window.innerHeight - 190)) });
  };
  const renamedTeam = (oldName: string, newName: string) => {
    const replace = (ids: string[]) => [...new Set(ids.map(id => id === userSectionId(oldName) ? userSectionId(newName) : id))];
    setCollapsedSections(current => { const next = replace(current); saveCollapsedSections(next); return next; });
    setSectionOrder(current => { const next = replace(current); saveSectionOrder(next); return next; });
    requestAnimationFrame(() => {
      const header = [...(sidebarRef.current?.querySelectorAll<HTMLElement>("[data-section]") ?? [])]
        .find(element => element.dataset.section === newName);
      (header?.querySelector<HTMLElement>("button") ?? header ?? sidebarRef.current)?.focus();
    });
  };
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);
  const [teamDeletePending, setTeamDeletePending] = useState(false);
  const teamDeleteRunning = useRef(false);
  const [moveToTeam, setMoveToTeam] = useState<string | null>(null);
  const [renameTeam, setRenameTeam] = useState<string | null>(null);
  const [shareTeam, setShareTeam] = useState<string | null>(null);
  const [roomMenu, setRoomMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [roomSectionPicker, setRoomSectionPicker] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const deletingRoom = deletingRoomId ? state.groups.find((g) => g.id === deletingRoomId) : undefined;
  const [plusOpen, setPlusOpen] = useState(false);
  const plusMotion = useMenuMotion(plusOpen);
  const advanced = useAdvancedMode();
  const [attentionOpen, setAttentionOpen] = useState(false);
  const attentionMotion = useMenuMotion(attentionOpen);
  const [attentionPinned, setAttentionPinnedState] = useState(() => loadSidebarAttentionPinned());
  const setAttentionPinned = (pinned: boolean) => {
    setAttentionPinnedState(pinned);
    saveSidebarAttentionPinned(pinned);
  };
  const guest = useGuest();
  const [newRoom, setNewRoom] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newFolderBotId, setNewFolderBotId] = useState<string | null>(null);
  const [newTaskFolderBotId, setNewTaskFolderBotId] = useState<string | null>(null);
  const newTaskFolderBot = state.bots.find((bot) => bot.id === newTaskFolderBotId);
  const [teamLibraryOpen, setTeamLibraryOpen] = useState(false);
  const [teamInstallUrl, setTeamInstallUrl] = useState<string | null>(null);
  const [archivedBotsOpen, setArchivedBotsOpen] = useState(false);
  const [teamFeedback, setTeamFeedback] = useState<{
    error: boolean;
    text: string;
    restoreBot?: { id: string; name: string };
  } | null>(null);
  const [query, setQuery] = useState("");
  // Nordus: the search field stays hidden behind a magnifier beside "+" until the person asks for it.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchHint = t("sidebar.searchHint", { label: t("sidebar.searchAria"), keys: commandPaletteKeys() });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const showSearch = searchOpen || query.length > 0;
  const openSearch = () => setSearchOpen(true);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };
  const storedDensity = useSidebarDensity();
  const desktop = useMediaQuery(SIDEBAR_INLINE, true);
  // The rail is a desktop layout. The person's choice stays stored; a forced collapse (side panels open) never rewrites it.
  const density = effectiveSidebarDensity({ stored: storedDensity, forceRail: collapseToIcons, desktop });
  const defaultWidth = density === "compact" ? 300 : 360;
  const sidePanelOpen = state.computerOpen || state.inspectorOpen;
  const maxSidebarWidth = sidePanelOpen ? defaultWidth : Math.min(480, window.innerWidth - 320);
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => loadSidebarWidth());
  const widthRef = useRef(sidebarWidth);
  const [resizing, setResizing] = useState(false);
  // startWidth: the list's width when the drag began, kept so a drag that collapses it reopens at that width.
  const dragRef = useRef<{ from: "list" | "rail"; x: number; startWidth: number | null }>({ from: "list", x: 0, startWidth: null });
  const resizeTo = (width: number) => {
    const next = clampSidebarWidth(width, sidePanelOpen ? defaultWidth + 320 : window.innerWidth);
    if (next === Math.round(sidebarRef.current?.getBoundingClientRect().width ?? defaultWidth)) return null;
    widthRef.current = next;
    sidebarRef.current?.style.setProperty("--sidebar-width", `${next}px`);
    return next;
  };
  const finishResize = () => {
    setResizing(false);
    if (widthRef.current !== null) {
      setSidebarWidth(widthRef.current);
      saveSidebarWidth(widthRef.current);
    }
  };
  const [lastExpandedDensity, setLastExpandedDensity] = useState<Exclude<SidebarDensity, "icons">>(
    () => density === "icons" ? "comfortable" : density,
  );
  const pinnedCircles = usePinnedCircles();
  const universalPins = useUniversalPins();
  const [pinnedCircleThreadsCollapsed, setPinnedCircleThreadsCollapsed] = useState(true);
  const quietRows = density === "compact";
  const [collapsedSections, setCollapsedSections] = useState<string[]>(() => loadCollapsedSections());
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => loadSectionOrder());
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; place: SectionDropPlace } | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const sectionDragRef = useRef<{
    from: string | null;
    over: { id: string; place: SectionDropPlace } | null;
  }>({ from: null, over: null });

  useEffect(() => {
    if (density !== "icons") setLastExpandedDensity(density);
    else setQuery("");
  }, [density]);

  const toggleCollapsed = () => {
    setSidebarDensity(density === "icons" ? lastExpandedDensity : "icons");
  };

  useEffect(() => {
    if (!desktop || collapseToIcons) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSidebarToggleShortcut(event)) return;
      event.preventDefault();
      setSidebarDensity(density === "icons" ? lastExpandedDensity : "icons");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, collapseToIcons, density, lastExpandedDensity]);

  useEffect(() => {
    if (!open || confirm || deletingRoom) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, confirm, deletingRoom]);

  const attentionMenuRef = useRef<HTMLDivElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(attentionOpen, attentionMenuRef, () => setAttentionOpen(false));
  usePopoverDismiss(plusOpen, plusMenuRef, () => setPlusOpen(false));

  useEffect(() => {
    if (remoteClient) return;
    return window.ogb?.onPackageInstall?.((url) => {
      setTeamInstallUrl(url);
      setTeamLibraryOpen(true);
    });
  }, [remoteClient]);

  useEffect(() => {
    if (!teamFeedback) return;
    const timer = window.setTimeout(() => setTeamFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [teamFeedback]);


  const requestArchive = (bot: Bot) => {
    const current = currentArchivableBot(state.bots, bot.id);
    if (current) setConfirm({ kind: "archive", bot: current });
  };

  const archiveBot = async ({ id }: Pick<Bot, "id">) => {
    const bot = currentArchivableBot(state.bots, id);
    if (bot) await archiveBotWithNotice(bot, { bots: state.bots, selectedId: state.selectedId, dispatch, showThreads, notify: setTeamFeedback });
  };
  // Archives from the bot panel report here too, with the same Undo.
  useEffect(() => onArchiveNotice(setTeamFeedback), []);

  const undoBotArchive = async (bot: { id: string; name: string }) => {
    setTeamFeedback(null);
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      openBot(dispatch, response.bot, showThreads);
      setTeamFeedback({ error: false, text: t("sidebar.archived.restored", { name: bot.name }) });
    } catch (cause) {
      setTeamFeedback({ error: true, text: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const macInset = capabilities.windowChrome === "mac-inset";
  const draggableChrome = macInset || capabilities.windowChrome === "win-caption";
  // SAFETY: Electron's -webkit-app-region is not in React's CSSProperties type; the renderer accepts it as an inline
  // style.
  const windowDragStyle = draggableChrome
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;
  // SAFETY: interactive buttons must opt out of the draggable title-bar region.
  const windowNoDragStyle = draggableChrome
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  const q = query.trim().toLowerCase();

  const ledMembers = ledMemberIds(state.bots, state.selectedId);
  const matchingBots = state.bots
    .filter((b) => !b.hidden && (q || !ledMembers.has(b.id)))
    .filter(
      (b) =>
        !q ||
        b.name.toLowerCase().includes(q) ||
        (b.title ?? "").toLowerCase().includes(q) ||
        botPreview(b, visibleMessages(b), state.instances, advanced).toLowerCase().includes(q) ||
        b.tasks?.some((task) => !task.routineRunId && task.title.toLowerCase().includes(q)) ||
        b.projects?.some((folder) => folder.name.toLowerCase().includes(q)),
    );
  const visibleGroups = state.groups
    .filter((g) => !q || g.name.toLowerCase().includes(q) || g.tasks?.some((task) => task.title.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.general === true) - Number(a.general === true));
  const {
    unsectionedChief,
    pinnedBots,
    sectionChiefs,
    sectionedBots,
    unsectionedBots,
  } = partitionSidebarBots(matchingBots, { universalPins });
  const { botChats, sectionedRooms, unsectionedRooms } = partitionSidebarGroups(visibleGroups);
  const topChief = unsectionedChief ?? sectionChiefs[0] ?? null;

  const sectionNames: string[] = (state.sections ?? []).filter((name) => !q || name.toLowerCase().includes(q.toLowerCase()));
  for (const bot of sectionedBots) {
    if (!sectionNames.includes(bot.section!)) sectionNames.push(bot.section!);
  }
  for (const bot of sectionChiefs) {
    if (!sectionNames.includes(bot.section!)) sectionNames.push(bot.section!);
  }
  for (const group of sectionedRooms) {
    if (!sectionNames.includes(group.section!)) sectionNames.push(group.section!);
  }
  const naturalSectionIds = [
    ...(pinnedBots.length > 0 && !universalPins ? [PINNED_SECTION_ID] : []),
    ...(unsectionedRooms.length > 0 ? [CHANNELS_SECTION_ID] : []),
    ...(botChats.length > 0 ? [BOT_CHATS_SECTION_ID] : []),
    ...(unsectionedBots.length > 0 ? [BOTS_SECTION_ID] : []),
    ...sectionNames.map(userSectionId),
  ];
  const sectionIds = orderedSidebarSections(naturalSectionIds, sectionOrder);
  const showPinnedCircleThreads = pinnedCircleThreadListVisible(pinnedCircles, density, pinnedBots.length);
  const layoutInteractive = sidebarLayoutInteractive(density, q);
  const sectionCollapsed = (id: string) =>
    sidebarSectionCollapsed(id, collapsedSections, density, q);

  const toggleSection = (id: string) => {
    if (!layoutInteractive) return;
    const next = toggleCollapsedSection(collapsedSections, id);
    setCollapsedSections(next);
    saveCollapsedSections(next);
  };

  const commitSectionOrder = (visibleOrder: string[]) => {
    if (!layoutInteractive) return;
    const next = mergeSectionOrder(sectionOrder, visibleOrder);
    if (sameSectionOrder(next, sectionOrder)) return;
    setSectionOrder(next);
    saveSectionOrder(next);
  };

  const announceSectionPosition = (id: string, visibleOrder: string[]) => {
    const position = visibleOrder.indexOf(id);
    if (position < 0) return;
    setReorderAnnouncement(
      t("sidebar.section.moved", {
        name: sectionLabel(id),
        position: position + 1,
        count: visibleOrder.length,
      }),
    );
  };

  const reorderSections = (id: string, moved: string[]) => {
    const next = moved;
    if (sameSectionOrder(next, sectionIds)) return;
    commitSectionOrder(next);
    announceSectionPosition(id, next);
  };
  const moveSidebarSection = (id: string, direction: -1 | 1) => reorderSections(id, moveSection(sectionIds, id, direction));

  const resetSectionDrag = () => {
    sectionDragRef.current = { from: null, over: null };
    setDraggingSectionId(null);
    setDropTarget(null);
  };

  const updateSectionDropTarget = (event: React.DragEvent<HTMLDivElement>, id: string) => {
    if (!layoutInteractive || !sectionDragRef.current.from) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const place: SectionDropPlace = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const next = { id, place };
    sectionDragRef.current.over = next;
    setDropTarget(next);
  };

  const dropSection = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
    event.preventDefault();
    const from =
      event.dataTransfer.getData("application/x-nordus-sidebar-section") ||
      event.dataTransfer.getData("text/plain") ||
      sectionDragRef.current.from;
    const over = sectionDragRef.current.over;
    if (from && over) reorderSections(from, placeSection(sectionIds, from, over.id, over.place));
    resetSectionDrag();
  };
  const archivedBots = state.bots.filter((bot) => bot.hidden);
  const attention = attentionForPerson(crossBotAttentionThreads(state.bots, state.pendingQueued, undefined, state.groups), state.bots, state.selectedId);
  const pinnedThreads = crossBotPinnedThreads(state.bots, state.groups, state.pendingQueued);
  const pendingBotUndo = teamFeedback?.restoreBot;
  const botRow = (bot: Bot) => botRowProps(state, dispatch, bot, { density, quiet: quietRows, query: q, onMenu: setMenu });
  // Nordus: one list, like a messenger. Bots and rooms together, whoever is waiting on the person first, then the most
  // recent conversation. Sections, the chief card and "Precisa de você" headers stay out unless the person searches.
  const flatList = !q;
  // Pinned bots and the Boss leave the list for the highlight at the top, Boss first.
  const heroBots = flatList && density !== "icons"
    ? matchingBots.filter((bot) => bot.chiefOfStaff || bot.pinned).sort((a, b) => Number(Boolean(b.chiefOfStaff)) - Number(Boolean(a.chiefOfStaff))).slice(0, 4)
    : [];
  const heroIds = new Set(heroBots.map((bot) => bot.id));
  // On the avatar rail the Boss sits alone in a tile above the list and does not repeat in it.
  const { boss: railBoss, rest: railRest } = flatList && density === "icons" ? splitRailBoss(matchingBots) : { boss: null, rest: matchingBots };
  const flatItems = flatList ? sidebarFlatItems(railRest.filter((bot) => !heroIds.has(bot.id)), visibleGroups, needsYouEntries(attention), leadersWithWaitingMember(state.bots, state.selectedId)) : [];

  const renderPlus = (rail: boolean) => guest ? null : (
        <div ref={plusMenuRef} className="contents">
          <button
            ref={importReturnRef}
            onClick={() => setPlusOpen((o) => !o)}
            aria-label={remoteClient ? t("sidebar.new") : t("sidebar.newOrShare")}
            className={cn(
              "flex items-center justify-center text-ink-secondary",
              rail
                ? "nb-pill size-[40px] shrink-0 rounded-full hover:text-ink"
                : "size-8 rounded-md hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            )}
            title={remoteClient ? t("sidebar.new") : t("sidebar.newOrShare")}
          >
            <Plus size={rail ? 18 : 17} strokeWidth={2} />
          </button>
          {plusMotion.shown && (
            <>
              <div className={cn(
                "absolute z-40 w-52 overflow-hidden rounded-xl border border-hairline/50 bg-menu py-1.5 shadow-2xl shadow-black/60",
                rail ? "bottom-full left-2 mb-1" : "top-full right-0 mt-1",
                plusMotion.className,
              )} {...plusMotion.exitProps}>
                <button
                  onClick={() => {
                    setPlusOpen(false);
                    setNewChatOpen(true);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
                >
                  <MessageSquarePlus size={16} className="text-ink-secondary" />
                  {t("sidebar.newChat.title")}
                </button>
                <button
                  data-preload="new-bot"
                  onClick={() => {
                    setPlusOpen(false);
                    dispatch({ type: "toggleNewBot", open: true });
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
                >
                  <BotIcon size={16} className="text-ink-secondary" />
                  <span className="flex-1">{t("sidebar.newBot")}</span>
                  <ShortcutHint id="new-bot" />
                </button>
                <button
                  onClick={() => {
                    setPlusOpen(false);
                    setNewRoom(true);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
                >
                  <Users size={16} className="text-ink-secondary" />
                  {t("sidebar.newChannel.title")}
                </button>
                {!remoteClient && <button
                  onClick={() => { setPlusOpen(false); setNewTeam(true); }}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
                >
                  <FolderPlus size={16} className="text-ink-secondary" /> {t("team.create")}
                </button>}
                {!remoteClient && <>
                <button
                  data-preload="team-library"
                  onClick={() => {
                    setPlusOpen(false);
                    setTeamLibraryOpen(true);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
                >
                  <Library size={16} className="text-ink-secondary" />
                  {t("sidebar.teamLibrary")}
                </button>
                {/* Always here, so the person finds the archived bots without archiving one first. */}
                {(
                  <button
                    data-plus-archived=""
                    onClick={() => {
                      setPlusOpen(false);
                      setArchivedBotsOpen(true);
                    }}
                    className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-ink hover:bg-raised/70"
                  >
                    <Archive size={16} className="text-ink-secondary" />
                    <span className="flex-1">{t("sidebar.archived.title")}</span>
                    {archivedBots.length > 0 && <span className="text-[11.5px] text-ink-secondary">{archivedBots.length}</span>}
                  </button>
                )}
                </>}
              </div>
            </>
          )}
          </div>
  );

  return (
    <aside
      ref={sidebarRef}
      tabIndex={-1}
      aria-label={t("sidebar.aria")}
      data-native-view-overlay
      data-sidebar
      style={{ "--sidebar-width": `${widthRef.current ?? defaultWidth}px` } as CSSProperties}
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r border-hairline/40 bg-panel",
        resizing ? "transition-none" : "transition-[width] duration-100 ease-[cubic-bezier(.23,1,.32,1)]",
        density === "icons" ? "w-[80px]" : density === "compact" ? "w-[272px] md:w-[var(--sidebar-width)]" : "w-[320px] md:w-[var(--sidebar-width)]",
        sidePanelOpen ? density === "compact" ? "md:max-w-[272px]" : "md:max-w-[320px]" : "md:max-w-[calc(100vw-320px)]",
        // max-md: rather than an md: cancel: Tailwind v4 emits the native `translate`, and any value but `none` makes
        // this a containing block for its `fixed` descendants.
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40",
        "max-md:transition-transform max-md:duration-200",
        open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}
    >
      <GlassScrollFrame className="flex-1">
      <GlassBar edge="top">
      <div
        data-sidebar-top-row
        className={cn(
          "flex items-center",
          density === "icons" ? "flex-col gap-1 px-2 pt-3.5 pb-1" : "relative pl-4 pr-2",
          density !== "icons" && !macInset && "h-12",
        )}
        style={density !== "icons" && macInset ? { ...windowDragStyle, height: MAC_TRAFFIC_LIGHT_CENTER_Y * 2 } : windowDragStyle}
      >
        {macInset ? (
          // The macOS 26 traffic lights span 16-76px; nothing clickable starts before 88px.
          <div aria-hidden="true" data-traffic-light-space className={density === "icons" ? "h-5 w-full" : "w-[72px] shrink-0"} />
        ) : null /* Nordus draws no make-believe window buttons in a browser or the phone app. */}
        {density !== "icons" && (
          <div data-sidebar-top-slot className="@container/sidebar-top flex min-w-0 flex-1 items-center">
            <div data-sidebar-top-spacer className="flex min-w-0 flex-1 items-center @min-[96px]/sidebar-top:min-w-6"><SidebarTodayNav density={density} inline /><SidebarInboxNav density={density} inline /></div>
            <div data-sidebar-top-switcher className="flex min-w-0 max-w-[140px] items-center">
              <DesktopWorkspaceSwitcher inline cloudHome={state.config?.cloudHome === true} owner={cloudOwner} howTo={state.cloudHowTo} onMenuClosed={endHowTo} />
            </div>
          </div>
        )}
        <div
          data-sidebar-top-buttons
          className={cn("relative flex shrink-0 items-center", density === "icons" ? "flex-col gap-1" : "ml-0.5 gap-0.5")}
          style={windowNoDragStyle}
        >
          {!collapseToIcons && (advanced || density === "icons") && <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={density === "icons" ? t("sidebar.density.expand") : t("sidebar.density.collapseAria")}
            className={cn(
              "flex items-center justify-center text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              density === "icons" ? "size-[46px] shrink-0 rounded-xl" : "size-8 rounded-md",
            )}
            title={density === "icons" ? t("sidebar.density.expand") : t("sidebar.density.collapse")}
          >
            {density === "icons" ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={17} />}
          </button>}
          {density === "icons" && <button
            type="button"
            onClick={openCommandPalette}
            aria-label={t("sidebar.searchAria")}
            title={searchHint}
            className="flex size-[46px] shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Search size={20} strokeWidth={2} />
          </button>}
          {advanced && <div ref={attentionMenuRef} className={density === "icons" ? "relative" : "contents"}>
            <button
              type="button"
              onClick={() => setAttentionOpen((o) => !o)}
              aria-label={attentionTriggerLabel(attention.length)}
              title={attentionTriggerLabel(attention.length)}
              className={cn(
                "relative flex items-center justify-center text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                density === "icons" ? "size-[46px] shrink-0 rounded-xl" : "size-8 rounded-md",
              )}
            >
              <Activity size={density === "icons" ? 20 : 17} strokeWidth={2} />
              {attention.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-0.5 text-[9.5px] font-semibold leading-4 text-ink">{attention.length > 9 ? "9+" : attention.length}</span>
              )}
              {attentionHasRunningWork(attention) && (
                <span data-header-activity="" className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-success" aria-hidden="true" />
              )}
            </button>
            {attentionMotion.shown && (
              <>
                <div className={cn(
                  "absolute top-full z-40 mt-1 overflow-hidden rounded-xl border border-hairline/50 bg-menu py-1.5 shadow-2xl shadow-black/60",
                  density === "icons" ? "left-0" : "right-0",
                  density === "icons" ? "w-72" : density === "compact" ? "w-60 md:w-[min(240px,calc(var(--sidebar-width)_-_32px))]" : "w-72 md:w-[min(288px,calc(var(--sidebar-width)_-_32px))]",
                  attentionMotion.className,
                )} {...attentionMotion.exitProps}>
                  <div className="flex items-center gap-1 pb-1 pl-3.5 pr-2 pt-1.5">
                    <span className="flex-1 text-[13px] font-medium text-ink">{t("attention.title")}</span>
                    <button
                      type="button"
                      onClick={() => setAttentionPinned(!attentionPinned)}
                      aria-label={t(attentionPinned ? "attention.unpin" : "attention.pin")}
                      title={t(attentionPinned ? "attention.unpin" : "attention.pin")}
                      className="flex size-6 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {attentionPinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                  </div>
                  {attention.length === 0 ? (
                    <div className="px-3.5 py-2.5 text-[13px] text-ink-secondary">{t("attention.empty")}</div>
                  ) : (
                    <AttentionThreadRows entries={attention} onJump={(entry) => { setAttentionOpen(false); dispatch(attentionJumpAction(entry)); }} />
                  )}
                </div>
              </>
            )}
          </div>}
          {/* On a phone the bell lives here, on the list's top, beside search and +; the conversation keeps only its name. */}
          {density !== "icons" && <span data-sidebar-bell="" className="flex md:hidden"><NotificationsHeaderButton /></span>}
          {density !== "icons" && <button
            type="button"
            data-sidebar-search-toggle=""
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (showSearch ? closeSearch() : openSearch())}
            aria-label={showSearch ? t("sidebar.searchClose") : t("sidebar.searchAria")}
            aria-expanded={showSearch}
            title={showSearch ? t("sidebar.searchClose") : searchHint}
            className="flex size-8 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Search size={17} strokeWidth={2} />
          </button>}
          {density !== "icons" && renderPlus(false)}
        </div>
      </div>

      {density === "icons" && <DesktopWorkspaceSwitcher compact cloudHome={state.config?.cloudHome === true} owner={cloudOwner} howTo={state.cloudHowTo} onMenuClosed={endHowTo} />}
      <OrganizationIdentity compact={density === "icons"} />
      {/* The field opens from the magnifier beside +, and closes again when it is left empty. */}
      {density !== "icons" && showSearch && <div data-sidebar-search="" className="px-3 pb-3 pt-1">
        <div data-sidebar-search-pill="" className="flex h-11 items-center gap-2.5 rounded-full px-4 focus-within:ring-2 focus-within:ring-focus/60">
          <Search size={16} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={openSearch}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              closeSearch();
              e.currentTarget.blur();
            }}
            onBlur={() => { if (!query) setSearchOpen(false); }}
            placeholder={t("sidebar.search")}
            aria-label={t("sidebar.searchAria")}
            className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-tertiary focus:outline-none"
          />
          {showSearch && <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={closeSearch}
            aria-label={t("sidebar.searchClose")}
            title={t("sidebar.searchClose")}
            className="flex size-5 shrink-0 items-center justify-center rounded text-ink-tertiary hover:text-ink"
          >
            <X size={13} aria-hidden="true" />
          </button>}
        </div>
      </div>}

      {density === "icons" && <SidebarTodayNav density={density} />}
      {density === "icons" && <SidebarInboxNav density={density} />}
      {universalPins && pinnedBots.length > 0 && (
        <div
          data-sidebar-universal-pins=""
          // vh, not %: a percentage has no height to resolve against inside the glass head.
          className="max-h-[min(40vh,280px)] shrink-0 overflow-y-auto border-b border-hairline/40 px-2 pb-2"
        >
          {density !== "icons" && !pinnedCircles && (
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              {t("sidebar.section.pinned")}
            </div>
          )}
          <PinnedBotRoster
            bots={pinnedBots}
            density={density}
            circles={pinnedCircles}
            row={botRow}
            listItem={BotListItem}
          />
        </div>
      )}

      {attentionPinned && density !== "icons" && (
        <SidebarAttentionPanel
          entries={attention}
          density={density}
          onUnpin={() => setAttentionPinned(false)}
          onJump={(entry) => dispatch(attentionJumpAction(entry))}
          collapsed={sectionCollapsed(ATTENTION_SECTION_ID)}
          onToggle={layoutInteractive ? () => toggleSection(ATTENTION_SECTION_ID) : undefined}
        />
      )}

      {density !== "icons" && (
        <SidebarPinnedThreadsPanel
          entries={pinnedThreads}
          density={density}
          now={now}
          onJump={(entry) => dispatch(attentionJumpAction(entry))}
          onUnpin={(entry) => dispatch(attentionUnpinAction(entry))}
          collapsed={sectionCollapsed(PINNED_THREADS_SECTION_ID)}
          onToggle={layoutInteractive ? () => toggleSection(PINNED_THREADS_SECTION_ID) : undefined}
        />
      )}
      {/* Pinned bots never leave: they sit with search above the list, and only the rows below scroll. */}
      {heroBots.length > 0 && <div data-sidebar-hero-fixed="" className="px-2 pt-0.5"><PinnedHero bots={heroBots} onMenu={setMenu} /></div>}
      {railBoss && <div data-sidebar-rail-boss="" className="px-2 pb-1 pt-1">
        <div className="rounded-2xl bg-white/[0.05]"><BotListItem {...botRow(railBoss)} flat /></div>
        <div aria-hidden="true" className="mx-3 mt-2 h-px bg-hairline/50" />
      </div>}
      </GlassBar>

      {!collapseToIcons && <div
        role="separator"
        aria-label={t("sidebar.resize")}
        aria-orientation="vertical"
        aria-valuemin={density === "icons" ? SIDEBAR_RAIL_WIDTH : 240}
        aria-valuemax={density === "icons" ? SIDEBAR_RAIL_WIDTH : maxSidebarWidth}
        aria-valuenow={density === "icons" ? SIDEBAR_RAIL_WIDTH : Math.min(sidebarWidth ?? defaultWidth, maxSidebarWidth)}
        tabIndex={0}
        data-sidebar-resize
        data-dragging={resizing ? "" : undefined}
        className={SIDEBAR_RESIZE_HANDLE_CLASS}
        style={windowNoDragStyle}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { from: density === "icons" ? "rail" : "list", x: event.clientX - (sidebarRef.current?.getBoundingClientRect().left ?? 0), startWidth: widthRef.current };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const x = event.clientX - (sidebarRef.current?.getBoundingClientRect().left ?? 0);
          dragRef.current.x = x;
          if (dragRef.current.from === "rail") return;
          const next = resizeTo(x);
          if (next !== null) event.currentTarget.setAttribute("aria-valuenow", String(next));
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const release = dividerRelease(dragRef.current.from, dragRef.current.x);
          if (release === "expand") {
            setResizing(false);
            setSidebarDensity(lastExpandedDensity);
            return;
          }
          if (release === "collapse") {
            widthRef.current = dragRef.current.startWidth;
            sidebarRef.current?.style.setProperty("--sidebar-width", `${widthRef.current ?? defaultWidth}px`);
          }
          finishResize();
          if (release === "collapse") setSidebarDensity("icons");
        }}
        onPointerCancel={finishResize}
        onKeyDown={(event) => {
          if (density === "icons") {
            if (event.key !== "ArrowRight" && event.key !== "Enter") return;
            event.preventDefault();
            setSidebarDensity(lastExpandedDensity);
            return;
          }
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const limit = sidePanelOpen ? defaultWidth : Math.min(480, window.innerWidth - 320);
          const next = resizeTo(Math.min(widthRef.current ?? defaultWidth, limit) + (event.key === "ArrowRight" ? 16 : -16));
          if (next === null) return;
          setSidebarWidth(next);
          saveSidebarWidth(next);
        }}
      />}

      <GlassScroller className="px-2">
        <div className="flex flex-col gap-0.5">
          {!state.hydrated && state.bots.length === 0 && density !== "icons" && <SkeletonRows />}
          {matchingBots.length === 0 && visibleGroups.length === 0 && q && q.length < MIN_QUERY && (
            <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">{t("sidebar.noMatch", { query })}</div>
          )}
          {flatList && flatItems.map((item) => item.kind === "bot"
            ? <BotListItem key={`bot:${item.bot.id}`} {...botRow(item.bot)} flat />
            : (
              <GroupListItem
                key={`group:${item.group.id}`}
                flat
                waiting={item.waiting}
                group={item.group}
                density={density}
                quiet={quietRows}
                query={q}
                onMenu={setRoomMenu}
              />
            ))}
          {!flatList && topChief && (
            <div data-sidebar-chief="" className="mb-2 rounded-xl border border-accent/25 bg-accent/[0.06] p-0.5">
              {density !== "icons" && (
                <div className="px-2.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-accent-text">{t("sidebar.chief")}</div>
              )}
              <BotListItem {...botRow(topChief)} />
            </div>
          )}
          {!flatList && sectionIds.map((id, index) => {
            const sectionName = userSectionName(id);
            const sectionChiefItems = sectionName
              ? sectionChiefs.filter((bot) => bot.section === sectionName && bot.id !== topChief?.id)
              : [];
            const sectionGroupItems =
              id === CHANNELS_SECTION_ID
                ? unsectionedRooms
                : id === BOT_CHATS_SECTION_ID
                  ? botChats
                  : sectionName
                    ? sectionedRooms.filter((group) => group.section === sectionName)
                    : [];
            const sectionBotItems =
              id === PINNED_SECTION_ID
                ? pinnedBots
                : id === BOTS_SECTION_ID
                  ? unsectionedBots
                  : sectionName
                    ? sectionedBots.filter((bot) => bot.section === sectionName)
                    : [];
            const collapsed = sectionCollapsed(id);
            const queued = collapsed ? [...sectionChiefItems, ...sectionBotItems].flatMap((bot) =>
              sidebarBotActivityTasks(bot, state.pendingQueued).filter((task) => task.queued).map((task) => `${bot.name}: ${task.title}`)) : [];
            const attention = collapsed
              ? sidebarSectionAttention(
                  [...sectionChiefItems, ...sectionBotItems],
                  sectionGroupItems,
                )
              : undefined;
            return (
              <div
                key={id}
                data-sidebar-section-id={id}
                onDragOver={(event) => updateSectionDropTarget(event, id)}
                onDrop={dropSection}
                className={cn(
                  "flex flex-col gap-0.5",
                  density !== "icons" && index > 0 && "pt-3",
                )}
              >
                {dropTarget?.id === id && dropTarget.place === "before" && draggingSectionId !== id && (
                  <div className="mx-2 h-0.5 rounded-full bg-accent" />
                )}
                {density !== "icons" && (
                  <SidebarSectionHeader
                    name={sectionLabel(id)}
                    onContextMenu={!remoteClient && layoutInteractive && sectionName ? (event) => {
                      event.preventDefault();
                      openTeamMenu(sectionName, event.clientX, event.clientY, event.currentTarget.querySelector<HTMLElement>("button") ?? event.currentTarget);
                    } : undefined}
                    collapsed={collapsed}
                    attention={attention}
                    onToggle={layoutInteractive ? () => toggleSection(id) : undefined}
                    reorderable={layoutInteractive && sectionIds.length > 1}
                    dragging={draggingSectionId === id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-nordus-sidebar-section", id);
                      event.dataTransfer.setData("text/plain", id);
                      sectionDragRef.current = { from: id, over: null };
                      setDraggingSectionId(id);
                    }}
                    onDragEnd={resetSectionDrag}
                    onMove={(direction) => moveSidebarSection(id, direction)}
                    onDelete={!remoteClient && sectionName ? () => setDeletingTeam(sectionName) : undefined}
                  />
                )}
                {collapsed && queued.length > 0 && <button type="button" onClick={() => toggleSection(id)}
                  title={`${t("task.queued")} · ${queued.join(", ")}`} aria-label={`${t("sidebar.section.expand", { name: sectionLabel(id) })} · ${t("task.queued")} · ${queued.join(", ")}`}
                  className="mx-3 mb-1 inline-flex h-7 items-center self-start rounded-full bg-raised/50 px-3 text-[13px] font-medium leading-4 text-ink-secondary hover:text-ink">{t("task.queued")} · {queued.length}</button>}
                {!collapsed && (
                  <>
                    {sectionChiefItems.map((bot) => <BotListItem key={bot.id} {...botRow(bot)} />)}
                    {sectionGroupItems.map((group) => (
                      <GroupListItem
                        key={group.id}
                        group={group}
                        density={density}
                        quiet={quietRows}
                        query={q}
                        onMenu={setRoomMenu}
                      />
                    ))}
                    {id === PINNED_SECTION_ID ? (
                      <PinnedBotRoster
                        bots={sectionBotItems}
                        density={density}
                        circles={pinnedCircles}
                        row={botRow}
                        listItem={BotListItem}
                      />
                    ) : sectionBotItems.map((bot) => <BotListItem key={bot.id} {...botRow(bot)} />)}
                    {!remoteClient && sectionName && layoutInteractive && (
                      <button onClick={() => setMoveToTeam(sectionName)} aria-label={t(state.bots.some(bot => !bot.hidden && bot.section?.trim() === sectionName) ? "team.manageBotsIn" : "team.addBotsTo", { name: sectionName })}
                        className="mx-3 my-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink">
                        <Plus size={13} /> {t(state.bots.some(bot => !bot.hidden && bot.section?.trim() === sectionName) ? "team.manageBots" : "team.addBots")}
                      </button>
                    )}
                  </>
                )}
                {dropTarget?.id === id && dropTarget.place === "after" && draggingSectionId !== id && (
                  <div className="mx-2 h-0.5 rounded-full bg-accent" />
                )}
              </div>
            );
          })}
          {!query && <DirectMessagesBlock density={density} />}
          <SearchResults query={query} onLanded={() => { setQuery(""); setSearchOpen(false); }} />
          {showPinnedCircleThreads && (
            <PinnedCircleThreadSection
              bots={pinnedBots}
              collapsed={pinnedCircleThreadsCollapsed}
              onToggle={() => setPinnedCircleThreadsCollapsed((collapsed) => !collapsed)}
              row={botRow}
            />
          )}
        </div>
      </GlassScroller>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement}
      </p>

      <GlassBar edge="bottom">
      <LiveCallPill
        currentBotId={state.activeView === "chat" ? state.selectedId : null}
        onOpen={(botId, threadId) => openThread(dispatch, { botId, threadId }, state, showThreads)}
        iconOnly={density === "icons"}
      />

      <div className={cn("pb-3 pt-2", density === "icons" ? "flex flex-col items-center gap-1 px-2" : "px-3")}>
        {(advanced || density === "icons") && <SidebarBoardNav density={density} />}
        <SidebarFooterNav
          density={density}
          omitApps
          collapsed={sectionCollapsed(TOOLS_SECTION_ID)}
          onToggleCollapsed={layoutInteractive ? () => toggleSection(TOOLS_SECTION_ID) : undefined}
        />
        {density === "icons" && (
          <SidebarPhoneButton
            density={density}
            onOpen={() => dispatch(phoneSettingsAction())}
          />
        )}
        {density === "icons" ? (
          <div data-sidebar-rail-foot="" className="relative flex flex-col items-center justify-center gap-2 pt-1">
            {renderPlus(true)}
            <SidebarAppsButton pill />
            <SidebarProfileMenu avatarOnly />
          </div>
        ) : (
          <>
          <div className="flex items-center gap-2 not-first:mt-3">
            <SidebarProfileMenu avatarOnly />
            <SidebarAppsButton wide />
            {!advanced && <SidebarToolsMenu />}
            <SidebarSettingsButton />
          </div>
          </>
        )}
      </div>
      </GlassBar>
      </GlassScrollFrame>

      <BotContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onArchive={requestArchive}
          onDelete={(bot) => setConfirm({ kind: "delete", bot })}
          onMoveToSection={(botId) => {
            if (!menu) return;
            setSectionPicker({ botId, x: menu.x, y: menu.y });
          }}
          onNewFolder={setNewFolderBotId}
          onNewTaskFolder={setNewTaskFolderBotId}
        />
      {showThreads && newFolderBotId && state.bots.find((bot) => bot.id === newFolderBotId) && <BotProjectDialog bot={state.bots.find((bot) => bot.id === newFolderBotId)!} onClose={() => setNewFolderBotId(null)} />}
      {showThreads && newTaskFolderBot && <NewTaskFolderDialog bot={newTaskFolderBot} onClose={() => setNewTaskFolderBotId(null)} onReturnFocus={() => {
        sidebarRef.current?.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(newTaskFolderBot.id)}"]`)?.focus();
      }} />}
      <ConfirmDialog
        open={confirm !== null}
        {...(confirm ? botConfirmCopy(confirm.kind, confirm.bot.name) : botConfirmCopy("archive", ""))}
        icon={confirm?.kind === "delete" ? <Trash2 size={18} /> : <Archive size={18} />}
        onCancel={cancelConfirm}
        returnFocusRef={sidebarRef}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, bot } = confirm;
          setConfirm(null);
          if (kind === "archive") void archiveBot(bot);
          else dispatch({ type: "deleteBot", botId: bot.id });
        }}
      />
      {newTeam && <TeamDialog onClose={() => setNewTeam(false)} />}
      {renameTeam && <TeamDialog section={renameTeam} rename onRenamed={renamedTeam} onClose={() => setRenameTeam(null)} />}
      {teamMotion.shown && teamMotion.value && createPortal(<div className={cn("fixed inset-0 z-40", teamMotion.closing && "pointer-events-none")} onMouseDown={closeTeamMenu}>
        <div role="menu" aria-label={teamMotion.value.name} style={{ left: teamMotion.value.x, top: teamMotion.value.y }}
          className={cn("absolute w-[256px] rounded-xl border border-hairline/50 bg-menu p-1.5 text-ink shadow-xl", teamMotion.className)} {...teamMotion.exitProps}
          onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeTeamMenu(); return; }
            navigateThreadMenu(event);
          }}>
          <TeamMenuItems
            onAddBots={() => { closeTeamMenu(); setMoveToTeam(teamMotion.value!.name); }}
            onRename={() => { closeTeamMenu(); setRenameTeam(teamMotion.value!.name); }}
            onShare={() => { closeTeamMenu(); setShareTeam(teamMotion.value!.name); }}
            onDelete={() => { closeTeamMenu(); setDeletingTeam(teamMotion.value!.name); }}
            onSetForAll={teamSettingsAllowed === true ? () => { closeTeamMenu(); setTeamSettings(teamMotion.value!.name); } : undefined}
          />
        </div>
      </div>, document.body)}
      <ConfirmDialog open={deletingTeam !== null} title={t("team.deleteTitle", { name: deletingTeam ?? "" })}
        body={t("team.deleteKeepBotsDescription")} confirmLabel={t("team.delete")} returnFocusRef={sidebarRef}
        pending={teamDeletePending}
        onCancel={() => { if (!teamDeleteRunning.current) setDeletingTeam(null); }} onConfirm={() => {
          const name = deletingTeam;
          if (!name || teamDeleteRunning.current) return;
          teamDeleteRunning.current = true;
          setTeamDeletePending(true);
          void api(`/api/sidebar-sections?section=${encodeURIComponent(name)}`, { method: "DELETE" })
            .then(({ sections }) => { dispatch({ type: "sectionDeleted", section: name, sections }); setDeletingTeam(null); })
            .catch(cause => setTeamFeedback({ error: true, text: cause instanceof Error ? cause.message : String(cause) }))
            .finally(() => { teamDeleteRunning.current = false; setTeamDeletePending(false); });
        }} />
      {moveToTeam && <TeamDialog section={moveToTeam} onClose={() => setMoveToTeam(null)} />}
      {shareTeam !== null && <ShareTeamDialog team={shareTeam} onClose={() => setShareTeam(null)} />}
      {teamSettings !== null && <TeamSettingsDialog team={teamSettings} onClose={() => setTeamSettings(null)} />}
      <BotTagPicker />
      <SectionPicker
          current={sectionPicker ? state.bots.find((b) => b.id === sectionPicker.botId)?.section : undefined}
          anchor={sectionPicker}
          onClose={() => setSectionPicker(null)}
          onAssign={(section) => {
            if (!sectionPicker) return;
            if (!remoteClient) {
              dispatch({ type: "updateBot", botId: sectionPicker.botId, patch: { section } });
              return;
            }
            void api("/api/sidebar-sections", {
              method: "POST",
              body: JSON.stringify({ name: section, botIds: [sectionPicker.botId] }),
            })
              .then(({ bots }) => bots.forEach((bot: Bot) => dispatch({ type: "botPatched", bot })))
              .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
          }}
        />
      <RoomContextMenu
          menu={roomMenu}
          onClose={() => setRoomMenu(null)}
          onMoveToSection={(groupId) => {
            if (!roomMenu) return;
            setRoomSectionPicker({ groupId, x: roomMenu.x, y: roomMenu.y });
          }}
          onDelete={(groupId) => {
            sidebarRef.current?.focus();
            setDeletingRoomId(groupId);
          }}
        />
      <ConfirmDialog
        open={deletingRoom !== undefined}
        {...roomDeleteCopy(deletingRoom ?? { name: "" })}
        icon={<Trash2 size={18} />}
        returnFocusRef={sidebarRef}
        onCancel={() => setDeletingRoomId(null)}
        onConfirm={() => {
          // Read the room from live state: it may have been removed while the dialog was open.
          const groupId = deletingRoom?.id;
          setDeletingRoomId(null);
          if (groupId) dispatch({ type: "deleteGroup", groupId });
        }}
      />
      <SectionPicker
          current={roomSectionPicker ? state.groups.find((g) => g.id === roomSectionPicker.groupId)?.section : undefined}
          anchor={roomSectionPicker}
          onClose={() => setRoomSectionPicker(null)}
          onAssign={(section) => {
            if (!roomSectionPicker) return;
            dispatch({ type: "patchGroup", groupId: roomSectionPicker.groupId, patch: { section } });
          }}
        />
      {newRoom && <NewRoomPanel onClose={() => setNewRoom(false)} />}
      {/* Portaled: below md the sidebar's translate makes it the containing block for fixed children. */}
      {newChatOpen && createPortal(
        <SidebarNewChatPanel
          anchor={sidebarRef.current}
          style={windowNoDragStyle}
          onClose={() => setNewChatOpen(false)}
          onNewBot={() => { setNewChatOpen(false); dispatch({ type: "toggleNewBot", open: true }); }}
          onNewGroup={() => { setNewChatOpen(false); setNewRoom(true); }}
        />,
        document.body,
      )}
      {!remoteClient && archivedBotsOpen && (
        <ArchivedBotsPanel
          bots={archivedBots}
          onClose={() => setArchivedBotsOpen(false)}
          onRestored={(message) => setTeamFeedback({ error: false, text: message })}
        />
      )}
      {!remoteClient && teamLibraryOpen && (
        <TeamLibraryPanel
          returnFocusRef={importReturnRef}
          initialUrl={teamInstallUrl ?? undefined}
          onClose={() => {
            setTeamLibraryOpen(false);
            setTeamInstallUrl(null);
          }}
          onImported={(result) => {
            setTeamLibraryOpen(false);
            setTeamInstallUrl(null);
            setTeamFeedback({
              error: false,
              text:
                (result.members === 0 && result.presets
                  ? t("sidebar.presetsImported", { count: result.presets })
                  : result.members === 1
                  ? t("sidebar.teamImportedOne")
                  : t("sidebar.teamImportedMany", { count: result.members })) +
                (result.connections ? ` · ${t("sidebar.connectionsToFinish", { count: result.connections })}` : ""),
            });
          }}
        />
      )}
      {teamFeedback &&
        createPortal(
          <div
            role="status"
            className={cn(
              "fixed bottom-4 left-4 z-[60] max-w-[300px] rounded-xl border px-3.5 py-2.5 text-[13px] shadow-xl",
              teamFeedback.error
                ? "border-danger/30 bg-card text-danger"
                : "border-hairline/50 bg-card text-ink",
            )}
          >
            <div className="flex items-center gap-3">
              <span>{teamFeedback.text}</span>
              {pendingBotUndo && (
                <button
                  onClick={() => void undoBotArchive(pendingBotUndo)}
                  className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-raised"
                >
                  {t("common.undo")}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
}

/** The Boss for the avatar rail's tile, and everyone else for its list. */
export function splitRailBoss(bots: readonly Bot[]): { boss: Bot | null; rest: Bot[] } {
  const boss = bots.find((bot) => bot.chiefOfStaff && !bot.hidden) ?? null;
  return { boss, rest: bots.filter((bot) => bot !== boss) };
}

/** Pinned bots and the Boss, like Grok: alone at the top, centred, a large round avatar with the name below. Only the
 *  Boss carries the orange star; the status dot sits at the opposite corner. */
function PinnedHero({ bots, onMenu }: { bots: Bot[]; onMenu: (menu: MenuState) => void }) {
  const size = bots.length <= 2 ? 58 : bots.length === 3 ? 52 : 46;
  return (
    <div data-pinned-hero="" className="flex justify-center gap-5 px-2">
      {bots.map((bot) => <PinnedHeroBot key={bot.id} bot={bot} size={size} onMenu={onMenu} />)}
    </div>
  );
}

/** What a working bot's hover bubble says: the conversation it works in, then the step it is on. A conversation still
 *  called "New conversation" says nothing, so the step leads instead. */
export function workBubbleLines(tasks: readonly Task[], step: string | null): { main: string; step: string | null } | null {
  const doing = tasks.filter((task) => task.busy || task.activity === "working");
  const named = doing.map((task) => localizedTaskTitle(task.title?.trim() ?? "")).filter((title): title is string => Boolean(title) && title !== t("task.newShort"));
  const main = named[0] ? (named.length > 1 ? `${named[0]} +${named.length - 1}` : named[0]) : step;
  if (!main) return null;
  return { main, step: named[0] && step && step !== named[0] ? step : null };
}

function PinnedHeroBot({ bot, size, onMenu }: { bot: Bot; size: number; onMenu: (menu: MenuState) => void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { waiting, waitingBot, waitingThreadId, teamWork, teamWorkWhere, teamWorkOthers } = botWait(state.bots, bot, state.selectedId, state.groups);
  const ownWorking = botWorkingIn(bot, sidebarBotActivityTasks(bot, state.pendingQueued));
  const estado = useRowRoboEstado(bot, state.instances, waiting, ownWorking || Boolean(teamWork));
  const robo = useRef<RoboSvg | null>(null);
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  return (
    <button
      type="button"
      data-pinned-hero-bot={bot.id}
      title={ownWorking ? undefined : teamWorkWhere}
      aria-current={selected ? "page" : undefined}
      onClick={() => { waveRobot(robo.current); openWhereBotWaits(dispatch, waitingBot, waitingThreadId, showThreads); }}
      onContextMenu={(event) => openBotContextMenu(onMenu, bot.id, event)}
      onMouseEnter={() => robo.current?.nbAvatar?.acordar(true)}
      onMouseLeave={() => robo.current?.nbAvatar?.acordar(false)}
      className="flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      style={{ width: size + 24 }}
    >
      <span className="relative">
        <span className={cn("block rounded-full", selected && "ring-2 ring-white/25 ring-offset-2 ring-offset-[var(--color-panel)]")}>
          <BotAvatar bot={bot} estado={estado} ativo={selected} roboRef={robo} size={size} />
        </span>
        {bot.chiefOfStaff && (
          <span data-boss-star="" className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-accent ring-2 ring-[var(--color-panel)]" title={t("sidebar.bot.chiefOfStaff")}>
            <Star size={10} strokeWidth={2.5} className="fill-[var(--color-accent-ink)] text-[var(--color-accent-ink)]" aria-hidden="true" />
          </span>
        )}
        <StatusDot estado={estado} className="absolute bottom-1 left-1 size-2 ring-2 ring-[var(--color-panel)]" />
      </span>
      <span className="nb-name max-w-full truncate text-[12.5px] leading-4 text-ink">{bot.name}</span>
      {bot.tag && <span className="-mt-1 max-w-full truncate text-[9px] font-medium uppercase leading-3 tracking-[0.05em] text-ink-tertiary">{bot.tag}</span>}
      {!waiting && !ownWorking && teamWork && (
        <span className="-mt-0.5 flex max-w-full items-center gap-1 text-[10.5px] leading-[14px] text-ink-secondary">
          <span data-hero-step="" className="truncate">{teamWork}</span>
          {teamWorkOthers ? <span className="shrink-0 text-ink-tertiary">+{teamWorkOthers}</span> : null}
        </span>
      )}
    </button>
  );
}
