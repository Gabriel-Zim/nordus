import { describe, expect, it, vi } from "vitest";
import type { Notification } from "../../shared/notification.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { UsageRow } from "../usage-ledger.ts";
import { seenFrom } from "../testing/board-fixture.ts";
import { bucketOf, createBoardWiring, type BoardPrimitives } from "./host.ts";

const loopback: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const session = (email: string | undefined, scopes: Array<"admin" | "client"> = ["client"], id = "s"): RequestAuth => ({
  kind: "session",
  via: "bearer",
  scopes,
  session: { id, tokenHash: "0".repeat(64), label: "t", scopes, createdAt: 0, lastSeenAt: 0, expiresAt: 1, ...(email ? { email } : {}) },
});

const BOTS = [
  { id: "dev", name: "Dev", threadId: "th-dev" },
  { id: "acme-bot", name: "Acme Bot", threadId: "th-acme", client: " ACME ", section: "Acme" },
  { id: "front-desk", name: "Front", threadId: "th-front" },
  { id: "old", name: "Old", threadId: "th-old", hidden: true },
  { id: "secret", name: "Secret", threadId: "th-secret", visibility: "admins" },
  { id: "chief", name: "Chief", threadId: "th-chief", chiefOfStaff: true, section: "Vendas" },
  { id: "seller", name: "Seller", threadId: "th-seller", section: "Vendas" },
  { id: "partner", name: "Partner", threadId: "th-partner", section: "Parceria", openTo: ["Vendas"] },
];
const GROUPS = [{ id: "g1", name: "Sala", threadId: "th-g1", memberIds: ["dev"] }];

function wiring(overrides: Partial<BoardPrimitives> = {}) {
  const notices: Notification[] = [];
  const broadcast = vi.fn();
  const createChannel = vi.fn((_value: unknown) => ({ id: "g9", threadId: "th-g9" }));
  const spendCheck = vi.fn((_botId?: string) => undefined);
  const usage: UsageRow[] = [];
  const primitives: BoardPrimitives = {
    dataDir: "/tmp/nordus-host-test",
    desktopManaged: false,
    store: {
      bots: BOTS,
      bot: (id) => BOTS.find((bot) => bot.id === id),
      group: (id) => GROUPS.find((group) => group.id === id),
      groupByThread: (threadId) => GROUPS.find((group) => group.threadId === threadId),
      botByThread: (threadId) => BOTS.find((bot) => bot.threadId === threadId),
    },
    isInternal: (bot) => bot.id !== "front-desk" && bot.id !== "acme-bot",
    owner: () => ({ name: "Avery", email: "Avery@Zorg.com" }),
    allowList: () => ({ admins: ["Rafael@zorg.com"], members: ["nina@zorg.com", "NINA@zorg.com", "nao-e-email", "avery@zorg.com"] }),
    sessionEmails: () => ["carla@cliente.com", " "],
    actorKey: (auth) => (auth.kind === "session" ? `p_${auth.session.id}` : undefined),
    viewerFor: (auth) => (auth.kind === "loopback" || auth.scopes.includes("admin") ? { kind: "all" } : { kind: "member", ...(auth.session.email ? { email: auth.session.email } : {}) }),
    visibleTo: (viewer) => (viewer.kind === "all" ? seenFrom({ everything: true }) : seenFrom({ bots: ["dev"] })),
    messageSender: (auth) => (auth.kind === "session" && auth.session.email ? { name: auth.session.email.split("@")[0]!, email: auth.session.email, notOwner: true } : { name: "Avery" }),
    usageTriggerFor: (auth) => (auth.kind === "session" ? { kind: "user", email: auth.session.email } : { kind: "owner" }),
    broadcast,
    logNotification: (notification) => {
      notices.push(notification);
      return { ...notification, id: "n1", at: 1, read: false };
    },
    createChannel,
    readUsage: () => usage,
    spendCheck,
    sender: {
      botThread: () => undefined,
      roomThreadOwned: () => true,
      acceptDirectSend: async () => ({ threadId: "t" }),
      roomWorking: () => false,
      roomQueued: () => false,
      shouldQueue: () => false,
      queueRoom: () => undefined,
      startRoom: () => undefined,
      applyRoomHolds: () => undefined,
    },
    ...overrides,
  };
  return { ...createBoardWiring(primitives), notices, broadcast, createChannel, spendCheck, usage };
}

describe("which side of the wall an agent is on", () => {
  it("puts an agent with a client name in that client's bucket, however it is typed", () => {
    expect(bucketOf({ id: "a", name: "A", threadId: "t", client: " ACME " }, false)).toBe("client:acme");
    expect(bucketOf({ id: "a", name: "A", threadId: "t", client: "Acme" }, false)).toBe("client:acme");
  });

  it("keeps an agent that works for the house in the house even when it carries a client name, so no mission mixes it into that client's agents", () => {
    expect(bucketOf({ id: "a", name: "A", threadId: "t", client: " ACME " }, true)).toBe("internal");
  });

  it("keeps the house apart from agents that are open to outsiders, and each open agent apart from the others", () => {
    expect(bucketOf({ id: "a", name: "A", threadId: "t" }, true)).toBe("internal");
    expect(bucketOf({ id: "a", name: "A", threadId: "t" }, false)).toBe("open:a");
    expect(bucketOf({ id: "b", name: "B", threadId: "t" }, false)).toBe("open:b");
    expect(bucketOf({ id: "a", name: "A", threadId: "t", client: "   " }, true)).toBe("internal");
  });

  it("reads the directory straight from the store, buckets included", () => {
    const { dir } = wiring();
    expect(dir.bots().map((bot) => [bot.id, bot.bucket, bot.hidden])).toEqual([
      ["dev", "internal", undefined], ["acme-bot", "client:acme", undefined], ["front-desk", "open:front-desk", undefined], ["old", "internal", true],
      ["secret", "internal", undefined], ["chief", "internal", undefined], ["seller", "internal", undefined], ["partner", "internal", undefined],
    ]);
    expect(dir.bot("acme-bot")?.bucket).toBe("client:acme");
    expect(dir.bot("nobody")).toBeUndefined();
    expect(dir.room("g1")).toEqual({ id: "g1", name: "Sala", threadId: "th-g1", memberIds: ["dev"] });
    expect(dir.roomOfThread("th-g1")?.id).toBe("g1");
    expect(dir.roomOfThread("th-dev")).toBeUndefined();
    expect(dir.botOfThread("th-acme")?.id).toBe("acme-bot");
  });
});

describe("who is asking", () => {
  it("treats the machine's owner as an administrator who sees everything", () => {
    const { callerFor } = wiring();
    const caller = callerFor(loopback);
    expect(caller).toMatchObject({ kind: "person", admin: true, actor: { kind: "person", id: "avery@zorg.com", name: "Avery" } });
    expect(caller.seen.everything).toBe(true);
    expect(caller.identity).toEqual({ sender: { name: "Avery" }, trigger: { kind: "owner" }, personPresent: false });
  });

  it("names the owner \"owner\" only while no email is known, and never lets a member without an email take that name", () => {
    const noEmail = wiring({ owner: () => ({ name: "Avery" }) });
    expect(noEmail.callerFor(loopback).actor).toMatchObject({ id: "owner" });
    expect(noEmail.callerFor(session(undefined, ["admin", "client"])).actor).toMatchObject({ id: "owner" });
    const anonymous = noEmail.callerFor(session(undefined));
    expect(anonymous).toMatchObject({ admin: false, actor: { id: "p_s" } });
    expect(anonymous.email).toBeUndefined();
    expect(wiring().callerFor(session("nina@zorg.com")).actor.id).toBe("nina@zorg.com");
  });

  it("tells two members who have no email apart, so one cannot act as the other", () => {
    const { callerFor } = wiring({ owner: () => ({ name: "Avery" }) });
    const first = callerFor(session(undefined, ["client"], "s1"));
    const second = callerFor(session(undefined, ["client"], "s2"));
    expect(first.actor.id).not.toBe(second.actor.id);
    expect(first.actor.id).toBe(callerFor(session(undefined, ["client"], "s1")).actor.id);
    expect(first.actor.id).not.toBe("anonymous");
  });

  it("filters a live stream by the lowercased email, else by the session's own key, never by a name shared with others", () => {
    const { viewerIdFor } = wiring({ owner: () => ({ name: "Avery" }) });
    expect(viewerIdFor(session(" Nina@Zorg.com "))).toBe("nina@zorg.com");
    expect(viewerIdFor(session(undefined, ["client"], "s1"))).toBe("p_s1");
    expect(viewerIdFor(session(undefined, ["client"], "s2"))).not.toBe(viewerIdFor(session(undefined, ["client"], "s1")));
    expect(viewerIdFor(loopback)).toBeUndefined();
  });

  it("counts a desktop owner as present, and a signed-in person by their lowercased email", () => {
    const desktop = wiring({ desktopManaged: true }).callerFor(loopback);
    expect(desktop.identity.personPresent).toBe(true);
    const { callerFor } = wiring();
    const caller = callerFor(session(" Nina@Zorg.com "));
    expect(caller).toMatchObject({ kind: "person", admin: false, email: "nina@zorg.com", actor: { kind: "person", id: "nina@zorg.com" } });
    expect(caller.seen.everything).toBe(false);
    expect(caller.seen.bot("dev")).toBe(true);
    expect(caller.seen.bot("acme-bot")).toBe(false);
    expect(caller.identity).toMatchObject({ trigger: { kind: "user", email: " Nina@Zorg.com " }, personPresent: true });
  });

  it("treats a session with the admin scope as an administrator", () => {
    expect(wiring().callerFor(session("rafael@zorg.com", ["admin", "client"])).admin).toBe(true);
  });

  it("knows an agent's caller by its bucket and by whom it can act on: its own team, archived and other audiences excluded", () => {
    const { botCallerFor } = wiring();
    const caller = botCallerFor(BOTS[0]!, "th-dev");
    expect(caller).toMatchObject({ kind: "bot", actor: { kind: "bot", id: "dev", name: "Dev" }, bot: { id: "dev", bucket: "internal" }, threadId: "th-dev" });
    expect(caller.reaches("front-desk")).toBe(true);
    expect(caller.reaches("acme-bot")).toBe(false);
    expect(caller.reaches("old")).toBe(false);
    expect(caller.reaches("secret")).toBe(false);
    expect(caller.reaches("dev")).toBe(false);
    expect(caller.reaches("nobody")).toBe(false);
    expect(botCallerFor(BOTS[1]!, "th-acme").bot.bucket).toBe("client:acme");
  });

  it("answers for a Chief of Staff, its section, its real teammates and the rooms it may still open this turn", () => {
    const { botCallerFor } = wiring();
    let rooms = 0;
    const chief = botCallerFor(BOTS[5]!, "th-chief", { active: true, peerReview: false, claimRoom: () => rooms++ < 2 });
    expect(chief).toMatchObject({ chief: true, peerReview: false, section: "Vendas" });
    expect(chief.teammate("seller")).toBe(true);
    expect(chief.teammate("dev")).toBe(false);
    expect(chief.teammate("partner")).toBe(false);
    expect(chief.reaches("partner")).toBe(true);
    expect([chief.claimRoom(), chief.claimRoom(), chief.claimRoom()]).toEqual([true, true, false]);
    expect(botCallerFor(BOTS[6]!, "th-seller", { active: true, peerReview: false, claimRoom: () => true }).chief).toBe(false);
    expect(botCallerFor(BOTS[5]!, "th-chief", { active: false, peerReview: false, claimRoom: () => true }).chief).toBe(false);
    expect(botCallerFor(BOTS[5]!, "th-chief", { active: true, peerReview: true, claimRoom: () => true }).peerReview).toBe(true);
  });
});

describe("the host the board runs on", () => {
  it("lists the people of the space once each, owner first, and skips what is not an email", () => {
    expect(wiring().host.people()).toEqual([
      { id: "avery@zorg.com", name: "Avery" },
      { id: "rafael@zorg.com" },
      { id: "nina@zorg.com" },
      { id: "carla@cliente.com" },
    ]);
  });

  it("speaks as the owner for the owner, and as a teammate for anyone else", () => {
    const { host } = wiring();
    expect(host.identityFor({ kind: "person", id: "owner" })).toEqual({ sender: { name: "Avery", email: "Avery@Zorg.com" }, trigger: { kind: "owner" }, personPresent: true });
    expect(host.identityFor({ kind: "person", id: "avery@zorg.com", name: "G" })).toMatchObject({ trigger: { kind: "owner" }, personPresent: true });
    expect(host.identityFor({ kind: "person", id: "nina@zorg.com", name: "Nina" })).toEqual({
      sender: { name: "Nina", email: "nina@zorg.com", notOwner: true }, trigger: { kind: "user", email: "nina@zorg.com" }, personPresent: true,
    });
    expect(host.identityFor({ kind: "person", id: "joao@zorg.com" }).sender).toMatchObject({ name: "joao" });
    expect(host.identityFor({ kind: "person", id: "anonymous", name: "Visitante" })).toEqual({
      sender: { name: "Visitante", notOwner: true }, trigger: { kind: "user", label: "Visitante" }, personPresent: true,
    });
    expect(host.identityFor({ kind: "bot", id: "dev" })).toEqual({ trigger: { kind: "bot", botId: "dev" }, personPresent: false });
    expect(host.identityFor({ kind: "system" })).toEqual({ trigger: { kind: "owner" }, personPresent: false });
  });

  it("opens a mission room with the lead answering and the bulletin set", () => {
    const { host, createChannel } = wiring();
    expect(host.createRoom({ name: "Missão: Virar", memberIds: ["dev", "acme-bot"], leadBotId: "dev", bulletin: "Quadro da missão" })).toEqual({ groupId: "g9", threadId: "th-g9" });
    expect(createChannel).toHaveBeenCalledWith({
      name: "Missão: Virar", memberIds: ["dev", "acme-bot"], setup: { bulletin: "Quadro da missão", defaultResponder: { kind: "member", botId: "dev" } },
    });
  });

  it("puts the room in the Chief's section and keeps secrets out of its name and bulletin", () => {
    const { host, createChannel } = wiring();
    const key = `sk-${"a1B2c3D4".repeat(5)}`;
    host.createRoom({ name: `Missão ${key}`, memberIds: ["chief", "seller"], leadBotId: "chief", bulletin: `Objetivo com a chave ${key}`, section: "Vendas" });
    const sent = createChannel.mock.calls[0]![0] as { name: string; section: string; setup: { bulletin: string } };
    expect(sent.section).toBe("Vendas");
    expect(sent.name).not.toContain(key);
    expect(sent.setup.bulletin).not.toContain(key);
  });

  it("tells a notification to the log first, then to everyone listening", () => {
    const { host, notices, broadcast } = wiring();
    const notification: Notification = { kind: "done", botId: "dev", botName: "Dev", threadId: "th-g9", title: "Missão concluída", body: "ok" };
    host.notify(notification);
    expect(notices).toEqual([notification]);
    expect(broadcast).toHaveBeenCalledWith({ kind: "notify", notification: { ...notification, id: "n1", at: 1, read: false } });
  });

  it("reports a spending limit by what it was, naming the agent only when it is the agent's own", () => {
    const capped = Object.assign(new Error("cap"), { code: "spend_cap" });
    const botCapped = Object.assign(new Error("cap"), { code: "bot_spend_cap" });
    const { host, spendCheck } = wiring();
    expect(host.spendBlock("dev")).toBeNull();
    spendCheck.mockImplementationOnce(() => { throw capped; });
    expect(host.spendBlock("dev")).toEqual({ code: "spend_cap", botName: "Dev" });
    spendCheck.mockImplementationOnce(() => { throw botCapped; });
    expect(host.spendBlock("dev")).toEqual({ code: "bot_spend_cap", botName: "Dev" });
    spendCheck.mockImplementationOnce(() => { throw new Error("odd"); });
    expect(host.spendBlock("nobody")).toEqual({ code: "spend_cap" });
  });

  it("reads usage for a time range and keeps only the numbers a receipt needs", () => {
    const { host, usage } = wiring();
    usage.push({
      at: "2026-10-27T10:00:00.000Z", botId: "dev", botName: "Dev", threadId: "th-g9", instanceId: "i", driverKind: "claude", model: "m",
      input: 10, output: 5, costUsd: 0.01, trigger: { kind: "owner" },
    });
    expect(host.usage(Date.parse("2026-10-27T00:00:00Z"), Date.parse("2026-10-28T00:00:00Z"))).toEqual([
      { botId: "dev", botName: "Dev", threadId: "th-g9", input: 10, output: 5, costUsd: 0.01 },
    ]);
  });

  it("filters live frames by what a member can see, and lets the owner see everything", () => {
    const { host } = wiring();
    expect(host.seenBy("nina@zorg.com").bot("dev")).toBe(true);
    expect(host.seenBy("nina@zorg.com").bot("acme-bot")).toBe(false);
    expect(host.seenBy(undefined).everything).toBe(false);
  });
});
