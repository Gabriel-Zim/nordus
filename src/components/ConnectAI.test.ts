// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BotEditorStore, initialState, type InstanceInfo } from "@/state/store";
import { canConnectAutomatically } from "@/lib/use-connect-engine";
import { aiFamily, ConnectAI, friendlyAIName } from "./ConnectAI";

function instance(overrides: Partial<InstanceInfo> & Pick<InstanceInfo, "instanceId" | "driverKind" | "displayName">): InstanceInfo {
  return {
    snapshot: { state: "available", authenticated: false },
    ...overrides,
  } as InstanceInfo;
}

const automatic = instance({
  instanceId: "claude",
  driverKind: "claudeAgent",
  displayName: "Claude Code",
  authentication: { method: "paste-code" },
  install: { server: { package: "@anthropic-ai/claude-code" }, command: { linux: "curl install claude" } },
});

const manual = instance({
  instanceId: "kimi",
  driverKind: "kimiAgent",
  displayName: "Kimi",
  snapshot: { state: "unavailable", reason: "not installed" },
  install: { command: { linux: "npm install -g kimi-cli" } },
});

const ready = instance({
  instanceId: "grok",
  driverKind: "grokAgent",
  displayName: "Grok",
  snapshot: { state: "available", authenticated: true },
  authentication: { method: "device-code" },
  install: { server: { package: "grok" } },
});

function render(instances: InstanceInfo[]) {
  const value = {
    state: { ...initialState, instances },
    dispatch: vi.fn(),
    refreshInstances: vi.fn(),
    refreshModels: vi.fn(),
  } as unknown as Parameters<typeof BotEditorStore>[0]["value"];
  return renderToStaticMarkup(createElement(BotEditorStore, { value, children: createElement(ConnectAI) }));
}

beforeEach(() => setLocale("en"));

describe("the AI chooser", () => {
  it("puts automatic connections first and leaves terminal setup inside the help section", () => {
    expect(canConnectAutomatically(automatic)).toBe(true);
    expect(canConnectAutomatically(manual)).toBe(false);
    expect(aiFamily(automatic)).toBe("claude");
    expect(aiFamily(ready)).toBe("grok");
    expect(aiFamily(manual)).toBe("kimi");
    const html = render([manual, automatic, ready]);
    const [main, help = ""] = html.split("data-connect-ai-fallback");

    expect(main).toContain("Choose your AI");
    expect(main).toContain("Claude");
    expect(main).toContain("Sign in to Claude");
    expect(main).toContain("Grok");
    expect(main).toContain("Connected");
    expect(main).not.toContain("Kimi");
    expect(main).not.toContain("npm install -g kimi-cli");

    expect(help).toContain("Need help?");
    expect(help).toContain("Kimi");
    expect(help).toContain("npm install -g kimi-cli");
    expect(help).toContain("Use an API key");
  });

  it("keeps API-key engines out of the friendly grid", () => {
    const api = instance({
      instanceId: "openai",
      driverKind: "openai",
      displayName: "OpenAI API",
      access: "api",
      install: { settings: "connections" },
    });
    const html = render([automatic, api]);
    const [main] = html.split("data-connect-ai-fallback");
    expect(main).not.toContain("OpenAI API");
    expect(html).toContain("Use an API key");
  });

  it("shows friendly provider names instead of driver names", () => {
    expect(friendlyAIName(instance({ instanceId: "c", driverKind: "claudeAgent", displayName: "Claude Code" }))).toBe("Claude");
    expect(friendlyAIName(instance({ instanceId: "g", driverKind: "grokAgent", displayName: "grok" }))).toBe("Grok");
    expect(friendlyAIName(instance({ instanceId: "a", driverKind: "antigravityAgent", displayName: "Antigravity" }))).toBe("Gemini");
    expect(friendlyAIName(instance({
      instanceId: "x",
      driverKind: "codex",
      displayName: "ChatGPT plan",
      authentication: { method: "browser-pkce" },
      snapshot: { state: "available", authenticated: false, chatgptPlan: true },
    }))).toBe("ChatGPT");
    expect(friendlyAIName(instance({ instanceId: "c2", driverKind: "codex", displayName: "Codex" }))).toBe("ChatGPT");
  });

  it("shows one card per AI even when the server offers two Codex entries", () => {
    const plain = instance({
      instanceId: "codex",
      driverKind: "codex",
      displayName: "Codex",
      authentication: { method: "device-code" },
      install: { server: { package: "@openai/codex" } },
    });
    const plan = instance({
      instanceId: "chatgpt",
      driverKind: "codex",
      displayName: "ChatGPT plan",
      authentication: { method: "browser-pkce" },
      snapshot: { state: "available", authenticated: false, chatgptPlan: true },
      install: { server: { package: "@openai/codex" } },
    });
    const html = render([plain, plan]);
    expect(html.match(/data-connect-ai-card/g)).toHaveLength(1);
    expect(html).toContain("Continue with ChatGPT");
  });
});
