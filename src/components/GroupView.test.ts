import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Group, type Message } from "@/state/store";

// Replaced whole: its context default reads window.ogb at import time.
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { homeDir: "/home/me" } } }),
  useCaptionChrome: () => ({}),
}));

import { GroupView, RoomToolChip } from "./GroupView";
import { RoomInfoPanel } from "./RoomInfoPanel";

const chip = (patch: Partial<Message> = {}): Message => ({
  id: "chip",
  role: "bot",
  kind: "activity",
  at: 1,
  tool: { name: "Posted in Standup", ok: true },
  ...patch,
});

const render = (message: Message) =>
  renderToStaticMarkup(createElement(StoreProvider, null, createElement(RoomToolChip, { message })));

describe("RoomToolChip", () => {
  it("turns a linked receipt into a button that opens the room it names", () => {
    const markup = render(chip({
      comm: { groupId: "room-standup", withBotId: "scout", withName: "Standup", withColor: "green" },
    }));
    expect(markup).toContain("<button");
    expect(markup).toContain("Wrote in Standup");
    expect(markup).toContain('title="Open Standup"');
  });

  it("turns an opened-thread receipt into a button that opens that thread", () => {
    const markup = render(chip({
      tool: { name: "Opened thread #QA PR 245 on Scout", ok: true },
      threadRef: { botId: "scout", threadId: "qa-245", title: "QA PR 245" },
    }));
    expect(markup).toContain("<button");
    expect(markup).toContain("Opened thread #QA PR 245 on Scout");
    expect(markup).toContain('title="Open #QA PR 245"');
  });

  it("leaves an ordinary step as a plain pill", () => {
    const markup = render(chip());
    expect(markup).not.toContain("<button");
    expect(markup).toContain("Wrote in Standup");
  });

  it("shows a same-room teammate avatar without adding a navigation button", () => {
    const message = chip({
      tool: { name: "Sent to Eli", ok: true },
      comm: { groupId: "here", withBotId: "eli", withName: "Eli", withColor: "green" },
    });
    const markup = renderToStaticMarkup(createElement(StoreProvider, null,
      createElement(RoomToolChip, { message, roomId: "here" })));
    expect(markup).toContain("Message to Eli");
    expect(markup).toContain('title="Sent to Eli"');
    expect(markup).toContain('aria-label="Eli"');
    expect(markup).not.toContain("<button");
  });

  it("names the other room's bot once for every line of the conversation, the last line only in the tooltip", () => {
    const markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(RoomToolChip, {
      message: chip({
        tool: { name: "Eli needs your input: which font?", ok: true },
        comm: { groupId: "elsewhere", withBotId: "eli", withName: "Eli", withColor: "green" },
      }),
      roomId: "here",
      count: 4,
    })));
    expect(markup).toContain("4 messages with Eli");
    expect(markup).toContain('title="Eli needs your input: which font?"');
    expect(markup).not.toMatch(/>[^<]*needs your input/);
  });
});

describe("room header", () => {
  const room: Group = {
    id: "room", threadId: "room-thread", name: "Launch planning", memberIds: [],
    defaultResponder: { kind: "member", botId: "atlas" }, bulletin: "", unread: false,
    createdAt: 1, setupCompletedAt: 1, messages: [],
  };

  it("puts the room's name and people in one centered pill, with the controls behind a quiet menu", () => {
    vi.stubGlobal("window", { ogb: undefined });
    let markup: string;
    try {
      markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupView, { group: room })));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(markup).toContain("@container/roomhead");
    const identity = /data-roomhead-identity="[^"]*" class="([^"]*)"/.exec(markup)!;
    expect(identity[1].split(" ")).toEqual(expect.arrayContaining(["left-1/2", "-translate-x-1/2"]));
    expect(markup).toContain("data-room-pill");
    expect(markup).toContain("data-room-more");
    expect(markup).not.toMatch(/\$\d/);
    expect(markup).toContain("Launch planning");
    expect(markup).not.toContain("data-room-info=");
  });

  it("keeps every room setting in one side panel, without the pace control", () => {
    vi.stubGlobal("window", { ogb: undefined, setTimeout, clearTimeout });
    let markup: string;
    try {
      markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(RoomInfoPanel, {
        group: { ...room, bulletin: "Ship on Friday", description: "Docs: https://example.com/brief", favoriteMessageIds: ["a", "b"] },
        members: [], onClose: vi.fn(), onFind: vi.fn(), onGoal: vi.fn(),
      })));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(markup).toContain("data-room-info=");
    const sections = [...markup.matchAll(/data-room-info-section="([^"]+)"/g)].map((match) => match[1]);
    expect(sections).toEqual(["description", "library", "members", "people", "responder", "instructions", "folder", "conversations", "export"]);
    expect(markup).toContain("Ship on Friday");
    expect(markup).toContain('href="https://example.com/brief"');
    expect([...markup.matchAll(/data-room-action="([^"]+)"/g)].map((match) => match[1])).toEqual(["add", "find", "goal"]);
    expect(markup).toMatch(/data-room-nav="favorites"[\s\S]*?>2</);
    expect(markup).not.toContain("shell");
    expect(markup).not.toMatch(/turn limit|\bpace\b/i);
  });
});
