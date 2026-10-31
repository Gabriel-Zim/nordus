// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingRequestCardData } from "../../shared/app-setting-request";

const card = (request: Partial<AppSettingRequestCardData> & Pick<AppSettingRequestCardData, "setting" | "value">, extra: {
  autoApplied?: boolean;
  answered?: string;
  undone?: boolean;
} = {}) => ({
  autoApplied: true,
  answered: "allow",
  ...extra,
  appSettingRequest: {
    version: 1 as const,
    requestId: "req-1",
    botId: "bot-1",
    threadId: "thread-1",
    targetBotId: "bot-1",
    targetName: "Scout",
    createdAt: 1,
    reason: "asked",
    requiresConfirmation: false,
    appliedAt: 2,
    ...request,
  },
});

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("settleAppSettingCard", () => {
  it("applies the theme the card asked for and puts the previous one back on undo", async () => {
    const theme = await import("./theme-mode");
    const { settleAppSettingCard } = await import("./app-setting-cards");
    theme.applyThemeMode("dark");
    settleAppSettingCard(card({ setting: "theme", value: "light" }));
    expect(theme.readThemeMode()).toBe("light");
    settleAppSettingCard(card({ setting: "theme", value: "light" }, { undone: true }));
    expect(theme.readThemeMode()).toBe("dark");
  });

  it("does not re-apply an old card after the person changed the setting by hand", async () => {
    const theme = await import("./theme-mode");
    const { settleAppSettingCard } = await import("./app-setting-cards");
    theme.applyThemeMode("dark");
    const history = card({ setting: "theme", value: "light" });
    settleAppSettingCard(history);
    theme.applyThemeMode("dark");
    settleAppSettingCard(history);
    expect(theme.readThemeMode()).toBe("dark");
  });

  it("records nothing when the setting already had that value", async () => {
    const theme = await import("./theme-mode");
    const { settleAppSettingCard } = await import("./app-setting-cards");
    theme.applyThemeMode("light");
    const history = card({ setting: "theme", value: "light" });
    settleAppSettingCard(history);
    theme.applyThemeMode("dark");
    settleAppSettingCard({ ...history, undone: true });
    expect(theme.readThemeMode()).toBe("dark");
  });

  it("switches the language and restores the one in use before", async () => {
    const language = await import("./language-preference");
    const { settleAppSettingCard } = await import("./app-setting-cards");
    language.setLanguageChoice("en");
    settleAppSettingCard(card({ setting: "language", value: "pt-br" }));
    expect(language.languageChoice()).toBe("pt-br");
    settleAppSettingCard(card({ setting: "language", value: "pt-br" }, { undone: true }));
    expect(language.languageChoice()).toBe("en");
  });

  it("uses the server's default language as the value to restore", async () => {
    const language = await import("./language-preference");
    const { settleAppSettingCard } = await import("./app-setting-cards");
    expect(language.languageChoice()).toBeNull();
    settleAppSettingCard(card({ setting: "language", value: "pt-br" }), "en");
    expect(language.languageChoice()).toBe("pt-br");
    settleAppSettingCard(card({ setting: "language", value: "pt-br" }, { undone: true }), "en");
    expect(language.languageChoice()).toBe("en");
  });

  it("turns the simple app into the advanced one and back", async () => {
    const mode = await import("./interface-mode");
    const { settleAppSettingCard } = await import("./app-setting-cards");
    mode.setAdvancedMode(false);
    settleAppSettingCard(card({ setting: "interface_mode", value: "advanced" }));
    expect(mode.readAdvancedMode()).toBe(true);
    settleAppSettingCard(card({ setting: "interface_mode", value: "advanced" }, { undone: true }));
    expect(mode.readAdvancedMode()).toBe(false);
  });

  it("leaves permission levels to the server", async () => {
    const { settleAppSettingCard, APP_SETTING_UNDO_KEY } = await import("./app-setting-cards");
    settleAppSettingCard(card({ setting: "approval_mode", value: "auto" }));
    expect(localStorage.getItem(APP_SETTING_UNDO_KEY)).toBeNull();
  });

  it("waits for the card actually applied, and never touches a pending one", async () => {
    const theme = await import("./theme-mode");
    const { settleAppSettingCard } = await import("./app-setting-cards");
    theme.applyThemeMode("dark");
    settleAppSettingCard(card({ setting: "theme", value: "light" }, { autoApplied: false, answered: undefined }));
    expect(theme.readThemeMode()).toBe("dark");
  });
});

describe("appSettingWarning", () => {
  it("shows the same Auto warning the desktop shows on a local computer", async () => {
    const { appSettingWarning } = await import("./app-setting-cards");
    const warning = appSettingWarning(card({
      setting: "approval_mode",
      value: "auto",
      before: "ask",
      requiresConfirmation: true,
      localAutoWarning: true,
    }).appSettingRequest);
    expect(warning).toContain("Allow Auto mode on this computer?");
    expect(warning).toContain("without asking first");
  });

  it("warns when the level rises and stays quiet when it drops", async () => {
    const { appSettingWarning } = await import("./app-setting-cards");
    const raised = appSettingWarning(card({
      setting: "approval_mode",
      value: "auto",
      before: "ask",
      requiresConfirmation: true,
    }).appSettingRequest);
    expect(raised).toContain("This lets Scout do some things without asking you first.");
    const lowered = appSettingWarning(card({
      setting: "approval_mode",
      value: "ask",
      before: "auto",
      requiresConfirmation: true,
    }).appSettingRequest);
    expect(lowered).toBe("");
  });
});
