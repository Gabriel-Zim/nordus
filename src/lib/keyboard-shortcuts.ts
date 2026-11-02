import type { SendKey } from "./send-key";
import type { LocaleKey } from "@/locales";
import { t } from "./i18n";

export interface ShortcutItem {
  id: string;
  description: LocaleKey;
  macKeys: string[];
  winKeys: string[];
}

export interface ShortcutGroup {
  category: LocaleKey;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    category: "shortcuts.group.navigation",
    items: [
      {
        id: "command-palette",
        description: "shortcuts.item.commandPalette",
        macKeys: ["⌘", "K"],
        winKeys: ["Ctrl", "K"],
      },
      {
        id: "new-bot",
        description: "shortcuts.item.newBot",
        macKeys: ["⌘", "N"],
        winKeys: ["Ctrl", "N"],
      },
      {
        id: "new-conversation",
        description: "shortcuts.item.newConversation",
        macKeys: ["⌘", "⇧", "O"],
        winKeys: ["Ctrl", "Shift", "O"],
      },
      {
        id: "open-settings",
        description: "shortcuts.item.openSettings",
        macKeys: ["⌘", ","],
        winKeys: ["Ctrl", ","],
      },
      {
        id: "jump-bot",
        description: "shortcuts.item.jumpBot",
        macKeys: ["⌘", "1–9"],
        winKeys: ["Ctrl", "1–9"],
      },
      {
        id: "switch-bot",
        description: "shortcuts.item.switchBot",
        macKeys: ["⌘", "⇧", "[ / ]"],
        winKeys: ["Ctrl", "Shift", "[ / ]"],
      },
      {
        id: "toggle-sidebar",
        description: "shortcuts.item.toggleSidebar",
        macKeys: ["⌘", "\\"],
        winKeys: ["Ctrl", "\\"],
      },
      {
        id: "find-conversation",
        description: "shortcuts.item.findConversation",
        macKeys: ["⌘", "F"],
        winKeys: ["Ctrl", "F"],
      },
    ],
  },
  {
    category: "shortcuts.group.chat",
    items: [
      {
        id: "send-message",
        description: "shortcuts.item.sendMessage",
        macKeys: ["Return"],
        winKeys: ["Enter"],
      },
      {
        id: "new-line",
        description: "shortcuts.item.newLine",
        macKeys: ["⇧", "Return"],
        winKeys: ["Shift", "Enter"],
      },
      {
        id: "edit-last-message",
        description: "shortcuts.item.editLast",
        macKeys: ["↑"],
        winKeys: ["↑"],
      },
      {
        id: "close-panel",
        description: "shortcuts.item.closePanel",
        macKeys: ["Esc"],
        winKeys: ["Esc"],
      },
      {
        id: "shortcuts-cheat-sheet",
        description: "shortcuts.item.cheatSheet",
        macKeys: ["⌘", "/"],
        winKeys: ["Ctrl", "/"],
      },
    ],
  },
  {
    category: "shortcuts.group.calls",
    items: [
      {
        id: "live-call-mute",
        description: "shortcuts.item.liveMute",
        macKeys: ["⌘", "⇧", "M"],
        winKeys: ["Ctrl", "Shift", "M"],
      },
      {
        id: "live-call-hang-up",
        description: "shortcuts.item.liveHangUp",
        macKeys: ["⌘", "⇧", "H"],
        winKeys: ["Ctrl", "Shift", "H"],
      },
    ],
  },
  {
    category: "shortcuts.group.management",
    items: [
      {
        id: "save-bulletin",
        description: "shortcuts.item.saveBulletin",
        macKeys: ["⌘", "Return"],
        winKeys: ["Ctrl", "Enter"],
      },
      {
        id: "reorder-section",
        description: "shortcuts.item.reorderSection",
        macKeys: ["⌥", "↑ / ↓"],
        winKeys: ["Alt", "↑ / ↓"],
      },
    ],
  },
];

type Keys = Pick<ShortcutItem, "macKeys" | "winKeys">;
const ENTER: Keys = { macKeys: ["Return"], winKeys: ["Enter"] };
const SHIFT_ENTER: Keys = { macKeys: ["⇧", "Return"], winKeys: ["Shift", "Enter"] };
const SEND_ROWS: Record<Exclude<SendKey, "enter">, [Keys, Keys]> = {
  "shift-enter": [SHIFT_ENTER, ENTER],
  "mod-enter": [{ macKeys: ["⌘", "Return"], winKeys: ["Ctrl", "Enter"] }, ENTER],
};

export function shortcutGroupsFor(sendKey: SendKey): readonly ShortcutGroup[] {
  if (sendKey === "enter") return SHORTCUT_GROUPS;
  const [send, newLine] = SEND_ROWS[sendKey];
  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.id === "send-message" ? { ...item, ...send }
        : item.id === "new-line" ? { ...item, ...newLine }
          : item),
  }));
}

export function shouldOpenKeyboardShortcuts(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.altKey) return false;
  const helpKey = event.key === "?" && !event.metaKey && !event.ctrlKey;
  const helpChord = event.key === "/" && (event.metaKey || event.ctrlKey) && !event.shiftKey;
  if (!helpKey && !helpChord) return false;
  const target = event.target;
  return !(target instanceof HTMLElement && (
    target.isContentEditable || target.closest("input, textarea, select, dialog, [role=dialog]")
  ));
}

export function isMacPlatform(): boolean {
  if (typeof window !== "undefined" && window.ogb?.platform) {
    return window.ogb.platform === "darwin";
  }
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    return navigator.userAgent.includes("Mac");
  }
  return true;
}

export function shortcutKeysForPlatform(
  item: ShortcutItem,
  isMac: boolean = isMacPlatform(),
): string[] {
  return isMac ? item.macKeys : item.winKeys;
}

export function filterShortcutGroups(
  groups: readonly ShortcutGroup[],
  query: string,
  isMac: boolean = isMacPlatform(),
): ShortcutGroup[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...groups];

  return groups
    .map((group) => {
      const filteredItems = group.items.filter((item) => {
        const keys = shortcutKeysForPlatform(item, isMac).join(" ").toLowerCase();
        return (
          t(item.description).toLowerCase().includes(normalized) ||
          t(group.category).toLowerCase().includes(normalized) ||
          keys.includes(normalized)
        );
      });
      return { ...group, items: filteredItems };
    })
    .filter((group) => group.items.length > 0);
}

export function commandPaletteKeys(isMac: boolean = isMacPlatform()): string {
  return isMac ? "⌘K" : "Ctrl+K";
}

export type AppChord = "new-bot" | "new-conversation" | "open-settings";

/** Browsers report Shift+O as "O", and some keyboard layouts report "," only through `code`. */
export function appChordFor(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): AppChord | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "n" && !event.shiftKey) return "new-bot";
  if (key === "o" && event.shiftKey) return "new-conversation";
  if ((key === "," || event.code === "Comma") && !event.shiftKey) return "open-settings";
  return null;
}
