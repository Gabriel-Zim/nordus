// Settings the browser owns (language, theme, simple/advanced) arrive as a chat card,
// so the card applies them and keeps the previous value to undo later, on this device.
import { isApprovalElevation, type AppSettingRequestCardData } from "../../shared/app-setting-request";
import { localeChoices } from "@/locales";
import { t } from "./i18n";
import { applyThemeMode, readThemeMode, THEME_MODES, type ThemeMode } from "./theme-mode";
import { languageChoice, setLanguageChoice } from "./language-preference";
import { readAdvancedMode, setAdvancedMode } from "./interface-mode";

export const APP_SETTING_UNDO_KEY = "nordus-app-setting-undo";
const UNDO_LIMIT = 20;

type UndoLedger = Record<string, { setting: string; value: string }>;

function memoryStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readLedger(storage: Storage): UndoLedger {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(APP_SETTING_UNDO_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as UndoLedger : {};
  } catch {
    return {};
  }
}

function writeLedger(storage: Storage, ledger: UndoLedger): void {
  const entries = Object.entries(ledger).slice(-UNDO_LIMIT);
  try {
    storage.setItem(APP_SETTING_UNDO_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
  }
}

export function currentAppSetting(setting: string, serverLanguage?: string): string {
  if (setting === "theme") return readThemeMode();
  if (setting === "interface_mode") return readAdvancedMode() ? "advanced" : "simple";
  return languageChoice() ?? serverLanguage ?? "en";
}

export function applyAppSetting(setting: string, value: string): void {
  if (setting === "theme" && (THEME_MODES as readonly string[]).includes(value)) applyThemeMode(value as ThemeMode);
  else if (setting === "interface_mode") setAdvancedMode(value === "advanced");
  else if (setting === "language") setLanguageChoice(value);
}

/** Applies an auto-applied card once per request and reverts it when the person undoes it. */
export function settleAppSettingCard(
  card: {
    appSettingRequest?: AppSettingRequestCardData;
    autoApplied?: boolean;
    answered?: string;
    undone?: boolean;
    appliedAt?: number;
  },
  serverLanguage?: string,
  storage: Storage | undefined = memoryStorage(),
): void {
  const request = card.appSettingRequest;
  if (!request || request.setting === "approval_mode" || !storage) return;
  const ledger = readLedger(storage);
  const previous = ledger[request.requestId];
  if (card.undone) {
    if (!previous) return;
    const next = { ...ledger };
    delete next[request.requestId];
    writeLedger(storage, next);
    applyAppSetting(previous.setting, previous.value);
    return;
  }
  const applied = card.autoApplied === true && card.answered === "allow" && request.appliedAt !== undefined;
  if (!applied || previous) return;
  const before = currentAppSetting(request.setting, serverLanguage);
  if (before === request.value) return;
  writeLedger(storage, { ...ledger, [request.requestId]: { setting: request.setting, value: before } });
  applyAppSetting(request.setting, request.value);
}

export function appSettingValueLabel(request: Pick<AppSettingRequestCardData, "setting" | "value">): string {
  if (request.setting === "language") {
    return localeChoices.find((choice) => choice.code === request.value)?.label ?? request.value;
  }
  if (request.setting === "theme") {
    return t(request.value === "light" ? "settings.theme.light" : request.value === "auto" ? "settings.theme.auto" : "settings.theme.dark");
  }
  if (request.setting === "interface_mode") {
    return t(request.value === "advanced" ? "appSetting.mode.advanced" : "appSetting.mode.simple");
  }
  if (request.value === "full") return t("approvalMode.full.label");
  if (request.value === "edits") return t("approvalMode.edits.label");
  if (request.value === "auto") return t("approvalMode.auto.label");
  return t("approvalMode.ask.label");
}

export function appSettingLabel(request: Pick<AppSettingRequestCardData, "setting" | "targetName">): string {
  if (request.setting === "language") return t("approval.setting.language");
  if (request.setting === "theme") return t("approval.setting.theme");
  if (request.setting === "interface_mode") return t("approval.setting.interfaceMode");
  return t("approval.setting.approvalMode", { name: request.targetName });
}

export function appSettingLine(request: Pick<AppSettingRequestCardData, "setting" | "value" | "targetName">): string {
  return t("approval.setting.change", { setting: appSettingLabel(request), value: appSettingValueLabel(request) });
}

/** The warning shown on a card that waits for the person: the local-computer
 * Auto warning is the one the desktop shows, Full access has its own sentence,
 * and a smaller raise says plainly what it changes. A lower level carries no
 * permission warning. */
export function appSettingWarning(
  request: Pick<
    AppSettingRequestCardData,
    "value" | "before" | "targetName" | "requiresConfirmation" | "localAutoWarning"
  > & { setting?: AppSettingRequestCardData["setting"] },
): string {
  if (request.setting === "approval_mode" || request.setting === undefined) {
    const parts: string[] = [];
    if (request.localAutoWarning) {
      parts.push(`${t("permissions.localAuto.title")} ${t("permissions.localAuto.body")}`);
    }
    if (request.requiresConfirmation && isApprovalElevation(request.before, request.value)) {
      parts.push(request.value === "full"
        ? t("appSetting.fullAccessWarning")
        : t("appSetting.morePermissiveWarning", { name: request.targetName }));
    }
    return parts.filter(Boolean).join(" ");
  }
  if (!request.requiresConfirmation) return "";
  if (request.value === "full") return t("appSetting.fullAccessWarning");
  if (request.value === "edits" || request.value === "auto") {
    return t("appSetting.morePermissiveWarning", { name: request.targetName });
  }
  return "";
}
