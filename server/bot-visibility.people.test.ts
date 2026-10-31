import { describe, expect, it } from "vitest";

import { frameForMember, memberBody, memberBot, VisibleSet, withoutCost, type FrameContext, type StreamSeen, type Viewer } from "./bot-visibility.ts";

const ADA = "ada@x.test";
const BOB = "bob@x.test";
const GUS = "gus@x.test";

const bots = [
  { id: "open", threadId: "t-open" },
  { id: "hr", threadId: "t-hr", visibility: { people: [ADA] } },
  { id: "ops", threadId: "t-ops", visibility: "admins" as const, owner: BOB },
  { id: "guest-bot", threadId: "t-gb", visibility: { people: [GUS, ADA] } },
];
const groups = [
  { id: "g-open", threadId: "t-g-open", memberIds: ["open"] },
  { id: "g-ada-bob", threadId: "t-g-ab", memberIds: ["open"], people: [ADA, BOB] },
  { id: "g-guest", threadId: "t-g-guest", memberIds: ["open", "guest-bot"], people: [GUS, ADA] },
  { id: "g-guest-hr", threadId: "t-g-gh", memberIds: ["open", "hr"], people: [GUS, ADA] },
  { id: "g-ab-hr", threadId: "t-g-abhr", memberIds: ["open", "hr"], people: [ADA, BOB] },
];

const set = (viewer: Viewer) => new VisibleSet(bots, groups, viewer);
const admin = set({ kind: "all" });
const ada = set({ kind: "member", email: ADA });
const bob = set({ kind: "member", email: BOB });
const gus = set({ kind: "member", email: GUS, guest: true });

describe("a person who is named as the one behind an agent", () => {
  const owned = [{ id: "mine", threadId: "t-mine", owner: GUS, visibility: "admins" as const }];

  it("does not see an agent kept for admins by answering for it, as a member or as a guest", () => {
    const member = new VisibleSet(owned, [], { kind: "member", email: GUS });
    const guest = new VisibleSet(owned, [], { kind: "member", email: GUS, guest: true });
    for (const viewer of [member, guest]) {
      expect(viewer.bot("mine")).toBe(false);
      expect(viewer.thread("t-mine")).toBe(false);
      expect(viewer.botListed("mine")).toBe(false);
    }
  });

  it("does not see an agent limited to other people either", () => {
    const limited = [{ id: "hr", threadId: "t-hr", owner: BOB, visibility: { people: [ADA] } }];
    expect(new VisibleSet(limited, [], { kind: "member", email: BOB }).bot("hr")).toBe(false);
    expect(new VisibleSet(limited, [], { kind: "member", email: ADA }).bot("hr")).toBe(true);
  });

  it("still sees an agent everyone sees", () => {
    const open = [{ id: "open", threadId: "t-open", owner: BOB }];
    expect(new VisibleSet(open, [], { kind: "member", email: BOB }).bot("open")).toBe(true);
  });
});

describe("rooms limited to named people", () => {
  it("shows an admin every room", () => {
    expect(admin.everything).toBe(true);
    expect(groups.every((group) => admin.group(group.id))).toBe(true);
  });

  it("shows a member the open rooms and the ones that list them", () => {
    expect(ada.group("g-open")).toBe(true);
    expect(ada.group("g-ada-bob")).toBe(true);
    expect(ada.group("g-guest")).toBe(true);
    expect(bob.group("g-open")).toBe(true);
    expect(bob.group("g-ada-bob")).toBe(true);
    expect(bob.group("g-guest")).toBe(false);
    expect(bob.group("g-guest-hr")).toBe(false);
  });

  it("keeps a limited room's conversations from a member it does not list", () => {
    expect(bob.thread("t-g-guest")).toBe(false);
    expect(bob.thread("t-g-ab")).toBe(true);
    expect(ada.thread("t-g-ab")).toBe(true);
  });

  it("still needs every agent in the room to be visible to the person it lists", () => {
    expect(ada.group("g-ab-hr")).toBe(true);
    expect(bob.group("g-ab-hr")).toBe(false);
    expect(bob.thread("t-g-abhr")).toBe(false);
  });

  it("does not lose a member to a person with no email", () => {
    const nobody = set({ kind: "member" });
    expect(nobody.group("g-ada-bob")).toBe(false);
    expect(nobody.group("g-open")).toBe(true);
  });
});

describe("the person an agent answers to", () => {
  it("does not see it when it is kept for admins: answering for an agent never opens it", () => {
    expect(bob.bot("ops")).toBe(false);
    expect(bob.thread("t-ops")).toBe(false);
    expect(ada.bot("ops")).toBe(false);
    expect(ada.thread("t-ops")).toBe(false);
  });

  it("is not made an admin by it", () => {
    expect(bob.everything).toBe(false);
    expect(bob.member).toBe(true);
  });
});

describe("a guest", () => {
  it("sees only the rooms that list them", () => {
    expect(gus.everything).toBe(false);
    expect(gus.group("g-guest")).toBe(true);
    expect(gus.group("g-open")).toBe(false);
    expect(gus.group("g-ada-bob")).toBe(false);
    expect(gus.thread("t-g-guest")).toBe(true);
    expect(gus.thread("t-g-open")).toBe(false);
  });

  it("is not shown a room that has an agent kept from them", () => {
    expect(gus.group("g-guest-hr")).toBe(false);
  });

  it("opens an agent's own conversations only when its list names them", () => {
    expect(gus.bot("open")).toBe(false);
    expect(gus.thread("t-open")).toBe(false);
    expect(gus.bot("guest-bot")).toBe(true);
    expect(gus.thread("t-gb")).toBe(true);
    expect(gus.bot("hr")).toBe(false);
    expect(gus.bot("ops")).toBe(false);
  });

  it("knows the agents of their rooms by name and face, without opening them", () => {
    expect(gus.botListed("open")).toBe(true);
    expect(gus.botListed("guest-bot")).toBe(true);
    expect(gus.botListed("hr")).toBe(false);
    expect(gus.botListed("ops")).toBe(false);
  });

  it("is sent an agent of their room as a name and a face only", () => {
    const full = { id: "open", threadId: "t-open", name: "Otter", title: "Helps", description: "private notes", soul: "secret instructions",
      color: "blue", avatarUrl: null, modelSelection: { instanceId: "grok", model: "m" }, createdAt: 1, notifications: true, unread: true,
      tasks: [{ threadId: "t-open" }], owner: BOB, visibility: "everyone", messages: [{ id: "m1" }] };
    const copy = memberBot(full, gus) as Record<string, unknown>;
    expect(copy).toMatchObject({ id: "open", name: "Otter", hidden: true, tasks: [], unread: false, notifications: false, description: "" });
    expect(JSON.stringify(copy)).not.toMatch(/secret instructions|private notes|messages|bob@x\.test/);
  });

  it("does not learn who an agent they may open answers to", () => {
    const named = { id: "guest-bot", threadId: "t-gb", name: "Gus's", owner: BOB, visibility: { people: [GUS] }, tasks: [] };
    const copy = memberBot(named, gus) as Record<string, unknown>;
    expect(copy.owner).toBeUndefined();
    expect(copy.visibility).toBeUndefined();
    expect(copy.name).toBe("Gus's");
    expect(memberBot(named, bob) as Record<string, unknown>).toMatchObject({ owner: BOB });
  });

  it("gets live frames for their rooms and for the faces in them, and nothing else", () => {
    const context = (visible: VisibleSet): FrameContext => ({ visible, webhook: () => undefined, freshBot: () => undefined, freshGroup: () => undefined });
    const seen = (): StreamSeen => ({ bots: new Set(), groups: new Set() });
    const send = (payload: Record<string, unknown>, stream = seen()) => frameForMember(payload, context(gus), stream);
    expect(send({ kind: "message", threadId: "t-g-guest" })).toBeDefined();
    expect(send({ kind: "message", threadId: "t-g-open" })).toBeUndefined();
    expect(send({ kind: "message", threadId: "t-open" })).toBeUndefined();
    const face = send({ kind: "bot", bot: { id: "open", threadId: "t-open", name: "Otter", soul: "secret" } }) as { bot: Record<string, unknown> };
    expect(face.bot).toMatchObject({ id: "open", hidden: true });
    expect(JSON.stringify(face)).not.toContain("secret");
    expect(send({ kind: "bot", bot: { id: "hr", threadId: "t-hr", name: "Payroll" } })).toBeUndefined();
    expect(send({ kind: "computer", botId: "open" })).toBeUndefined();
    expect(send({ kind: "computer", botId: "guest-bot" })).toBeDefined();
    expect(send({ kind: "group", group: { id: "g-open", threadId: "t-g-open" } })).toBeUndefined();
    expect(send({ kind: "group", group: { id: "g-guest", threadId: "t-g-guest" } })).toBeDefined();
  });

  it("is offered only the sidebar teams that hold something they can see", () => {
    const withSections = new VisibleSet(
      [{ id: "a", threadId: "ta", section: "Ops" }, { id: "b", threadId: "tb", section: "Pay", visibility: { people: [GUS] } }],
      [{ id: "g", threadId: "tg", memberIds: ["a"], section: "Ops", people: [GUS] }],
      { kind: "member", email: GUS, guest: true },
    );
    expect(withSections.sections(["Ops", "Pay", "Other"])).toEqual(["Ops", "Pay"]);
  });
});

describe("notices on a member's live stream", () => {
  const context = (visible: VisibleSet): FrameContext => ({ visible, webhook: () => undefined, freshBot: () => undefined, freshGroup: () => undefined });
  const fresh = (): StreamSeen => ({ bots: new Set(), groups: new Set() });
  const notice = (threadId: string, extra: Record<string, unknown> = {}) => ({ kind: "notify", notification: { kind: "mention", botId: "", threadId, ...extra } });

  it("passes the notice of a direct message to the person it is addressed to, though no room or agent holds the conversation", () => {
    const direct = notice("dm:abc", { toPersons: [ADA] });
    expect(frameForMember(direct, context(ada), fresh())).toBe(direct);
    expect(frameForMember(direct, context(gus), fresh())).toBe(direct);
  });

  it("holds back a notice that only looks like a direct message", () => {
    expect(frameForMember(notice("dm:abc"), context(ada), fresh())).toBeUndefined();
  });

  it("passes a mention in a room only to a person who sees that room", () => {
    const inRoom = notice("t-g-ab", { toPersons: [ADA] });
    expect(frameForMember(inRoom, context(ada), fresh())).toBe(inRoom);
    expect(frameForMember(inRoom, context(bob), fresh())).toBe(inRoom);
    const elsewhere = notice("t-g-guest", { toPersons: [BOB] });
    expect(frameForMember(elsewhere, context(bob), fresh())).toBeUndefined();
    expect(frameForMember(elsewhere, context(ada), fresh())).toBe(elsewhere);
  });
});

describe("what a guest is never shown: money", () => {
  const usage = { input: 10, output: 5, costUsd: 0.42, turns: 2, lastTurn: { input: 4, output: 2, costUsd: 0.17 } };
  const body = {
    groups: [{ id: "g-guest", threadId: "t-g-guest", memberIds: ["open"], usage: { ...usage, lastSpeaker: { botId: "open", name: "Otter" } } }],
    bots: [{ id: "guest-bot", threadId: "t-gb", name: "Gus's", tasks: [{ threadId: "t-gb", usage }] }],
    messages: [{ id: "m1", role: "bot", text: "Pronto.", usage: { input: 1, output: 2, costUsd: 0.03 } }],
    cacheKeepWarm: { state: "warm", last: { at: 1, read: 2, write: 3, costUsd: 0.01 } },
  };

  it("strips what a turn cost from everything a guest is sent", () => {
    const sent = JSON.stringify(memberBody(structuredClone(body), gus));
    expect(sent).not.toContain("costUsd");
    expect(sent).not.toMatch(/0\.42|0\.17|0\.03|0\.01/);
    expect(JSON.parse(sent).groups[0].usage).toMatchObject({ input: 10, output: 5, turns: 2, lastTurn: { input: 4, output: 2 } });
    expect(JSON.parse(sent).messages[0].usage).toEqual({ input: 1, output: 2 });
    expect(JSON.parse(sent).bots[0].tasks[0].usage).toMatchObject({ input: 10, turns: 2 });
  });

  it("leaves a member the cost, as it has always been", () => {
    const sent = JSON.stringify(memberBody(structuredClone(body), ada));
    expect(sent).toContain("0.42");
    expect(sent).toContain("0.03");
    expect(sent).toContain("0.01");
  });

  it("strips it from live frames for a guest and reuses the shared frame for a member", () => {
    const context = (visible: VisibleSet): FrameContext => ({ visible, webhook: () => undefined, freshBot: () => undefined, freshGroup: () => undefined });
    const seen = (): StreamSeen => ({ bots: new Set(), groups: new Set() });
    const message = { kind: "message", threadId: "t-g-guest", message: { id: "m1", usage: { input: 1, output: 2, costUsd: 0.03 } } };
    const patch = { kind: "message.patch", threadId: "t-g-guest", patch: { usage: { costUsd: 0.04 } } };
    const forGuest = frameForMember(message, context(gus), seen());
    expect(JSON.stringify(forGuest)).not.toContain("costUsd");
    expect(JSON.stringify(frameForMember(patch, context(gus), seen()))).not.toContain("costUsd");
    expect(frameForMember(message, context(ada), seen())).toBe(message);
    const plain = { kind: "message", threadId: "t-g-guest", message: { id: "m2", text: "oi" } };
    expect(frameForMember(plain, context(gus), seen())).toBe(plain);
  });

  it("changes nothing that holds no cost, and nothing it was handed", () => {
    const plain = { groups: [{ id: "g" }], list: [1, 2, { a: [] }] };
    expect(withoutCost(plain)).toBe(plain);
    const original = structuredClone(body);
    withoutCost(original);
    expect(original).toEqual(body);
  });
});
