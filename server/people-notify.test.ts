import { describe, expect, it } from "vitest";

import type { Notification } from "../shared/notification.ts";
import { buildPersonMentionNotifications } from "./notify.ts";
import { desktopRecipient, directMessageNotification, frameReaches, ownerBudgetNotification, personMentionNotifications, pushReaches, reaches, routeToOwner, sessionRecipient } from "./people-notify.ts";

const base: Notification = { kind: "approval", botId: "b1", botName: "Otter", threadId: "t1", title: "t", body: "b" };
const ADA = { name: "Ada Lima", email: "ada@x.test" };
const BOB = { name: "Bob", email: "bob@x.test" };

describe("who a notification reaches", () => {
  it("reaches everyone who sees the conversation when it names nobody", () => {
    expect(reaches(base, { admin: false })).toBe(true);
    expect(reaches(base, { email: "x@x.test", admin: false })).toBe(true);
  });

  it("reaches the people it names", () => {
    const named = { ...base, toPersons: [ADA.email] };
    expect(reaches(named, { email: ADA.email, admin: false })).toBe(true);
    expect(reaches(named, { email: BOB.email, admin: false })).toBe(false);
    expect(reaches(named, { admin: false })).toBe(false);
  });

  it("reaches the admins too when it is something an admin answers for", () => {
    for (const kind of ["approval", "question", "incident", "turn-failed", "routine-failed", "sign-in"] as const) {
      expect(reaches({ kind, toPersons: [ADA.email] }, { email: "boss@x.test", admin: true }), kind).toBe(true);
      expect(reaches({ kind, toPersons: [ADA.email] }, { admin: true }), kind).toBe(true);
    }
  });

  it("keeps a mention and a direct message to the person it names, admins included", () => {
    expect(reaches({ kind: "mention", toPersons: [ADA.email] }, { email: "boss@x.test", admin: true })).toBe(false);
    expect(reaches({ kind: "mention", toPersons: [ADA.email] }, { admin: true })).toBe(false);
    expect(reaches({ kind: "spend", toPersons: [ADA.email] }, { admin: true })).toBe(false);
  });

  it("keeps what the workspace spent and the day's summary to the admins, even when nothing names anyone", () => {
    for (const kind of ["spend", "daily-digest"] as const) {
      expect(reaches({ kind }, { admin: false }), kind).toBe(false);
      expect(reaches({ kind }, { email: ADA.email, admin: false }), kind).toBe(false);
      expect(reaches({ kind }, { admin: true }), kind).toBe(true);
      expect(reaches({ kind }, { email: "boss@x.test", admin: true }), kind).toBe(true);
    }
  });

  it("still reaches the owner that an agent's limit notice names, and nobody else", () => {
    const warn = ownerBudgetNotification({ id: "b1", name: "Otter" }, ADA.email, "t1", { percent: 85 }, "warn");
    expect(reaches(warn, { email: ADA.email, admin: false })).toBe(true);
    expect(reaches(warn, { email: BOB.email, admin: false })).toBe(false);
  });
});

describe("who a window or a device is as a recipient", () => {
  it("is the address a session carries and whether it answers as an admin, and nobody in particular without an address", () => {
    expect(sessionRecipient({ email: " ADA@x.test", scopes: ["client"] })).toEqual({ email: ADA.email, admin: false });
    expect(sessionRecipient({ email: "boss@x.test", scopes: ["admin", "client"] })).toEqual({ email: "boss@x.test", admin: true });
    expect(sessionRecipient({ scopes: ["admin", "client"] })).toEqual({ admin: true });
  });

  it("is the owner's profile address on a desktop that trusts its own loopback, and nobody on a shared server", () => {
    expect(desktopRecipient("Dona@x.test", "owner")).toEqual({ email: "dona@x.test", admin: true });
    expect(desktopRecipient(undefined, "owner")).toEqual({ admin: true });
    expect(desktopRecipient("Dona@x.test", "service")).toEqual({ admin: true });
  });

  it("is sent a live notice by the same rule as the feed, with or without anyone named", () => {
    const named = { notification: { ...base, toPersons: [ADA.email] } };
    expect(frameReaches(named, { admin: false, email: ADA.email })).toBe(true);
    expect(frameReaches(named, { admin: false, email: BOB.email })).toBe(false);
    expect(frameReaches({ notification: base }, { admin: false })).toBe(true);
    expect(frameReaches({ notification: { ...base, kind: "spend" } }, { admin: false, email: ADA.email })).toBe(false);
    expect(frameReaches({ notification: { ...base, kind: "spend" } }, { admin: true })).toBe(true);
    expect(frameReaches({ notification: { ...base, kind: "daily-digest" } }, { admin: false, email: ADA.email })).toBe(false);
    expect(frameReaches(null, { admin: false })).toBe(true);
  });
});

describe("an agent's owner", () => {
  it("hears about its approvals, alerts and questions, with whoever started the conversation", () => {
    expect(routeToOwner(base, "ADA@x.test ", [BOB.email]).toPersons).toEqual([ADA.email, BOB.email]);
    expect(routeToOwner({ ...base, kind: "incident" }, ADA.email).toPersons).toEqual([ADA.email]);
  });

  it("leaves the rest of an agent's news alone, and an agent nobody owns", () => {
    expect(routeToOwner({ ...base, kind: "done" }, ADA.email).toPersons).toBeUndefined();
    expect(routeToOwner(base, undefined)).toBe(base);
    const already = { ...base, toPersons: [BOB.email] };
    expect(routeToOwner(already, ADA.email)).toBe(already);
  });

  it("is told about its agent's limit in percent, never in money", () => {
    const warn = ownerBudgetNotification({ id: "b1", name: "Otter" }, "ADA@x.test", "t1", { percent: 85 }, "warn");
    expect(warn).toMatchObject({ kind: "spend", toPersons: [ADA.email], botId: "b1" });
    expect(warn.title).toContain("85%");
    expect(JSON.stringify(warn)).not.toMatch(/\$|USD|dólar/i);
    expect(ownerBudgetNotification({ id: "b1", name: "Otter" }, ADA.email, "t1", { percent: 100 }, "cap").title).toMatch(/limite/);
  });
});

describe("calling people", () => {
  const context = { threadId: "t-room", groupId: "g1", groupName: "Vendas", speaker: "Bob", speakerEmail: BOB.email, text: "", people: [ADA, BOB], botNames: ["Otter"] };

  it("notifies each person a message tags, to that person alone, never its writer", () => {
    const found = personMentionNotifications({ ...context, text: "@Ada Lima vê isso? @Bob também. @Otter, ajuda" });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "mention", toPersons: [ADA.email], groupId: "g1", threadId: "t-room", botName: "Bob", botId: "" });
    expect(found[0]!.title).toBe("Bob mencionou você em Vendas");
    expect(found[0]!.body).toContain("@Ada Lima");
  });

  it("notifies the person a direct message is for", () => {
    const direct = directMessageNotification({ threadId: "dm:1", groupId: "1", from: { name: "Bob", email: BOB.email }, to: ADA.email, text: "oi\n\nvocê viu?" });
    expect(direct).toMatchObject({ kind: "mention", toPersons: [ADA.email], threadId: "dm:1", title: "Bob", body: "oi você viu?" });
  });

  it("notifies the people a bot's settled reply tags, and a bot that has notifications off says nothing", () => {
    const source = {
      activePath: () => [{ role: "bot", kind: "text", text: "Pronto. @Ada Lima pode revisar? Falei com @Bob.", turnId: "turn", from: { botId: "b1" } }],
      bot: (id: string) => (id === "b1" ? { name: "Otter" } : undefined),
    };
    const room = { id: "g1", name: "Vendas", memberIds: ["b1"] };
    const found = buildPersonMentionNotifications(source, { id: "b1", name: "Otter" }, room, { threadId: "t-room", turnId: "turn", reply: "" }, [ADA, BOB]);
    expect(found.map((entry) => entry.toPersons)).toEqual([[ADA.email], [BOB.email]]);
    expect(found[0]).toMatchObject({ kind: "mention", botId: "b1", groupId: "g1" });
    expect(buildPersonMentionNotifications(source, { id: "b1", name: "Otter", notifications: false }, room, { threadId: "t-room", turnId: "turn", reply: "" }, [ADA])).toEqual([]);
    expect(buildPersonMentionNotifications(source, { id: "b1", name: "Otter" }, { ...room, dm: true }, { threadId: "t-room", reply: "@Bob" }, [BOB])).toEqual([]);
  });
});

describe("who a push reaches", () => {
  const sees = (threads: string[], bots: string[] = []) => ({ thread: (id: string) => threads.includes(id), bot: (id: string) => bots.includes(id) });
  const everyone = (who: { email?: string; guest?: boolean }) => (who.guest ? sees([]) : sees(["t1"], ["b1"]));

  it("goes to whoever sees the conversation and the agent when it names nobody, and not to the rest", () => {
    expect(pushReaches(base, { email: ADA.email, admin: false }, false, everyone)).toBe(true);
    expect(pushReaches(base, { email: ADA.email, admin: false }, false, () => sees(["t1"], []))).toBe(false);
    expect(pushReaches(base, { email: ADA.email, admin: false }, false, () => sees([], ["b1"]))).toBe(false);
    expect(pushReaches(base, { admin: true }, false, () => sees([]))).toBe(true);
  });

  it("is kept from members when it is for admins only", () => {
    expect(pushReaches(base, { email: ADA.email, admin: false }, true, everyone)).toBe(false);
    expect(pushReaches(base, { email: "boss@x.test", admin: true }, true, everyone)).toBe(true);
  });

  it("goes only to the people it names, and to the admins when it is something they answer for", () => {
    const named = { ...base, toPersons: [ADA.email] };
    expect(pushReaches(named, { email: ADA.email, admin: false }, false, everyone)).toBe(true);
    expect(pushReaches(named, { email: BOB.email, admin: false }, false, everyone)).toBe(false);
    expect(pushReaches(named, { admin: false }, false, everyone)).toBe(false);
    expect(pushReaches(named, { email: "boss@x.test", admin: true }, false, everyone)).toBe(true);
    const mention = { ...base, kind: "mention" as const, botId: "", toPersons: [ADA.email] };
    expect(pushReaches(mention, { email: "boss@x.test", admin: true }, false, everyone)).toBe(false);
    expect(pushReaches(mention, { email: ADA.email, admin: false }, false, everyone)).toBe(true);
  });

  it("takes a direct message to the person it is for without asking what they can see, and to nobody else", () => {
    const direct = directMessageNotification({ threadId: "dm:1", groupId: "1", from: BOB, to: ADA.email, text: "oi" });
    const nothing = () => sees([]);
    expect(pushReaches(direct, { email: ADA.email, admin: false }, false, nothing)).toBe(true);
    expect(pushReaches(direct, { email: "cal@x.test", admin: false }, false, nothing)).toBe(false);
    expect(pushReaches(direct, { email: "boss@x.test", admin: true }, false, nothing)).toBe(false);
  });

  it("keeps a spend alert and the day's summary from every member, whatever they can see", () => {
    for (const kind of ["spend", "daily-digest"] as const) {
      expect(pushReaches({ ...base, kind }, { email: ADA.email, admin: false }, false, everyone), kind).toBe(false);
      expect(pushReaches({ ...base, kind }, { email: "boss@x.test", admin: true }, false, everyone), kind).toBe(true);
    }
  });

  it("asks what a guest can see, not what a member can", () => {
    const asked: Array<{ email?: string; guest?: boolean }> = [];
    const spy = (who: { email?: string; guest?: boolean }) => { asked.push(who); return everyone(who); };
    expect(pushReaches(base, { email: "gus@x.test", admin: false, guest: true }, false, spy)).toBe(false);
    expect(asked).toEqual([{ email: "gus@x.test", admin: false, guest: true }]);
  });
});
