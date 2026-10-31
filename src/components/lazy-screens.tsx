import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { loadRestOfCatalog, t } from "@/lib/i18n";
import { whenIdleLimited } from "@/lib/idle-queue";

// Not React.lazy: it suspends on every first render even with the chunk loaded (React holds a commit after a fallback
// up to 300 ms) and rethrows a failed import on every render. Chromium keeps a failed import() in its module map and
// rejects every later import of it without refetching.

export type LazyScreen<P> = ((props: P) => ReactNode) & {
  preload: () => Promise<ComponentType<P>>;
};

export function lazyScreen<Props>(
  name: string,
  load: () => Promise<(props: Props) => ReactNode>,
): LazyScreen<NonNullable<Props>> {
  type P = NonNullable<Props>;
  let ready: ComponentType<P> | undefined;
  let loading: Promise<ComponentType<P>> | undefined;
  const preload = () => (loading ??= load().then(
    (component) => (ready = component as ComponentType<P>),
    (error: unknown) => {
      loading = undefined;
      console.warn(`[lazy-screens] ${name} could not be loaded; reloading the window fetches it again.`, error);
      throw error;
    },
  ));
  function Screen(props: P) {
    const [Loaded, setLoaded] = useState(() => ready);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (Loaded) return;
      let live = true;
      void preload().then(
        (component) => { if (live) setLoaded(() => component); },
        () => { if (live) setFailed(true); },
      );
      return () => {
        live = false;
      };
    }, [Loaded]);
    if (Loaded) return <Loaded {...props} />;
    return failed ? <ScreenUnavailable /> : null;
  }
  return Object.assign(Screen, { preload });
}

function ScreenUnavailable() {
  return createPortal(
    <div
      role="alert"
      data-screen-unavailable
      className="fixed bottom-4 left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-danger/30 bg-card px-3.5 py-2.5 text-[13px] text-danger shadow-xl"
    >
      <span>{t("screenLoad.failed")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-raised"
      >
        {t("screenLoad.reload")}
      </button>
    </div>,
    document.body,
  );
}

export const ActivityPanel = lazyScreen("ActivityPanel", async () => (await import("./ActivityPanel")).ActivityPanel);
export const BotSettingsDialog = lazyScreen("BotSettingsDialog", async () => (await import("./BotSettingsDialog")).BotSettingsDialog);
export const ComputerPanel = lazyScreen("ComputerPanel", async () => (await import("./ComputerPanel")).ComputerPanel);
export const FilesView = lazyScreen("FilesView", async () => (await import("./FilesView")).FilesView);
export const InspectorPanel = lazyScreen("InspectorPanel", async () => (await import("./InspectorPanel")).InspectorPanel);
export const KeyboardShortcutsModal = lazyScreen("KeyboardShortcutsModal", async () => (await import("./KeyboardShortcutsModal")).KeyboardShortcutsModal);
export const LocalVmWorkspace = lazyScreen("LocalVmWorkspace", async () => (await import("./LocalVmWorkspace")).LocalVmWorkspace);
export const NewBotDialog = lazyScreen("NewBotDialog", async () => (await import("./NewBotDialog")).NewBotDialog);
export const WelcomeFlow = lazyScreen("WelcomeFlow", async () => (await import("./onboarding/WelcomeFlow")).WelcomeFlow);
export const ChatOnboarding = lazyScreen("ChatOnboarding", async () => (await import("./onboarding/chat/ChatOnboarding")).ChatOnboarding);
export const GuidedTour = lazyScreen("GuidedTour", async () => (await import("./onboarding/GuidedTour")).GuidedTour);
export const FirstConversationTour = lazyScreen("FirstConversationTour", async () => (await import("./onboarding/FirstConversationTour")).FirstConversationTour);
export const PhoneAppDialog = lazyScreen("PhoneAppDialog", async () => (await import("./PhoneAppDialog")).PhoneAppDialog);
export const PluginsPanel = lazyScreen("PluginsPanel", async () => (await import("./PluginsPanel")).PluginsPanel);
export const RemoteAgentSettingsPanel = lazyScreen("RemoteAgentSettingsPanel", async () => (await import("./RemoteAgentSettingsPanel")).RemoteAgentSettingsPanel);
export const RemoteDesktopPanel = lazyScreen("RemoteDesktopPanel", async () => (await import("./remote-desktop-panel")).RemoteDesktopPanel);
export const SettingsModal = lazyScreen("SettingsModal", async () => (await import("./SettingsModal")).SettingsModal);
export const GroupView = lazyScreen("GroupView", async () => (await import("./GroupView")).GroupView);
export const TeamSettingsDialog = lazyScreen("TeamSettingsDialog", async () => (await import("./TeamSettingsDialog")).TeamSettingsDialog);
export const TeamLibraryPanel = lazyScreen("TeamLibraryPanel", async () => (await import("./TeamLibraryPanel")).TeamLibraryPanel);
export const CloudAddDialog = lazyScreen("CloudAddDialog", async () => (await import("./CloudAddDialog")).CloudAddDialog);
export const ShareTeamDialog = lazyScreen("ShareTeamDialog", async () => (await import("./ShareTeamDialog")).ShareTeamDialog);
export const TeamMapPage = lazyScreen("TeamMapPage", async () => (await import("./TeamMapPage")).TeamMapPage);
export const WidgetMessage = lazyScreen("WidgetMessage", async () => (await import("./widget/WidgetMessage")).WidgetMessage);
export const TriggersPage = lazyScreen("TriggersPage", async () => (await import("./TriggersPage")).TriggersPage);
export const TodayPage = lazyScreen("TodayPage", async () => (await import("./TodayPage")).TodayPage);
export const BoardPage = lazyScreen("BoardPage", async () => (await import("./BoardPage")).BoardPage);
export const CreateTaskDialog = lazyScreen("CreateTaskDialog", async () => (await import("./board/CreateTaskDialog")).CreateTaskDialog);
export const InboxPage = lazyScreen("InboxPage", async () => (await import("./InboxPage")).InboxPage);
export const DrivePage = lazyScreen("DrivePage", async () => (await import("./knowledge/DrivePage")).DrivePage);
export const WikiPage = lazyScreen("WikiPage", async () => (await import("./knowledge/WikiPage")).WikiPage);
export const DirectMessageView = lazyScreen("DirectMessageView", async () => (await import("./people/DirectMessageView")).DirectMessageView);

// Screens are fetched when the person shows intent, not at launch: any element with data-preload="a b" names the
// screens it opens, and hovering, focusing or pressing it fetches them (the click then finds them ready).
const INTENT: Record<string, ReadonlyArray<{ preload: () => Promise<unknown> }>> = {
  activity: [ActivityPanel],
  board: [BoardPage],
  "bot-settings": [BotSettingsDialog, RemoteAgentSettingsPanel],
  computer: [ComputerPanel, RemoteDesktopPanel],
  direct: [DirectMessageView],
  files: [FilesView],
  inspector: [InspectorPanel],
  shortcuts: [KeyboardShortcutsModal],
  "local-vm": [LocalVmWorkspace],
  "new-bot": [NewBotDialog],
  plugins: [PluginsPanel],
  routines: [TriggersPage],
  today: [TodayPage],
  inbox: [InboxPage],
  drive: [DrivePage],
  wiki: [WikiPage],
  settings: [SettingsModal],
  group: [GroupView],
  "team-library": [TeamLibraryPanel],
  "team-map": [TeamMapPage],
  triggers: [TriggersPage],
};

if (typeof location !== "undefined" && new URLSearchParams(location.search).has("desktop-settings")) {
  void SettingsModal.preload().catch(() => {});
}

export function preloadScreensFor(names: string): void {
  for (const name of names.split(/\s+/)) {
    for (const screen of INTENT[name] ?? []) void screen.preload().catch(() => {});
  }
}

export function preloadOnIntent(root: Document = document): () => void {
  const on = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const names = target.closest("[data-preload]")?.getAttribute("data-preload");
    if (names) preloadScreensFor(names);
  };
  const events = ["pointerover", "focusin", "pointerdown", "touchstart"] as const;
  for (const name of events) root.addEventListener(name, on, { capture: true, passive: true });
  return () => {
    for (const name of events) root.removeEventListener(name, on, { capture: true });
  };
}

export const BrowserStageHost = lazyScreen("BrowserStageHost", async () => (await import("./BrowserStageHost")).BrowserStageHost);
export const NotificationsPanel = lazyScreen("NotificationsPanel", async () => (await import("./NotificationsPanel")).NotificationsPanel);
export const VoiceSetupDialog = lazyScreen("VoiceSetupDialog", async () => (await import("./VoiceSetupDialog")).VoiceSetupDialog);
export const TeamDialog = lazyScreen("TeamDialog", async () => (await import("./TeamDialog")).TeamDialog);
export const NewTaskFolderDialog = lazyScreen("NewTaskFolderDialog", async () => (await import("./NewTaskFolderDialog")).NewTaskFolderDialog);
export const SidebarNewChatPanel = lazyScreen("SidebarNewChatPanel", async () => (await import("./SidebarNewChatPanel")).SidebarNewChatPanel);
export const ProblemReportDialog = lazyScreen("ProblemReportDialog", async () => (await import("./ProblemReportDialog")).ProblemReportDialog);

const AFTER_STARTUP: ReadonlyArray<{ preload: () => Promise<unknown> }> = [
  NotificationsPanel, SidebarNewChatPanel, VoiceSetupDialog, NewTaskFolderDialog, TeamDialog, ProblemReportDialog,
];

export function preloadAfterStartup(): void {
  const link = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (link?.saveData || /^(?:slow-)?[23]g$/.test(link?.effectiveType ?? "")) return;
  void (async () => {
    for (const job of [loadRestOfCatalog, ...AFTER_STARTUP.map((screen) => () => screen.preload())]) {
      await whenIdleLimited(job, 1).catch(() => {});
    }
  })();
}
