import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Bell, CalendarDays, Check, FolderOpen, Gauge, Inbox, Loader2, LogOut, RefreshCw, Settings as SettingsIcon, Smartphone, UserRound } from "lucide-react";

import { InitialsAvatar } from "./Avatar";
import { AboutDialog } from "./AboutDialog";
import { PhoneAppDialog } from "./lazy-screens";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { useSidebarPhoneStatus } from "./SidebarPhoneButton";
import { api, useStore, type Action } from "@/state/store";
import { serverCheckPhase, serverUpdateRow, type ServerUpdateCheck, type ServerUpdatePhase } from "@/lib/server-update";
import type { CloudAccountBridge, CloudAccountState } from "../../electron/cloud-account.mjs";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { brand } from "../lib/brand";
import { invalidateSession, sessionOnce } from "../lib/session";
import { cn } from "@/lib/cn";
import { useCloudFilesReady } from "@/lib/cloud-files";
import { useAdvancedMode } from "@/lib/interface-mode";
import { isRoutineProblemRun } from "@/lib/routines";
import { useNotificationFeed } from "@/lib/notification-preferences";
import { t } from "@/lib/i18n";
import { FEEDBACK_URL, HELP_CENTER_URL, openExternalLink } from "@/lib/app-links";
import { sendOutbox } from "@/lib/app-outbox";
import {
  cloudPhoneDestination,
  connectPhoneEntry,
  currentPhonePairingTarget,
  loadPhonePairingAccess,
  phoneDestinations,
  phonePairingSettingsAction,
  type CloudPhoneDestination,
  type ConnectPhoneEntry,
  type PhoneDestination,
  type PhonePairingAccess,
} from "@/lib/phone-pairing";

export function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

export function profileLabel(profile?: { name?: string; email?: string }): string {
  return profile?.name?.trim() || profile?.email?.trim() || t("sidebar.profile.you");
}

export type UpdatePhase =
  | UpdaterState["status"]
  | "up-to-date"
  // only a self-hosted server's check reports a release it cannot install itself
  | "available"
  // or that it already runs a newer version than this page
  | "reload";

export function updatePhase(state: UpdaterState | null, upToDate: boolean): UpdatePhase {
  const status = state?.status ?? "idle";
  if (status !== "idle") return status;
  return upToDate ? "up-to-date" : "idle";
}

export function updateLabel(phase: UpdatePhase, state: UpdaterState | null): string {
  switch (phase) {
    case "downloading":
      return state?.percent == null
        ? t("sidebar.update.startingDownload")
        : t("sidebar.update.downloading", { percent: Math.round(state.percent) });
    case "preparing":
      return t("sidebar.update.preparing");
    case "downloaded":
      return (
        state?.installMode === "handoff"
          ? t("sidebar.update.readyInstall", { app: brand().name, version: state?.version ?? "" })
          : t("sidebar.update.ready", { app: brand().name, version: state?.version ?? "" })
      ).replace("  ", " ");
    case "installing":
      return (
        state?.message ||
        (state?.installMode === "handoff"
          ? t("sidebar.update.openingTerminal")
          : t("sidebar.update.installing"))
      );
    case "checking":
      return t("sidebar.update.checking");
    case "handed-off":
      return t("sidebar.update.handedOff");
    case "error":
      return state?.message?.trim() || t("sidebar.update.failed");
    case "up-to-date":
      return t("sidebar.update.upToDate");
    default:
      return t("sidebar.update.check");
  }
}

export function updateBusy(phase: UpdatePhase, pending = false): boolean {
  return pending || phase === "checking" || phase === "downloading" || phase === "preparing" || phase === "installing";
}

function UpdateIcon({ phase, pending, size = 18 }: { phase: UpdatePhase; pending: boolean; size?: number }) {
  if (updateBusy(phase, pending)) return <Loader2 size={size} className="animate-spin" />;
  if (phase === "up-to-date") return <Check size={size} />;
  if (phase === "downloaded") return <ArrowDownToLine size={size} />;
  return <RefreshCw size={size} />;
}

export function updateHasButton(phase: UpdatePhase): boolean {
  return phase === "downloading" || phase === "preparing" || phase === "downloaded" || phase === "installing";
}

export function updateNoteworthy(phase: UpdatePhase, pending = false): boolean {
  return pending || (phase !== "idle" && phase !== "up-to-date" && phase !== "checking");
}

interface UpdateEntry {
  item: SidebarMenuItem;
  phase: UpdatePhase;
  pending: boolean;
  label: string;
}

export function useUpdateItem(): UpdateEntry | null {
  const state = useUpdaterState();
  const updater = window.ogb?.updater;
  const [pending, setPending] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const status = state?.status ?? "idle";

  useEffect(() => setPending(false), [status]);

  const upToDate = Boolean(checkedAt) && (!state || state.status === "idle") && Date.now() - checkedAt < 3000;
  useEffect(() => {
    if (!upToDate) return;
    const timer = setTimeout(() => setCheckedAt(0), 3000);
    return () => clearTimeout(timer);
  }, [upToDate]);

  if (!updater || !state) return null;

  const phase = updatePhase(state, upToDate);
  const label = updateLabel(phase, state);
  return {
    phase,
    pending,
    label,
    item: {
      key: "update",
      label,
      icon: <UpdateIcon phase={phase} pending={pending} />,
      disabled: updateBusy(phase, pending) || state?.retryable === false,
      keepOpen: true,
      attention: phase === "downloaded" || phase === "error",
      attentionTone: phase === "error" ? "danger" : "accent",
      onSelect: () => {
        if (phase === "downloaded") {
          setPending(true);
          return void updater.install();
        }
        setCheckedAt(Date.now());
        void updater.check();
      },
    },
  };
}

/** Without the packaged app's updater the server cannot replace itself, so the row says whether a newer release exists and how to install it. */
function useServerUpdateItem(enabled: boolean): UpdateEntry | null {
  const [phase, setPhase] = useState<ServerUpdatePhase>("idle");
  const [check, setCheck] = useState<ServerUpdateCheck | null>(null);

  useEffect(() => {
    if (phase !== "up-to-date") return;
    const timer = setTimeout(() => setPhase("idle"), 3000);
    return () => clearTimeout(timer);
  }, [phase]);

  if (!enabled) return null;
  const row = serverUpdateRow(phase, check);
  return {
    phase,
    pending: false,
    label: row.label,
    item: {
      key: "update",
      label: row.label,
      subtitle: row.subtitle,
      icon: <UpdateIcon phase={phase} pending={false} />,
      disabled: phase === "checking",
      keepOpen: true,
      attention: phase === "available" || phase === "reload" || phase === "error",
      attentionTone: phase === "error" ? "danger" : "accent",
      onSelect: () => {
        if (phase === "available" && check?.releaseUrl) return void openExternalLink(check.releaseUrl);
        if (phase === "reload") return window.location.reload();
        setPhase("checking");
        void api<ServerUpdateCheck>("/api/updates/check", { timeoutMs: 20_000 })
          .then((next) => {
            setCheck(next);
            setPhase(serverCheckPhase(next));
          })
          .catch(() => setPhase("error"));
      },
    },
  };
}

function useConnectPhoneEntry(cloudHome: boolean): ConnectPhoneEntry | null {
  const target = currentPhonePairingTarget(cloudHome);
  const [access, setAccess] = useState<PhonePairingAccess | null>(null);
  useEffect(() => {
    if (target === "computer") return;
    let alive = true;
    void loadPhonePairingAccess().then((next) => {
      if (alive) setAccess(next);
    });
    return () => {
      alive = false;
    };
  }, [target]);
  return connectPhoneEntry(target, access);
}

export function useCloudPhoneDestination(enabled: boolean): { cloud: CloudPhoneDestination; bridge?: CloudAccountBridge } {
  const bridge = enabled && !window.ogb?.remoteClient?.active ? window.ogb?.cloudAccount : undefined;
  const [account, setAccount] = useState<CloudAccountState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let active = true, updated = false;
    const unsubscribe = bridge.onState((next) => { updated = true; if (active) setAccount(next); });
    void bridge.state().then((next) => { if (active && !updated) setAccount(next); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  return bridge ? { cloud: cloudPhoneDestination(account), bridge } : { cloud: null };
}

export function selectPhoneDestination(destination: PhoneDestination, { bridge, dispatch }: { bridge?: Pick<CloudAccountBridge, "connectHomeForPhone">; dispatch: (action: Action) => void }): void {
  if (destination.id !== "cloud" || !bridge) {
    dispatch(phonePairingSettingsAction());
    return;
  }
  void bridge.connectHomeForPhone().catch(() => dispatch({ type: "toggleAppSettings", open: true, section: "cloudAccount" }));
}

export function phoneMenuItems({
  destinations,
  connected,
  onConnect,
}: {
  destinations: PhoneDestination[];
  connected: boolean;
  onConnect: (destination: PhoneDestination) => void;
  onGetApp: () => void;
}): SidebarMenuItem[] {
  // Nordus: no "get the phone app" entry; it pointed at the Nordus app and the Nordus apps come later.
  return destinations.map((destination) => ({
    key: destination.id === "cloud" ? "connect-phone-cloud" : "connect-phone",
    label: t("sidebar.menu.connectPhone"),
    subtitle: t(destination.subtitleKey),
    ...(destination.noteKey ? { note: t(destination.noteKey) } : {}),
    icon: <Smartphone size={18} />,
    trailing:
      destination.id === "here" && destination.target === "computer" && connected ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
      ) : undefined,
    onSelect: () => onConnect(destination),
  } satisfies SidebarMenuItem));
}

function useSignedInSession(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let active = true;
    void sessionOnce().then((state) => { if (active) setSignedIn(state.kind === "session"); });
    return () => { active = false; };
  }, []);
  return signedIn;
}

/** Ends this browser's session on the server (the cookie goes with it) and returns to the sign-in page. */
export async function signOut(): Promise<void> {
  await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  sendOutbox.clear();
  invalidateSession();
  location.replace("/");
}

const SHOW_UPDATES = false as boolean;

export function profileMenuItems({
  navigation = [],
  notifications = null,
  phone,
  usage,
  onUsage,
  onSettings,
  onSignOut,
}: {
  /** Simple mode puts Today, Files and Routines here, out of the sidebar's footer. */
  navigation?: SidebarMenuItem[];
  /** The quiet Notifications entry, with its unread count, instead of the header bell. */
  notifications?: SidebarMenuItem | null;
  phone: SidebarMenuItem[];
  usage: boolean;
  update: SidebarMenuItem | null;
  account: string | null;
  onUsage: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
  onHelp: () => void;
  onFeedback: () => void;
  onAccount: () => void;
  /** Present only for a signed-in browser or device: a session can end, the machine's owner cannot. */
  onSignOut?: () => void;
}): SidebarMenuItem[] {
  // Nordus keeps three entries. Help and support, the engine's own updates and its cloud account lead to
  // Nordus pages or are run by the team, so they stay out of the menu.
  return [
    ...navigation,
    ...(notifications ? [{ ...notifications, separatorBefore: notifications.separatorBefore || navigation.length > 0 }] : []),
    ...(usage ? [{ key: "usage", label: t("settings.section.usage"), icon: <Gauge size={18} />, separatorBefore: navigation.length > 0, onSelect: onUsage }] : []),
    ...(phone.length > 0 ? phone.map((item, index) => ({ ...item, separatorBefore: item.separatorBefore || (navigation.length > 0 && !usage && index === 0) })) : []),
    { key: "settings", label: t("sidebar.menu.settings"), icon: <SettingsIcon size={18} />, onSelect: onSettings },
    ...(onSignOut ? [{ key: "sign-out", label: t("sidebar.menu.signOut"), icon: <LogOut size={18} />, onSelect: onSignOut }] : []),
  ];
}

export function SidebarProfileMenu({ iconOnly = false, avatarOnly = false, rail = false }: { iconOnly?: boolean; avatarOnly?: boolean; rail?: boolean } = {}) {
  const { state, dispatch } = useStore();
  const phone = useSidebarPhoneStatus();
  const connectPhone = useConnectPhoneEntry(state.config?.cloudHome === true);
  const cloudPhone = useCloudPhoneDestination(connectPhone?.target === "computer");
  const destinations = phoneDestinations(connectPhone, cloudPhone.cloud);
  const desktopUpdate = useUpdateItem();
  const serverUpdate = useServerUpdateItem(!window.ogb?.updater);
  const update = desktopUpdate ?? serverUpdate;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [phoneAppOpen, setPhoneAppOpen] = useState(false);
  const signedIn = useSignedInSession();
  const advanced = useAdvancedMode();
  const cloudFilesReady = useCloudFilesReady();
  const routinesNeedYou = state.routineRuns?.some((run) => isRoutineProblemRun(run) && !run.seenAt) ?? false;
  const notificationFeedOn = useNotificationFeed() && !(window.ogb?.remoteClient?.active === true);
  const unreadNotifications = (state.notifications ?? []).reduce((count, entry) => count + (entry.read ? 0 : 1), 0);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const profile = state.config?.profile;
  const name = profileLabel(profile);
  const connectTo = (destination: PhoneDestination) => selectPhoneDestination(destination, { bridge: cloudPhone.bridge, dispatch });
  const remote = window.ogb?.remoteClient?.active === true;
  const cloudAccount = !remote && Boolean(window.ogb?.cloudAccount || (window.ogb?.cloudPlan && state.config?.cloudHome === true));

  const navigation: SidebarMenuItem[] = advanced ? [] : [
    { key: "today", label: t("sidebar.nav.today"), icon: <Inbox size={18} />, onSelect: () => dispatch({ type: "showToday" }) },
    ...(cloudFilesReady ? [{ key: "files", label: t("sidebar.nav.files"), icon: <FolderOpen size={18} />, onSelect: () => dispatch({ type: "showFiles" }) } satisfies SidebarMenuItem] : []),
    { key: "routines", label: t("sidebar.nav.routines"), icon: <CalendarDays size={18} />, attention: routinesNeedYou, onSelect: () => dispatch({ type: "showRoutines" }) },
  ];
  const items = profileMenuItems({
    navigation,
    notifications: notificationFeedOn ? {
      key: "notifications",
      label: t("notifications.title"),
      icon: <Bell size={18} />,
      trailing: unreadNotifications > 0 ? (
        <span data-notifications-count="" className="rounded-full bg-[var(--color-unread,#3b82f6)] px-1.5 text-[11px] leading-5 tabular-nums text-white">
          {unreadNotifications > 99 ? "99+" : unreadNotifications}
        </span>
      ) : undefined,
      onSelect: () => dispatch({ type: "toggleNotifications" }),
    } : null,
    phone: phoneMenuItems({
      destinations,
      connected: phone.kind === "connected",
      onConnect: connectTo,
      onGetApp: () => setPhoneAppOpen(true),
    }),
    usage: !remote,
    update: update?.item ?? null,
    account: cloudAccount ? t("settings.section.cloudAccount") : null,
    onUsage: () => dispatch({ type: "toggleAppSettings", open: true, section: "usage" }),
    onSettings: () => dispatch({ type: "toggleAppSettings" }),
    onShortcuts: () => {
      triggerRef.current?.closest("button")?.focus();
      dispatch({ type: "toggleShortcuts", open: true });
    },
    onAbout: () => setAboutOpen(true),
    onHelp: () => void openExternalLink(HELP_CENTER_URL),
    onFeedback: () => void openExternalLink(FEEDBACK_URL),
    onAccount: () => dispatch({ type: "toggleAppSettings", open: true, section: "cloudAccount" }),
    onSignOut: signedIn ? () => void signOut() : undefined,
  });
  // Updating the engine is the team's job in Nordus, so the avatar never wears an update dot.
  const noteworthy = SHOW_UPDATES && update && updateNoteworthy(update.phase, update.pending) && !updateHasButton(update.phase);

  return (
    <>
      <SidebarPopoverMenu
        items={items}
        ariaLabel={name}
        triggerClassName={avatarOnly ? "shrink-0 rounded-full" : iconOnly ? "shrink-0 rounded-xl" : "w-full"}
        triggerTitle={iconOnly || avatarOnly ? name : undefined}
        renderTrigger={({ open }) => avatarOnly ? (
          <span
            ref={triggerRef}
            data-preload="settings"
            data-profile-avatar=""
            className={cn(
              "nb-pill relative flex size-[40px] items-center justify-center rounded-full text-ink-secondary transition-colors",
              open ? "nb-pill-open text-ink" : "hover:text-ink",
            )}
          >
            <UserRound size={18} aria-hidden="true" />
            {noteworthy && (
              <span
                aria-hidden
                className={cn(
                  "absolute -end-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-app",
                  update.phase === "error" ? "bg-danger" : "bg-accent",
                )}
              />
            )}
          </span>
        ) : iconOnly ? (
          <span
            ref={triggerRef}
            data-preload="settings"
            className={cn(
              "relative flex items-center justify-center rounded-xl transition-colors",
              rail ? "size-10" : "size-[46px]",
              open ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <InitialsAvatar initials={profileInitials(profile)} avatarUrl={profile?.avatarUrl} size={rail ? 30 : 28} />
            {noteworthy && (
              <span
                aria-hidden
                className={cn(
                  "absolute end-1 top-1 size-2.5 rounded-full ring-2 ring-app",
                  update.phase === "error" ? "bg-danger" : "bg-accent",
                )}
              />
            )}
          </span>
        ) : (
          <span
            ref={triggerRef}
            data-preload="settings"
            className={cn(
              "flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
              open ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <InitialsAvatar initials={profileInitials(profile)} avatarUrl={profile?.avatarUrl} size={28} />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-ink">{name}</span>
            {noteworthy && (
              <span
                title={update.label}
                aria-label={update.label}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  update.phase === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent",
                )}
              >
                <UpdateIcon phase={update.phase} pending={update.pending} size={14} />
              </span>
            )}
          </span>
        )}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {phoneAppOpen && <PhoneAppDialog
        open={phoneAppOpen}
        onClose={() => setPhoneAppOpen(false)}
        connect={destinations.map((destination) => ({
          key: destination.id,
          subtitle: t(destination.subtitleKey),
          onSelect: () => connectTo(destination),
        }))}
      />}
    </>
  );
}
