import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group, Message } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const state = { ...original.initialState, config: { ...original.initialState.config, profile: { name: "Avery", email: "avery@example.test" } } };
  return { ...original, useStore: () => ({ state, dispatch: vi.fn() }) };
});
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { Transcript } = await import("./GroupView");

const ada = { id: "ada", name: "Ada", color: "blue" } as Bot;
const room = {
  id: "room", threadId: "room-thread", name: "Geral", memberIds: ["ada"],
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1, messages: [],
} as Group;
const at = 1_700_000_000_000;
const line = (id: string, text: string, sender?: Message["sender"]): Message => ({ id, role: "user", kind: "text", at, text, ...(sender ? { sender } : {}) });

function markup(messages: Message[]) {
  return renderToStaticMarkup(createElement(Transcript, {
    group: { ...room, messages }, members: [ada], locale: "en", messages, transcript: messages, onReply: () => {},
  }));
}

beforeEach(() => {
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("room messages from other people", () => {
  it("keeps my own messages right-aligned and unlabelled", () => {
    const html = markup([line("m1", "plain"), line("m2", "signed", { name: "Avery", email: "Avery@example.test" })]);
    expect(html).not.toContain("data-room-person");
    expect(html.match(/justify-end/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("shows another person's name and initials on the left", () => {
    const html = markup([line("m1", "olá time", { name: "Priya Rao", email: "priya@example.test" })]);
    expect(html).toContain("data-room-person");
    expect(html).toContain("Priya Rao");
    expect(html).toContain(">PR<");
    expect(html).not.toContain("justify-end");
  });
});
