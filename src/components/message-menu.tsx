import { Code, Copy, Eye, ListChecks, ListTodo, Pencil, Pin, PinOff, RefreshCw, Square, Star, StarOff, Volume2 } from "lucide-react";
import { openTaskFromMessage, type MessageTask } from "@/lib/board-compose";
import { copyText } from "@/lib/copy-text";
import { activeLocale, t } from "@/lib/i18n";
import type { ConfigStatus, Group, Message, useStore } from "@/state/store";
import { ACTION_ICON, type MessageMenuItem } from "@/components/MessageActions";
import { useSpeakAction } from "@/components/SpeakButton";

export type PinAction = { pinned: boolean; onToggle: () => void; hint?: string };
export type FavoriteAction = { starred: boolean; onToggle: () => void };

function favoriteItem(favorite: FavoriteAction | undefined): MessageMenuItem[] {
  if (!favorite) return [];
  return [{
    key: "favorite",
    icon: favorite.starred ? <StarOff {...ACTION_ICON} /> : <Star {...ACTION_ICON} />,
    label: favorite.starred ? t("chat.unfavoriteMessage") : t("chat.favoriteMessage"),
    onSelect: favorite.onToggle,
  }];
}

function taskItem(task: MessageTask | undefined): MessageMenuItem[] {
  if (!task?.text.trim()) return [];
  return [{ key: "create-task", icon: <ListTodo {...ACTION_ICON} />, label: t("board.menu.createTask"), onSelect: () => openTaskFromMessage(task) }];
}

export function roomPin(group: Group, message: Message, dispatch: ReturnType<typeof useStore>["dispatch"]): PinAction | undefined {
  if (window.ogb?.remoteClient?.active) return undefined;
  const pinned = group.pinnedMessageId === message.id;
  return {
    pinned,
    hint: t("room.pinHint"),
    onToggle: () => dispatch({ type: "patchGroup", groupId: group.id, patch: { pinnedMessageId: pinned ? "" : message.id } }),
  };
}

function pinItem(pin: PinAction | undefined): MessageMenuItem[] {
  if (!pin) return [];
  return [{
    key: "pin",
    icon: pin.pinned ? <PinOff {...ACTION_ICON} /> : <Pin {...ACTION_ICON} />,
    label: pin.pinned ? t("chat.unpinMessage") : t("chat.pinMessage"),
    title: pin.pinned ? t("chat.unpinHint") : pin.hint ?? t("chat.pinHint"),
    onSelect: pin.onToggle,
  }];
}

/** The Nordus chat (any language but English) keeps markdown source and message ids out of sight. */
function plainChat(): boolean {
  return activeLocale() !== "en";
}

function idItem(messageId: string): MessageMenuItem[] {
  if (plainChat()) return [];
  return [{ key: "copy-id", icon: <Copy {...ACTION_ICON} />, label: t("chat.copyMessageId"), onSelect: () => { void copyText(messageId); } }];
}

export function useBotMessageMenu({
  text,
  botId,
  messageId,
  voiceId,
  tts,
  localVoice,
  canSpeak,
  viewRaw,
  onToggleRaw,
  onRegenerate,
  pin,
  favorite,
  task,
  onWhatItDid,
}: {
  text: string;
  botId?: string;
  messageId: string;
  voiceId?: string;
  tts: ConfigStatus["tts"];
  localVoice: boolean;
  canSpeak: boolean;
  viewRaw: boolean;
  onToggleRaw: () => void;
  onRegenerate?: () => void;
  pin?: PinAction;
  favorite?: FavoriteAction;
  task?: MessageTask;
  onWhatItDid?: () => void;
}): MessageMenuItem[] {
  const speak = useSpeakAction({ text, botId, messageId, voiceId, tts, localVoice });
  const items: MessageMenuItem[] = [];
  if (canSpeak && text) {
    items.push({
      key: "speak",
      icon: speak.mine ? <Square {...ACTION_ICON} /> : <Volume2 {...ACTION_ICON} />,
      label: speak.mine ? t("chat.speak.stop") : t("chat.speak.read"),
      title: speak.label,
      disabled: !speak.ready,
      onSelect: speak.toggle,
    });
  }
  if (text && !plainChat()) {
    items.push({
      key: "raw",
      icon: viewRaw ? <Eye {...ACTION_ICON} /> : <Code {...ACTION_ICON} />,
      label: t(viewRaw ? "chat.showRenderedMarkdown" : "chat.showRawMarkdown"),
      onSelect: onToggleRaw,
    });
  }
  if (onWhatItDid) items.push({ key: "what-it-did", icon: <ListChecks {...ACTION_ICON} />, label: t("whatItDid.menu"), onSelect: onWhatItDid });
  if (onRegenerate) items.push({ key: "regenerate", icon: <RefreshCw {...ACTION_ICON} />, label: t("chat.regenerate"), onSelect: onRegenerate });
  items.push(...taskItem(task), ...pinItem(pin), ...favoriteItem(favorite), ...idItem(messageId));
  return items;
}

export function userMessageMenu({ messageId, onEdit, pin, favorite, task }: { messageId: string; onEdit?: () => void; pin?: PinAction; favorite?: FavoriteAction; task?: MessageTask }): MessageMenuItem[] {
  return [
    ...(onEdit ? [{ key: "edit", icon: <Pencil {...ACTION_ICON} />, label: t("chat.editMessage"), onSelect: onEdit }] : []),
    ...taskItem(task),
    ...pinItem(pin),
    ...favoriteItem(favorite),
    ...idItem(messageId),
  ];
}
