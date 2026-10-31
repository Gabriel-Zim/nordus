import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/message-author";
import type { Bot, Group, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ me: {} as Me, colorMine: false }));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const state = { ...original.initialState, config: { ...original.initialState.config, profile: { name: "Avery", email: "avery@example.test" } } };
  return { ...original, useStore: () => ({ state, dispatch: vi.fn() }) };
});
vi.mock("@/lib/message-author", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/message-author")>()), useMe: () => fixture.me }));
vi.mock("@/lib/user-bubble-preference", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/user-bubble-preference")>()), useColorUserBubbles: () => fixture.colorMine }));
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { Transcript } = await import("./GroupView");
const { ROOM_OWN_BUBBLE_COLOR, userBubbleTone } = await import("@/lib/user-bubble-tone");

const OWNER = "avery@example.test";
const MARIA = "maria@example.test";
const PHOTO = "/api/attachments/avery-1.png";
const ada = { id: "ada", name: "Ada", color: "blue" } as Bot;
const room = {
  id: "room", threadId: "room-thread", name: "Geral", memberIds: ["ada"],
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1, messages: [],
} as Group;
const at = 1_700_000_000_000;
const line = (id: string, text: string, sender?: Message["sender"]): Message => ({ id, role: "user", kind: "text", at, text, ...(sender ? { sender } : {}) });

const owned = line("o1", "Alo @everyone", { name: "Chrome on Mac", admin: true });
const ownedByName = line("o2", "Fala turma", { name: "Avery", email: OWNER, avatarUrl: PHOTO, admin: true });
const fromMaria = line("m1", "Bom dia", { name: "Maria Souza", email: MARIA, notOwner: true });
const ownerSeenByOthers = line("g1", "Bom dia, time", { name: "Avery", email: OWNER, avatarUrl: PHOTO, admin: true });

function markup(messages: Message[]) {
  return renderToStaticMarkup(createElement(Transcript, {
    group: { ...room, messages }, members: [ada], locale: "en", messages, transcript: messages, onReply: () => {},
  }));
}

beforeEach(() => {
  vi.stubGlobal("window", {});
});

afterEach(() => {
  fixture.colorMine = false;
  vi.unstubAllGlobals();
});

describe("the owner's lines in the owner's own browser", () => {
  beforeEach(() => {
    fixture.me = { owner: true, name: "Avery", email: OWNER };
  });

  it("stay on the right with no name or initials, whether the device was stamped with its label or the profile", () => {
    const html = markup([owned, ownedByName]);
    expect(html).not.toContain("data-room-person");
    expect(html).not.toContain("Chrome on Mac");
    expect(html).not.toContain(">CO<");
    expect(html.match(/data-side="me"/g)).toHaveLength(2);
    expect(html).not.toContain('data-side="them"');
    expect(html).toContain("justify-end");
  });

  it("put another person's line on the left, with their name and initials", () => {
    const html = markup([owned, fromMaria]);
    expect(html.match(/data-side="me"/g)).toHaveLength(1);
    expect(html.match(/data-side="them"/g)).toHaveLength(1);
    expect(html).toContain("data-room-person");
    expect(html).toContain("Maria Souza");
    expect(html).toContain(">MS<");
  });
});

describe("the owner's lines in another person's browser", () => {
  beforeEach(() => {
    fixture.me = { name: "Maria Souza", email: MARIA };
  });

  it("show the owner on the left, with the name and the profile photo", () => {
    const html = markup([ownerSeenByOthers]);
    expect(html).toContain("data-room-person");
    expect(html).toContain("Avery");
    expect(html).toContain(`src="${PHOTO}"`);
    expect(html).not.toContain(">A<");
    expect(html).toContain('data-side="them"');
  });

  it("show initials where the owner has no photo", () => {
    const html = markup([line("g2", "Oi", { name: "Avery", email: OWNER, admin: true })]);
    expect(html).toContain(">A<");
    expect(html).not.toContain("<img");
  });

  it("keep her own lines on the right, with no name", () => {
    const html = markup([fromMaria, ownerSeenByOthers]);
    expect(html.match(/data-side="me"/g)).toHaveLength(1);
    expect(html.match(/data-room-person=""/g)).toHaveLength(1);
  });
});

describe("the owner's bubble colour in a room", () => {
  const tone = () => userBubbleTone(ROOM_OWN_BUBBLE_COLOR);

  beforeEach(() => {
    fixture.me = { owner: true, name: "Avery", email: OWNER };
  });

  it("is painted like the one-to-one bubble when the setting is on", () => {
    fixture.colorMine = true;
    const html = markup([owned]);
    expect(html).toContain("user-bubble-colored");
    expect(html).toContain(`background-color:${tone().background}`);
    expect(html).toContain(`background-image:${tone().gradient}`);
    expect(html).toContain(`--color-ink:${tone().ink}`);
    expect(html).toContain(">@everyone</span>");
  });

  it("is never painted on another person's line, which stays the skin's neutral bubble", () => {
    fixture.colorMine = true;
    const html = markup([fromMaria]);
    expect(html).toContain("bg-bubble-user");
    expect(html).not.toContain("user-bubble-colored");
    expect(html).not.toContain(tone().background);
  });

  it("paints only the owner's lines in a room with both", () => {
    fixture.colorMine = true;
    const html = markup([owned, fromMaria]);
    expect(html.match(/user-bubble-colored/g)).toHaveLength(1);
    expect(html.match(/background-color:/g)).toHaveLength(1);
  });

  it("keeps the skin's neutral bubble when the setting is off, as the one-to-one chat does", () => {
    const html = markup([owned, fromMaria]);
    expect(html).toContain("bg-bubble-user");
    expect(html).not.toContain("user-bubble-colored");
    expect(html).not.toContain("background-color:");
  });
});
