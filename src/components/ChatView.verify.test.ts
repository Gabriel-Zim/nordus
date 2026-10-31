import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { askText, runSteps, skillPrompt } from "@/lib/verify-steps";
import { SAVE_RUN_AS_SKILL_LINE } from "../../shared/learn-request";
import type { VerifyCard } from "./VerifyCard";
import { citationAttachment, createCitationTextSelector, serializeCitation } from "@/lib/citations";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return {
    dispatch: vi.fn(),
    appendComposerDraft: vi.fn(),
    showRunCard: true,
    state: null as Partial<AppState> | null,
    verify: null as ComponentProps<typeof VerifyCard> | null,
  };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/drafts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/drafts")>();
  return { ...original, appendComposerDraft: fixture.appendComposerDraft };
});
// The real card renders; its props are kept so a test can press Save.
vi.mock("./VerifyCard", async (importOriginal) => {
  const original = await importOriginal<typeof import("./VerifyCard")>();
  return { VerifyCard: (props: ComponentProps<typeof VerifyCard>) => {
    fixture.verify = props;
    return createElement(original.VerifyCard, props);
  } };
});
// The real useCaptionChrome rides along: it only asks this module for the window chrome.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
// A renderer preference, not what these tests are about; the fixture stands in for the stored value.
vi.mock("@/lib/run-card-preferences", () => ({ useShowRunCard: () => fixture.showRunCard }));
// The thread controls read live model lists; they are not what this file tests.
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span", { "data-test-model-control": true }) }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span", { "data-test-approval-control": true }) }));

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  fixture.state = null;
  fixture.verify = null;
  fixture.showRunCard = true;
  vi.clearAllMocks();
});

const bot: Bot = {
  id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "profile-default" },
};
const chip = (id: string, summary: string, ok?: boolean): Message =>
  ({ id, at: 1, role: "bot", kind: "activity", tool: { name: "Bash", summary, ...(ok === undefined ? {} : { ok }) } });
const asked = (id: string, text: string): Message => ({ id, role: "user", kind: "text", at: 1, text });
const run: Message[] = [
  asked("u1", "verify the fixture"),
  chip("c1", "pnpm control:nordus doctor --url http://127.0.0.1:8799", true),
  chip("c2", "node --experimental-strip-types scripts/control-nordus.ts send --bot x --text hi", false),
  chip("c3", "git status", true),
  chip("c4", "cat scripts/control-nordus.ts", true),
];
const release: Message[] = [
  asked("u1", "publish the release"),
  chip("c1", "git push origin main", true),
  chip("c2", "cat CHANGELOG.md", true),
  chip("c3", "npm publish", false),
];
const agentsEngine = { instanceId: "test", driverKind: "claude", displayName: "Test", capabilities: { agentsMcp: true } } as unknown as InstanceInfo;
const saveable = (): void => {
  fixture.state = { instances: [agentsEngine], config: { features: { skillAuthoring: true } } as AppState["config"] };
};
const CARD = `aria-label="${t("chat.verify.aria")}"`;
const render = (messages: Message[]) => renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, messages } }));

describe("The run card in the chat pane", () => {
  it("renders a sent citation as a badge and keeps raw metadata out of edit actions", () => {
    const citation = citationAttachment(
      { ownerType: "bot", ownerId: bot.id, threadId: bot.threadId, messageId: "source" },
      createCitationTextSelector("source quote", 0, 12)!,
      "note",
    );
    const markup = render([asked("cited", serializeCitation(citation))]);
    expect(markup).toContain("Open citation: source quote");
    // A popup, not a block that opens in place: tapping it must not stop the reply from being followed.
    expect(markup).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-label="Open citation: source quote/);
    expect(markup).not.toContain("nordus-citation-v1");
    expect(markup).not.toContain(`aria-label="${t("chat.editMessage")}"`);
  });

  it("never opens the steps on its own after a reply, with or without Save, wherever the run came from", () => {
    for (const messages of [run, release]) {
      fixture.state = null;
      expect(render(messages)).not.toContain(CARD);
      saveable();
      const markup = render(messages);
      expect(markup).not.toContain(CARD);
      expect(markup).not.toContain(t("chat.verify.saveHint"));
      expect(markup).toContain('class="pointer-events-none absolute inset-x-0 bottom-0 z-[2] chat-column-dock"');
    }
  });

  it("keeps the run's skill draft the same for the menu's Save", () => {
    expect(skillPrompt(runSteps(run), askText(run)).startsWith("Create a verification skill from the run below.\nGoal: verify the fixture\n")).toBe(true);
    expect(skillPrompt(runSteps(release), askText(release)).startsWith(`${SAVE_RUN_AS_SKILL_LINE}\nGoal: publish the release\n`)).toBe(true);
  });
});
