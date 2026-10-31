import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { ChevronLeft } from "lucide-react";
import { CLOUD_LINK_SETTINGS, openBot, openNotificationTarget, resyncNow, StoreProvider, useStore } from "@/state/store";
import { attachStackSwipe } from "@/lib/stack-swipe";
import { installPullToRefresh } from "@/lib/pull-to-refresh";
import { installSheetDrag } from "@/lib/sheet-drag";
import { useShowThreads } from "@/lib/thread-preferences";
import { useWelcomeViewer, WelcomeGate } from "@/components/onboarding/WelcomeGate";
import { CloudTimeZoneSync } from "@/components/CloudTimeZone";
import { cloudSignInDue, spotlightsQuiet, type WelcomeViewer } from "@/lib/onboarding";
import { currentStep } from "@/lib/guided-tour";
import { tourComplete } from "@/lib/first-conversation";
import { LiveCallHost } from "@/components/LiveCallHost";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { initAnalytics } from "@/lib/analytics";
import { afterStartup } from "@/lib/idle-queue";
import { parseComputerHelp } from "@/lib/computer-control";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { MentionPeopleProvider } from "@/components/people/MentionPeopleProvider";
import { useDirectSync } from "@/lib/use-direct-sync";
import { useGuest } from "@/lib/use-viewer";
import { SIDEBAR_AND_PANEL_FIT, SIDEBAR_INLINE, TWO_SIDE_PANELS_FIT, useMediaQuery } from "@/lib/use-media-query";
import { preloadConnectedApps } from "@/components/connected-apps";
import {
  ActivityPanel, BoardPage, BotSettingsDialog, BrowserStageHost, CloudAddDialog, ComputerPanel, DirectMessageView, DrivePage, FilesView, FirstConversationTour, GroupView, GuidedTour, InspectorPanel, KeyboardShortcutsModal, LocalVmWorkspace, NewBotDialog,
  InboxPage, NotificationsPanel, PluginsPanel, preloadAfterStartup, preloadOnIntent, RemoteAgentSettingsPanel, RemoteDesktopPanel, SettingsModal, TeamMapPage, TodayPage, TriggersPage, WikiPage,
} from "@/components/lazy-screens";
import { WorkspaceBackupRecovery } from "@/components/WorkspaceBackupSettings";
import { TaskFromMessageHost } from "@/components/board/TaskFromMessageHost";
import { useNotificationFeed } from "@/lib/notification-preferences";
import { publishAppBadge } from "@/lib/app-badge";
import { SendOutboxDriver } from "@/components/SendOutboxDriver";
import { SignedOutGate } from "@/components/SignedOutGate";
import { startNativeApp } from "@/lib/native-app";
import { watchScrolledLayers } from "@/lib/scrolled-layer";
import { UpdateBanner } from "@/components/UpdateBanner";
import { AppNotices } from "@/components/AppNotices";
import { ToastHost } from "@/components/ToastHost";
import { finishCloudProHandoff, takeCloudProHandoff } from "@/components/CloudProPopup";
import { CloudHowTo } from "@/components/CloudHowTo";
import { CloudHomeNote } from "@/components/CloudMove";
import { DesktopCapabilitiesProvider, useCaptionChrome, useDesktopCapabilities, WindowDragStrip } from "@/components/DesktopCapabilities";
import { WindowCaptionButtons } from "@/components/WindowCaptionButtons";
import { NoEngines } from "@/components/NoEngines";
import { CloudEngineSignIn } from "@/components/CloudEngineSignIn";
import { CloudIntent } from "@/components/CloudIntent";
import { cloudIntentDue, cloudIntentShown, useCloudIntent } from "@/lib/cloud-intent";
import { CloudSetup } from "@/components/CloudSetup";
import { CloudWelcome } from "@/components/cloud-welcome/CloudWelcome";
import { WelcomeKeeper } from "@/components/cloud-welcome/WelcomeKeeper";
import { cloudFirstRun, cloudWelcomeVisible, useCloudWelcome } from "@/lib/cloud-welcome";
import { engineReady } from "@/components/EngineLibrary";
import { CommandPalette } from "@/components/CommandPalette";
import { onLocaleLoaded, setLocale, t } from "@/lib/i18n";
import { shouldOpenKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { effectiveLanguage, useLanguageChoice } from "@/lib/language-preference";
import { appUnreadCount, botForShortcut } from "@/lib/team-members";
import { phonePairingSettingsAction, takePhonePairingRequest } from "@/lib/phone-pairing";
import { takeAccountsRequest } from "@/lib/accounts-link";
import { takeConnectRequest } from "@/lib/connect-link";
import { useExternalChatLinks } from "@/hooks/use-external-chat-links";
import { useNotchFeed } from "@/hooks/use-notch-feed";
import { useUsageSnapshot } from "@/hooks/use-usage-snapshot";
import { ChatNotice } from "@/components/ChatErrorBanner";
import { StartupLoader } from "@/components/StartupLoader";
import { OfflineNotice } from "@/components/OfflineNotice";

function Shell({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { capabilities } = useDesktopCapabilities();
  const captionChrome = useCaptionChrome();
  const unreadCount = appUnreadCount(state.bots, state.groups);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const twoSidePanelsFit = useMediaQuery(TWO_SIDE_PANELS_FIT, true);
  const sidebarAndPanelFit = useMediaQuery(SIDEBAR_AND_PANEL_FIT, true);
  const sidebarInline = useMediaQuery(SIDEBAR_INLINE, false);
  const [handedOver, setHandedOver] = useState(false);
  const botsRef = useRef(state.bots);
  botsRef.current = state.bots;
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-mention-person]") && !window.getSelection()?.toString()) {
        event.preventDefault();
        dispatch({ type: "toggleAppSettings", open: true, section: "general" });
        return;
      }
      const chip = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-mention-bot]") : null;
      const botId = chip?.dataset.mentionBot;
      if (!botId || window.getSelection()?.toString()) return;
      const bot = botsRef.current.find((candidate) => candidate.id === botId && !candidate.hidden);
      if (!bot) return;
      event.preventDefault();
      openBot(dispatch, bot, false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [dispatch]);
  useEffect(() => {
    if (!window.ogb?.environments) return;
    const open = (computerId?: string | null, panel?: "copy") => {
      if (computerId) {
        const target = new URL(window.location.href);
        target.searchParams.set(panel === "copy" ? "copy-to" : "share-computer", computerId);
        window.history.replaceState(null, "", `${target.pathname}${target.search}${target.hash}`);
      }
      dispatch({ type: "toggleAppSettings", open: true, section: "desktopWorkspaces" });
    };
    const url = new URL(window.location.href);
    const requestedSettings = url.searchParams.get("desktop-settings");
    const cloud = ["cloud", "cloud-settings", "cloud-add", "cloud-add-howto"].includes(requestedSettings ?? "");
    if (requestedSettings === "workspaces" || (requestedSettings === "organization" && window.ogb.organization && !remoteClient) ||
      (cloud && window.ogb.cloudAccount && !remoteClient)) {
      const handoff = takeCloudProHandoff(url);
      url.searchParams.delete("desktop-settings");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      if (handoff && window.ogb.cloudAccount) { setHandedOver(true); finishCloudProHandoff(handoff, window.ogb.cloudAccount, dispatch); }
      else if (requestedSettings === "organization") dispatch({ type: "toggleAppSettings", open: true, section: "organization" });
      else if (requestedSettings === "cloud") dispatch(CLOUD_LINK_SETTINGS);
      else if (requestedSettings === "cloud-settings") dispatch({ type: "toggleAppSettings", open: true, section: "cloudAccount" });
      else if (requestedSettings === "cloud-add" || requestedSettings === "cloud-add-howto") dispatch({ type: "openCloudAdd", source: requestedSettings === "cloud-add" ? "app_menu" : "app_howto" });
      else open();
    }
    return window.ogb.environments.onOpenSettings?.(open);
  }, [dispatch]);
  useEffect(() => {
    const rest = takePhonePairingRequest(window.location.href);
    if (rest === null) return;
    window.history.replaceState(null, "", rest);
    dispatch(phonePairingSettingsAction());
  }, [dispatch]);
  useEffect(() => {
    const rest = takeAccountsRequest(window.location.href);
    if (rest === null) return;
    window.history.replaceState(null, "", rest);
    dispatch({ type: "toggleAppSettings", open: true, section: "accountMoves" });
  }, [dispatch]);
  useEffect(() => { // A bot's link to a connection that needs the person on a connected account opens the page that connects it.
    const request = takeConnectRequest(window.location.href);
    if (!request) return;
    window.history.replaceState(null, "", request.rest);
    dispatch({ type: "togglePlugins", open: true, surface: request.surface });
  }, [dispatch]);
  useExternalChatLinks(state, dispatch);
  useNotchFeed(state, dispatch);
  useDirectSync();
  const guest = useGuest();
  // On a phone the list of conversations is the home screen and a conversation is pushed over it, the iOS way:
  // drawerOpen means the list is the screen in front.
  const [drawerOpen, setDrawerOpen] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia(SIDEBAR_INLINE).matches);
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  const [, setLocaleEpoch] = useState(0);
  useEffect(() => {
    setLocale(language || (import.meta.env?.MODE === "test" ? globalThis.navigator?.language : DEFAULT_LOCALE));
    setLocaleEpoch((epoch) => epoch + 1);
  }, [language]);
  // A language chosen in Settings is fetched on demand: redraw when its pack lands.
  useEffect(() => onLocaleLoaded(() => setLocaleEpoch((epoch) => epoch + 1)), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [localVmWorkspaceBotId, setLocalVmWorkspaceBotId] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const previousViewRef = useRef(state.activeView);
  const calendarOriginRef = useRef<"chat" | "team-map">("chat");
  const group = state.groups.find((g) => g.id === state.selectedId);
  const bot = group ? undefined : (state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0]);
  const notificationFeed = useNotificationFeed() && !remoteClient;
  const sidePanelOpen = (Boolean(bot) && (state.settingsOpen || state.computerOpen || state.inspectorOpen || state.activityOpen)) || (notificationFeed && state.notificationsOpen);
  // On a phone the list is its own screen under whatever is pushed over it, never the icon rail.
  const collapseSidebar = sidePanelOpen && !sidebarAndPanelFit && sidebarInline;
  const calendarFocus = state.activeView === "routines" && state.routinesFocus.view === "calendar";
  const advanced = useAdvancedMode();
  useEffect(() => {
    if (!advanced && state.inspectorOpen) dispatch({ type: "toggleInspector", open: false });
  }, [advanced, state.inspectorOpen, dispatch]);

  const noEngines =
    state.connected &&
    state.instances.length > 0 &&
    !state.instances.some((i) => i.snapshot.state === "available");
  const cloudSignIn = cloudSignInDue(viewer, state, engineReady);
  const cloudIntent = useCloudIntent();
  const cloudAsk = cloudIntentShown(cloudIntentDue({
    viewer, connected: state.connected, enginesKnown: state.instances.length > 0,
    onboarding: state.config?.onboarding, reopened: false,
  }), cloudIntent);
  const cloudJobWaiting = Boolean(viewer?.cloudHome && viewer.canSave && cloudIntent.pending);
  const welcome = useCloudWelcome();
  const welcomeOnScreen = cloudWelcomeVisible({ viewer, connected: state.connected, enginesKnown: state.instances.length > 0, onboarding: state.config?.onboarding }, welcome)
    && state.activeView === "chat" && !(!remoteClient && localVmWorkspaceBotId);
  const firstRun = cloudFirstRun({ welcome: welcomeOnScreen, intent: cloudAsk, signIn: cloudSignIn || cloudJobWaiting });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || state.shortcutsOpen) return;
      if (shouldOpenKeyboardShortcuts(e)) {
        e.preventDefault();
        dispatch({ type: "toggleShortcuts", open: true });
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        if (!guest) dispatch({ type: "toggleNewBot", open: true });
      } else if (/^[1-9]$/.test(e.key)) {
        const target = botForShortcut(state.bots, state.selectedId, e.key);
        if (target) {
          e.preventDefault();
          openBot(dispatch, target, showThreads);
        }
      } else if (e.shiftKey && (e.key === "[" || e.key === "]")) {
        const next = botForShortcut(state.bots, state.selectedId, e.key);
        if (next) {
          e.preventDefault();
          openBot(dispatch, next, showThreads);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.bots, state.selectedId, state.shortcutsOpen, showThreads, dispatch, guest]);

  useEffect(() => watchScrolledLayers(), []);

  const nativeTargetRef = useRef({ state, showThreads });
  nativeTargetRef.current = { state, showThreads };
  useEffect(() => {
    if (!state.connected) return;
    return startNativeApp((target) => {
      const latest = nativeTargetRef.current;
      openNotificationTarget(dispatch, target, latest.state, latest.showThreads);
    });
  }, [state.connected, dispatch]);

  useEffect(() => {
    window.ogb?.setUnreadCount?.(unreadCount);
    publishAppBadge(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (!state.connected) return;
    // The connected-apps inventory warms the cache for the Apps screen; it is not needed to open a conversation.
    const timer = setTimeout(() => void preloadConnectedApps().catch(() => {}), 6_000);
    return () => clearTimeout(timer);
  }, [state.connected]);
  useUsageSnapshot();

  useEffect(() => preloadOnIntent(), []);
  useEffect(() => afterStartup(preloadAfterStartup), []);

  // The first run is the app opening: on a phone it stays on the list. Every later change of conversation pushes it.
  // The app's own first pick, once the bots load, is not the person opening a conversation either.
  const openedRef = useRef(false);
  const lastSelectedRef = useRef(state.selectedId);
  useEffect(() => {
    const was = lastSelectedRef.current;
    lastSelectedRef.current = state.selectedId;
    if (!openedRef.current || !was) {
      openedRef.current = true;
      return;
    }
    setDrawerOpen(false);
  }, [state.selectedId, bot?.threadId, group?.threadId, state.activeView, state.pluginsOpen, state.settingsOpen]);
  const stackRef = useRef<HTMLDivElement>(null);
  const listShownRef = useRef(drawerOpen && !calendarFocus);
  listShownRef.current = drawerOpen && !calendarFocus;
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack || sidebarInline || !window.matchMedia("(pointer: coarse)").matches) return;
    const stopPull = installPullToRefresh(stack, resyncNow);
    const stopSheet = installSheetDrag();
    const stopSwipe = attachStackSwipe(stack, {
      enabled: () => true,
      listShown: () => listShownRef.current,
      onBackToList: () => setDrawerOpen(true),
    });
    return () => {
      stopPull();
      stopSheet();
      stopSwipe();
    };
  }, [sidebarInline]);

  useEffect(() => {
    if (state.activeView === "routines" && previousViewRef.current !== "routines") {
      calendarOriginRef.current = previousViewRef.current === "team-map" ? "team-map" : "chat";
    }
    previousViewRef.current = state.activeView;
  }, [state.activeView]);

  useEffect(() => {
    if (
      localVmWorkspaceBotId &&
      (state.activeView !== "chat" || state.selectedId !== localVmWorkspaceBotId)
    ) {
      setLocalVmWorkspaceBotId(null);
    }
  }, [localVmWorkspaceBotId, state.activeView, state.selectedId]);

  const openLocalVmWorkspace = (botId: string) => {
    dispatch({ type: "toggleComputer", open: false });
    setLocalVmWorkspaceBotId(botId);
  };

  const openComputerFromWorkspace = (botId: string) => {
    setLocalVmWorkspaceBotId(null);
    dispatch({ type: "select", id: botId });
    dispatch({ type: "toggleComputer", open: true });
  };

  const closeCalendar = useCallback(() => {
    if (calendarOriginRef.current === "team-map") {
      dispatch({ type: "showTeamMap" });
      return;
    }
    dispatch({ type: "select", id: state.selectedId });
  }, [dispatch, state.selectedId]);
  const openCalendarRoom = useCallback((id: string) => {
    dispatch({ type: "select", id });
  }, [dispatch]);

  const nativeViewOverlayOpen =
    drawerOpen ||
    paletteOpen ||
    state.settingsOpen ||
    state.computerOpen ||
    state.inspectorOpen ||
    state.activityOpen ||
    state.appSettingsOpen ||
    state.pluginsOpen;

  useEffect(() => {
    return window.ogb?.onOpenAppSettings?.(section => dispatch((section === "cloud-add" || section === "cloud-add-howto") && window.ogb?.cloudAccount && !remoteClient
      ? { type: "openCloudAdd", source: section === "cloud-add" ? "app_menu" : "app_howto" }
      : section === "cloud" && window.ogb?.cloudAccount && !remoteClient
        ? CLOUD_LINK_SETTINGS
        : section === "cloud-settings" && window.ogb?.cloudAccount && !remoteClient
          ? { type: "toggleAppSettings", open: true, section: "cloudAccount" }
          : { type: "toggleAppSettings", open: true, ...(section === "organization" && window.ogb?.organization && !remoteClient ? { section } : {}) }));
  }, [dispatch]);

  useEffect(() => {
    return window.ogb?.desktopViewer?.onState((viewer) => {
      if (viewer.open || !viewer.contextId) return;
      const botId = viewer.contextId;
      void fetch(`/api/bots/${botId}/computer/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((snap) => {
          if (snap) dispatch({ type: "computerControl", botId, held: snap.held === true, helpReason: snap.helpReason ?? null, help: parseComputerHelp(snap.help) });
        })
        .catch(() => {});
      void fetch(`/api/bots/${botId}/computer/viewer-close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(() => {});
    });
  }, [dispatch]);

  return (
    <div className="flex h-full flex-col">
      <UpdateBanner sidebarIndicator={!calendarFocus && (sidebarInline || drawerOpen)} />
      <ToastHost />
      <TaskFromMessageHost />
      <AppNotices quiet={paletteOpen || drawerOpen || Boolean(localVmWorkspaceBotId) || handedOver} viewer={viewer} />
      <OfflineNotice />
      <div
        ref={stackRef}
        data-mobile-stack=""
        data-screen={drawerOpen && !calendarFocus ? "list" : "chat"}
        className="relative flex min-h-0 flex-1"
        onClickCapture={(event) => {
          if (sidebarInline || !(event.target instanceof Element)) return;
          const row = event.target.closest("[data-sidebar-bot-row], [data-sidebar-group-row], [data-sidebar-thread-row], [data-sidebar-dm-row], [data-pinned-hero-bot]");
          if (!row || event.target.closest("button[aria-haspopup], [role='menu'], input, [data-row-actions]")) return;
          // The same conversation tapped again changes nothing in the store, so push it here too.
          setTimeout(() => setDrawerOpen(false), 0);
        }}
      >
      <div data-stack-shade="" aria-hidden="true" className="md:hidden" />
      {!calendarFocus && <Sidebar
        collapseToIcons={collapseSidebar}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          menuButtonRef.current?.focus();
        }}
      />}
      <div
        data-stack-main=""
        className="relative flex min-h-0 min-w-0 flex-1"
        // Behind the list on a phone: out of reach of taps and of the keyboard until it is pushed back in.
        inert={!sidebarInline && drawerOpen && !calendarFocus ? true : undefined}
      >
      {/* Inside the conversation so it travels with it; a screen pushed over the conversation (the bot's or the room's profile) covers it and brings its own ‹. */}
      {!calendarFocus && !drawerOpen && !state.settingsOpen && <button
        type="button"
        ref={menuButtonRef}
        aria-label={t("mobile.back")}
        onClick={() => setDrawerOpen(true)}
        data-ios-glass-button=""
        data-stack-back=""
        className="absolute left-2 top-2 z-30 flex size-11 items-center justify-center rounded-full text-ink md:hidden"
      >
        <ChevronLeft size={24} strokeWidth={2.25} />
      </button>}
      {state.activeView === "team-map" ? (
        <TeamMapPage />
      ) : state.activeView === "files" ? (
        <FilesView />
      ) : state.activeView === "drive" ? <DrivePage /> : state.activeView === "wiki" ? <WikiPage /> : state.activeView === "today" ? <TodayPage /> : state.activeView === "board" ? <BoardPage /> : state.activeView === "inbox" ? <InboxPage /> : state.activeView === "routines" ? (
        <TriggersPage onBack={closeCalendar} onOpenRoom={openCalendarRoom} />
      ) : state.activeView === "direct" && state.directId ? (
        <DirectMessageView key={state.directId} id={state.directId} />
      ) : !remoteClient && localVmWorkspaceBotId ? (
        <LocalVmWorkspace
          primaryBotId={localVmWorkspaceBotId}
          overlayOpen={nativeViewOverlayOpen}
          onClose={() => setLocalVmWorkspaceBotId(null)}
          onOpenComputer={openComputerFromWorkspace}
        />
      ) : firstRun === "welcome" ? (
        <CloudWelcome />
      ) : firstRun === "intent" ? (
        <CloudIntent />
      ) : firstRun === "sign-in" ? (
        <CloudEngineSignIn />
      ) : noEngines ? (
        <NoEngines />
      ) : group ? (
        <MentionPeopleProvider group={group}>
          <GroupView key={group.id} group={group} />
        </MentionPeopleProvider>
      ) : bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          <WindowDragStrip />
          <div className="w-full max-w-md"><ChatNotice notice={state.notice} /></div>
          <StartupLoader connected={state.connected} />
        </main>
      )}
      {/* Sibling panels need distinct keys: two keyed `bot.id` collide in React's keyed reconciliation. */}
      {state.settingsOpen && bot && (
        remoteClient
          ? <RemoteAgentSettingsPanel bot={bot} overlay={state.computerOpen && !twoSidePanelsFit} />
          : <BotSettingsDialog key={`settings:${bot.id}`} bot={bot} overlay={(state.inspectorOpen || state.computerOpen || (notificationFeed && state.notificationsOpen)) && !twoSidePanelsFit} />
      )}
      {state.computerOpen && bot && (
        remoteClient ? (
          <RemoteDesktopPanel key={`computer:${bot.id}`} bot={bot} />
        ) : (
          <ComputerPanel
            key={`computer:${bot.id}`}
            bot={bot}
            onOpenVmWorkspace={openLocalVmWorkspace}
          />
        )
      )}
      {!remoteClient && state.inspectorOpen && bot && <InspectorPanel key={bot.threadId} bot={bot} />}
      {!remoteClient && state.activityOpen && bot && <ActivityPanel key={`activity:${bot.id}`} bot={bot} />}
      {sidebarInline && notificationFeed && !calendarFocus && state.notificationsOpen && <NotificationsPanel />}
      </div>
      {/* On a phone the alerts open from the list's bell as a screen pushed over the list. */}
      {!sidebarInline && notificationFeed && !calendarFocus && state.notificationsOpen && <NotificationsPanel />}
      {state.appSettingsOpen && <SettingsModal />}
      <BrowserStageHost />
      {state.cloudAdd && <CloudAddDialog />}
      <CloudHowTo />
      <CloudSetup viewer={viewer} welcomeShown={welcomeOnScreen} />
      <WelcomeKeeper viewer={viewer} />
      {state.pluginsOpen && <PluginsPanel />}
      {state.newBotOpen && <NewBotDialog />}
      {state.shortcutsOpen && (
        <KeyboardShortcutsModal
          open={state.shortcutsOpen}
          onClose={() => dispatch({ type: "toggleShortcuts", open: false })}
        />
      )}
      {/* After the modals: same z-50 tier, so DOM order keeps the palette on top. */}
      <CommandPalette onOpenChange={setPaletteOpen} />
      {/* Blink resolves -webkit-app-region in DOM order, so this no-drag twin after the headers cuts the drawer button back out. */}
      {!calendarFocus && <span
        aria-hidden
        data-drawer-button-no-drag
        style={captionChrome.noDragStyle}
        className="pointer-events-none absolute left-3 top-3 size-[30px] md:hidden"
      />}
      </div>
      <CloudHomeNote />
      {/* Last child on purpose: Blink resolves -webkit-app-region in DOM order, so no-drag buttons must follow every drag region. */}
      <WindowCaptionButtons
        visible={capabilities.windowChrome === "win-caption" && Boolean(window.ogb?.windowControls)}
      />
    </div>
  );
}

/** The tours are fetched only when one can show: after the welcome, with a step left or a spotlight not yet seen. */
function OnboardingTours({ quiet }: { quiet: boolean }) {
  const { state } = useStore();
  const record = state.config?.onboarding;
  const welcomed = Boolean(record?.completedAt);
  const guided = state.tourOpen || (welcomed && currentStep(record) !== null);
  const spotlight = welcomed && !quiet && !tourComplete([...(record?.hintsSeen ?? []), "spot.composer", "spot.model"]);
  return (
    <>
      {guided && <GuidedTour />}
      {spotlight && <FirstConversationTour quiet={quiet} />}
    </>
  );
}

function Application() {
  useEffect(() => {
    afterStartup(initAnalytics);
  }, []);
  const viewer = useWelcomeViewer();
  return (
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <ThreadRefsProvider>
          <Shell viewer={viewer} />
        </ThreadRefsProvider>
        <WelcomeGate viewer={viewer} />
        <CloudTimeZoneSync viewer={viewer} />
        <OnboardingTours quiet={spotlightsQuiet(viewer)} />
        <LiveCallHost />
        <SendOutboxDriver />
        <SignedOutGate />
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  );
}

export default function App() {
  return <WorkspaceBackupRecovery><Application /></WorkspaceBackupRecovery>;
}
