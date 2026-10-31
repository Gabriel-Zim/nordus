import { BookOpen, FolderOpen, HardDrive, LayoutGrid, Link2, Puzzle, Settings, SquareKanban, Sun, UsersRound, Zap, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useAppTriggers } from "@/lib/app-triggers";
import { cn } from "@/lib/cn";
import { useCloudFilesReady } from "@/lib/cloud-files";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { isRoutineProblemRun } from "@/lib/routines";
import { useSidebarToolsLayout, type SidebarDensity } from "@/lib/sidebar-preferences";
import { useGuest } from "@/lib/use-viewer";
import { useStore } from "@/state/store";

import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { SidebarSectionHeader } from "./SidebarSectionHeader";


const PRELOAD: Record<string, string> = { routines: "routines", apps: "plugins", triggers: "triggers", "team-map": "team-map", files: "files", board: "board", drive: "drive", wiki: "wiki" };

function NavRow({
  id,
  label,
  icon,
  active = false,
  attention = false,
  iconsOnly,
  rail = false,
  tourId,
  onClick,
}: {
  id: string;
  label: string;
  icon: (active: boolean) => ReactNode;
  active?: boolean;
  attention?: boolean;
  iconsOnly: boolean;
  rail?: boolean;
  tourId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tour={tourId}
      data-sidebar-nav={id}
      data-preload={PRELOAD[id]}
      onClick={onClick}
      aria-label={iconsOnly ? label : undefined}
      title={iconsOnly ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center rounded-xl transition-colors",
        rail ? "size-9 shrink-0 justify-center" : iconsOnly ? "mx-auto size-[46px] shrink-0 justify-center" : "w-full min-h-9 gap-3 px-3 py-1.5 text-left",
        active ? "bg-raised text-ink" : "text-ink hover:bg-raised/50",
      )}
    >
      {icon(active)}
      {!iconsOnly && <span className="flex-1 truncate text-[14px] font-medium leading-5">{label}</span>}
      {attention && (
        <span
          data-testid="routines-attention"
          className={cn("size-2 shrink-0 rounded-full bg-danger", iconsOnly && (rail ? "absolute right-1 top-1" : "absolute right-2 top-2"))}
        />
      )}
    </button>
  );
}

/** The Today page, at the top of the sidebar in every mode, like an inbox. */
export function SidebarTodayNav({ density, inline = false }: { density: SidebarDensity; /** A small quiet link on the list's top row. */ inline?: boolean }) {
  const { state, dispatch } = useStore();
  const iconsOnly = density === "icons";
  const active = state.activeView === "today";
  if (inline) {
    return (
      <button
        type="button"
        data-sidebar-nav="today"
        aria-current={active ? "page" : undefined}
        onClick={() => dispatch({ type: "showToday" })}
        className={cn("truncate pl-1 text-left text-[12px] font-medium transition-colors", active ? "text-ink" : "text-ink-tertiary hover:text-ink-secondary")}
      >
        {t("sidebar.nav.today")}
      </button>
    );
  }
  return (
    <div className={iconsOnly ? "flex justify-center px-2 pb-1" : "px-2 pb-2"}>
      <NavRow
        id="today"
        label={t("sidebar.nav.today")}
        iconsOnly={iconsOnly}
        active={active}
        icon={(on) => <Sun size={iconsOnly ? 20 : 18} className={on ? "text-accent" : "text-ink-secondary"} />}
        onClick={() => dispatch({ type: "showToday" })}
      />
    </div>
  );
}

export function SidebarBoardNav({ density }: { density: SidebarDensity }) {
  const { state, dispatch } = useStore();
  const iconsOnly = density === "icons";
  return (
    <div className={cn("pb-1", iconsOnly && "flex justify-center")}>
      <NavRow
        id="board"
        label={t("sidebar.nav.board")}
        iconsOnly={iconsOnly}
        active={state.activeView === "board"}
        icon={(on) => <SquareKanban size={iconsOnly ? 20 : 18} className={on ? "text-accent" : "text-ink-secondary"} />}
        onClick={() => dispatch({ type: "showBoard" })}
      />
    </div>
  );
}

/** "Conectar apps": a wide frosted-glass pill with the apps people connect most, slightly stacked. */
export function SidebarAppsButton({ wide = false, pill = false }: { wide?: boolean; /** The avatar rail's round glass button. */ pill?: boolean } = {}) {
  const { state, dispatch } = useStore();
  const label = t("sidebar.nav.apps");
  if (wide) {
    return (
      <button
        type="button"
        data-tour="nav-apps"
        data-sidebar-nav="apps"
        data-preload="plugins"
        onClick={() => dispatch({ type: "togglePlugins", open: true })}
        aria-pressed={state.pluginsOpen}
        aria-label={t("sidebar.nav.connectApps")}
        title={t("sidebar.nav.connectApps")}
        className="nb-pill flex h-[40px] min-w-0 flex-1 items-center justify-center gap-2.5 rounded-full px-4 text-[13.5px] font-medium text-ink transition-colors"
      >
        <Link2 size={17} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
          <img loading="lazy" decoding="async" src="/brand/googledrive.svg" alt="" className="size-[15px]" />
          <img loading="lazy" decoding="async" src="/brand/github.svg" alt="" data-app-mark="github" className="size-[15px]" />
          <img loading="lazy" decoding="async" src="/brand/zimstudio.svg" alt="" className="size-[15px] rounded-[4px] object-cover" />
        </span>
      </button>
    );
  }
  if (pill) {
    return (
      <button
        type="button"
        data-tour="nav-apps"
        data-sidebar-nav="apps"
        data-preload="plugins"
        onClick={() => dispatch({ type: "togglePlugins", open: true })}
        aria-label={label}
        title={label}
        aria-pressed={state.pluginsOpen}
        className={cn(
          "nb-pill flex size-[40px] shrink-0 items-center justify-center rounded-full transition-colors",
          state.pluginsOpen ? "nb-pill-open text-accent" : "text-ink-secondary hover:text-ink",
        )}
      >
        <Puzzle size={18} />
      </button>
    );
  }
  return (
    <button
      type="button"
      data-tour="nav-apps"
      data-sidebar-nav="apps"
      data-preload="plugins"
      onClick={() => dispatch({ type: "togglePlugins", open: true })}
      aria-label={label}
      title={label}
      aria-pressed={state.pluginsOpen}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
        state.pluginsOpen ? "bg-raised text-accent" : "text-ink-secondary hover:bg-raised/50 hover:text-ink",
      )}
    >
      <Puzzle size={18} />
    </button>
  );
}

/** An unseen failed run, or an app trigger in trouble. */
function useAutomationsNeedYou(): boolean {
  const { state } = useStore();
  const appTriggers = useAppTriggers();
  return state.routineRuns.some((run) => isRoutineProblemRun(run) && !run.seenAt) || appTriggers.triggers.some((trigger) => trigger.enabled && trigger.problem);
}

/** Simple mode's one round button beside Apps: Tasks, Drive, Wiki, Files, Automations and Team map open from its menu, so
 * the sidebar itself is only the chats. Advanced mode lists them as rows under Tools instead. */
export function SidebarToolsMenu() {
  const { state, dispatch } = useStore();
  const guest = useGuest();
  const filesReady = useCloudFilesReady();
  const automationsNeedYou = useAutomationsNeedYou();
  const place = (key: string, label: string, Icon: LucideIcon, tint: string, view: string, onSelect: () => void, tourId?: string): SidebarMenuItem =>
    ({ key, label, icon: <Icon size={21} strokeWidth={1.9} />, tint, active: state.activeView === view, onSelect, tourId });
  const items: SidebarMenuItem[] = [
    place("board", t("sidebar.nav.board"), SquareKanban, "#8b5cf6", "board", () => dispatch({ type: "showBoard" })),
    place("drive", t("drive.nav"), HardDrive, "#0ea5e9", "drive", () => dispatch({ type: "showDrive" })),
    place("wiki", t("wiki.nav"), BookOpen, "#f59e0b", "wiki", () => dispatch({ type: "showWiki" })),
    ...(filesReady ? [place("files", t("sidebar.nav.files"), FolderOpen, "#64748b", "files", () => dispatch({ type: "showFiles" }))] : []),
    ...(guest ? [] : [
      { ...place("automations", t("sidebar.nav.automations"), Zap, "#f97316", "routines", () => dispatch({ type: "showRoutines", view: "list" }), "nav-automations"), attention: automationsNeedYou },
      place("team-map", t("sidebar.nav.teamMap"), UsersRound, "#10b981", "team-map", () => dispatch({ type: "showTeamMap" }), "team-tools"),
    ]),
  ];
  const label = t("sidebar.tools");
  const current = items.some((item) => item.active);
  return (
    <SidebarPopoverMenu
      items={items}
      ariaLabel={label}
      triggerTitle={label}
      triggerTour="tools"
      layout="grid"
      title={label}
      triggerClassName="shrink-0 rounded-full"
      renderTrigger={({ open }) => (
        <span
          data-sidebar-nav="tools"
          className={cn(
            "nb-pill relative flex size-[40px] items-center justify-center rounded-full transition-colors",
            open || current ? "nb-pill-open text-accent" : "text-ink-secondary hover:text-ink",
          )}
        >
          <LayoutGrid size={18} aria-hidden="true" />
          {automationsNeedYou && !guest && <span data-testid="routines-attention" className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-app" />}
        </span>
      )}
    />
  );
}

export function SidebarFooterNav({
  density,
  rail = false,
  collapsed = false,
  onToggleCollapsed,
  omitApps = false,
}: {
  density: SidebarDensity;
  rail?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** The avatar rail draws Apps itself, beside New and the profile. */
  omitApps?: boolean;
}) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const guest = useGuest();
  const iconsOnly = density === "icons";
  const toolsLayout = useSidebarToolsLayout();
  const toolbar = advanced && !iconsOnly && toolsLayout === "toolbar";
  const iconSize = iconsOnly && !rail ? 20 : 18;
  const tone = (active: boolean) => (active ? "text-accent" : "text-ink-secondary");
  const automationsNeedYou = useAutomationsNeedYou();
  const automationsRow = <NavRow
    id="automations"
    label={t("sidebar.nav.automations")}
    tourId="nav-automations"
    iconsOnly={iconsOnly || toolbar}
    rail={rail}
    active={state.activeView === "routines"}
    attention={automationsNeedYou}
    icon={(active) => <Zap size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "showRoutines", view: "list" })}
  />;
  const filesRow = useCloudFilesReady() && <NavRow
    id="files"
    label={t("sidebar.nav.files")}
    iconsOnly={iconsOnly}
    rail={rail}
    active={state.activeView === "files"}
    icon={(active) => <FolderOpen size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "showFiles" })}
  />;
  const knowledgeRows = <>
    <NavRow
      id="drive"
      label={t("drive.nav")}
      iconsOnly={iconsOnly || toolbar}
      rail={rail}
      active={state.activeView === "drive"}
      icon={(active) => <HardDrive size={iconSize} className={tone(active)} />}
      onClick={() => dispatch({ type: "showDrive" })}
    />
    <NavRow
      id="wiki"
      label={t("wiki.nav")}
      iconsOnly={iconsOnly || toolbar}
      rail={rail}
      active={state.activeView === "wiki"}
      icon={(active) => <BookOpen size={iconSize} className={tone(active)} />}
      onClick={() => dispatch({ type: "showWiki" })}
    />
  </>;
  if (!advanced && !iconsOnly) return null;

  const rows = (
    <>
      {!guest && automationsRow}
      {iconsOnly && !omitApps && <NavRow
        id="apps"
        label={t("sidebar.nav.apps")}
        tourId="nav-apps"
        iconsOnly={iconsOnly}
        rail={rail}
        active={state.pluginsOpen}
        icon={(active) => <Puzzle size={iconSize} className={tone(active)} />}
        onClick={() => dispatch({ type: "togglePlugins", open: true })}
      />}
      {(advanced || iconsOnly) && !guest && (
        <NavRow
          id="team-map"
          label={t("sidebar.nav.teamMap")}
          tourId="team-tools"
          iconsOnly={iconsOnly || toolbar}
          rail={rail}
          active={state.activeView === "team-map"}
          icon={(active) => <UsersRound size={iconSize} className={tone(active)} />}
          onClick={() => dispatch({ type: "showTeamMap" })}
        />
      )}
      {filesRow}
      {knowledgeRows}
    </>
  );

  if (iconsOnly) {
    return <nav data-tour="tools" aria-label={t("sidebar.tools")} className={cn("flex flex-col items-center", rail ? "gap-0.5" : "gap-1")}>{rows}</nav>;
  }
  return (
    <div data-tour="tools">
      <SidebarSectionHeader
        name={t("sidebar.tools")}
        collapsed={collapsed}
        alert={collapsed && automationsNeedYou}
        onToggle={onToggleCollapsed}
        reorderable={false}
        dragging={false}
      />
      {!collapsed && <nav aria-label={t("sidebar.tools")} className={toolbar ? "flex flex-row gap-1" : "flex flex-col gap-0.5"}>{rows}</nav>}
    </div>
  );
}

/** "Ajustes": the app's settings, beside Link at the foot of the list. */
export function SidebarSettingsButton() {
  const { state, dispatch } = useStore();
  return (
    <button
      type="button"
      data-sidebar-nav="settings"
      onClick={() => dispatch({ type: "toggleAppSettings" })}
      aria-pressed={state.appSettingsOpen}
      className="nb-pill flex h-[40px] shrink-0 items-center justify-center gap-2 rounded-full px-4 text-[13.5px] font-medium text-ink transition-colors"
    >
      <Settings size={16} aria-hidden="true" className="text-ink-secondary" />
      <span>{t("sidebar.nav.settingsShort")}</span>
    </button>
  );
}
