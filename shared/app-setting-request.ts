/**
 * Durable payload carried by an app-setting confirmation card (propose_app_setting).
 *
 * `setting` and `value` are a closed pair: the server rejects a value that
 * does not belong to the named setting. `before` is the value the person had
 * (a bot's approval level, or, for the settings the browser keeps, absent
 * because only the client can read it). Any change to a bot's permissions
 * waits for the card; the settings the browser keeps apply at once and can be
 * undone.
 */
export const APP_SETTING_KEYS = ["language", "theme", "interface_mode", "approval_mode"] as const;
export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

export const APP_SETTING_LANGUAGES = ["en", "de", "es", "fr", "hi", "ja", "pt-br", "zh", "zh-tw", "uk", "vi", "tr"] as const;
export const APP_SETTING_THEMES = ["dark", "light", "auto"] as const;
export const APP_SETTING_INTERFACE_MODES = ["simple", "advanced"] as const;
export const APP_SETTING_APPROVAL_MODES = ["ask", "edits", "auto", "full"] as const;

export const APP_SETTING_VALUES: readonly string[] = [...new Set<string>([
  ...APP_SETTING_LANGUAGES,
  ...APP_SETTING_THEMES,
  ...APP_SETTING_INTERFACE_MODES,
  ...APP_SETTING_APPROVAL_MODES,
])];

const VALUES: Record<AppSettingKey, readonly string[]> = {
  language: APP_SETTING_LANGUAGES,
  theme: APP_SETTING_THEMES,
  interface_mode: APP_SETTING_INTERFACE_MODES,
  approval_mode: APP_SETTING_APPROVAL_MODES,
};

/** The settings only the browser can change; their `before` lives on the client. */
export function isClientAppSetting(setting: AppSettingKey): boolean {
  return setting !== "approval_mode";
}

export function isAppSettingKey(value: unknown): value is AppSettingKey {
  return typeof value === "string" && (APP_SETTING_KEYS as readonly string[]).includes(value);
}

/** Higher is more permissive. `custom`, an unknown value and anything that is
 * not a string rank below Ask, so moving away from them always counts as a
 * raise and always asks the person first. */
const APPROVAL_MODE_RANK: Record<string, number> = { ask: 0, edits: 1, auto: 2, full: 3 };

export function approvalModeRank(value: unknown): number {
  return typeof value === "string" ? APPROVAL_MODE_RANK[value] ?? -1 : -1;
}

/** True when `next` grants strictly more than `current`. */
export function isApprovalElevation(current: unknown, next: unknown): boolean {
  return approvalModeRank(next) > approvalModeRank(current);
}

/** Null unless the value belongs to that very setting. */
export function checkedAppSettingValue(setting: AppSettingKey, value: unknown): string | null {
  if (typeof value !== "string") return null;
  return VALUES[setting].includes(value) ? value : null;
}

export interface AppSettingRequestCardData {
  version: 1;
  requestId: string;
  /** The proposing conversation; authority is fixed here. */
  botId: string;
  threadId: string;
  /** Whose approval level changes when the setting is approval_mode. */
  targetBotId: string;
  targetName: string;
  createdAt: number;
  reason: string;
  setting: AppSettingKey;
  value: string;
  /** Absent for a browser-only setting, whose current value the server cannot read. */
  before?: string;
  /** A permission change never applies without this card. */
  requiresConfirmation: boolean;
  /** The card carries the same warning the desktop shows before Auto on this computer. */
  localAutoWarning?: boolean;
  appliedAt?: number;
}
