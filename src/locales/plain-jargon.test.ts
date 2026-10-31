import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pt = JSON.parse(readFileSync(new URL("./pt-br.json", import.meta.url), "utf8")) as Record<string, string>;
const en = JSON.parse(readFileSync(new URL("./en.json", import.meta.url), "utf8")) as Record<string, string>;

/** Every key whose Brazilian Portuguese copy was rewritten to plain language in this pass. */
export const PLAIN_REWRITTEN_KEYS = [
  "noEngines.title", "noEngines.intro",
  "connectAI.apiKey", "connectAI.apiKeyHint",
  "approval.action.alwaysAllowSession", "approval.action.alwaysAllowSessionHint",
  "approval.action.alwaysAllowCommandHint", "approval.held.native", "approval.held.sandbox",
  "approval.tool.runCommand", "approval.tool.writeFile", "approval.tool.fetchWebPage",
  "approval.compact.wantsToRun", "approval.card.namedWantsTo", "approval.applied.details", "approval.applied.hideDetails",
  "settings.advancedMode.subtitle",
  "settings.mcpCalls.title", "settings.mcpCalls.subtitle", "settings.mcpCalls.help", "settings.mcpCalls.error",
  "settings.welcome.subtitle",
  "sidebar.bot.chiefNeedsEngine", "sidebar.connectionsToFinish",
  "sidebar.update.handedOff", "sidebar.update.openingTerminal",
  "chat.claudeUpdate.manual", "chat.webhookTask",
  "chat.usage.uncachedInput", "chat.usage.cachedInput", "chat.usage.totalInput", "chat.usage.output",
  "chat.usage.uncachedShort", "chat.usage.inputShort", "chat.usage.tokens", "chat.usage.new", "chat.usage.reread",
  "chat.usage.context", "chat.usage.contextOfWindow", "chat.usage.in", "chat.usage.inCached", "chat.usage.out",
  "chat.keepWarm.last", "chat.keepWarm.lastCost", "chat.usage.captionMetered", "chat.usage.captionEngine",
  "chat.speak.needsSetup", "chat.error.chooseOtherModel",
  "error.plain.modelUnavailable", "error.plain.modelUnavailableShort",
  "model.simple.provider", "model.simple.apiKey", "model.apiKeyHint", "model.noProviders", "policy.modelBlocked",
  "onboarding.engines.title", "onboarding.engines.intro", "onboarding.org.personalOptional",
  "onboarding.tour.automations", "onboarding.tour.done", "onboarding.reel.automations.body",
  "onboarding.reel.terminal.title", "onboarding.reel.terminal.body",
  "browser.notInstalled", "browser.noEngine",
] as const;

const FORBIDDEN = /\b(?:CLI|MCP|API|token|tokens|provedor|provedores|driver|terminal)\b/i;

describe("plain Brazilian Portuguese", () => {
  it("keeps technical words out of the copy a simple-mode person reads", () => {
    const offenders = PLAIN_REWRITTEN_KEYS.flatMap((key) => {
      const value = pt[key];
      expect(value, `${key} is missing from pt-br.json`).toBeTypeOf("string");
      const words = value.replace(/\{\w+\}/g, " ");
      return FORBIDDEN.test(words) ? [`${key}: ${value}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("keeps the rewritten keys in the English source, so translations stay checkable", () => {
    for (const key of PLAIN_REWRITTEN_KEYS) expect(en[key], key).toBeTypeOf("string");
  });
});
