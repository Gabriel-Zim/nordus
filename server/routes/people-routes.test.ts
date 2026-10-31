import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification, NotificationLogEntry } from "../../shared/notification.ts";
import { VisibleSet, type Viewer } from "../bot-visibility.ts";
import { DirectMessages, type DirectLimits } from "../direct-messages.ts";
import { json, readBody } from "../harness/http.ts";
import { PeopleDirectory } from "../people-directory.ts";
import { authEmail, authIsAdmin, authIsGuest } from "../people-roles.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createDmRoutes, type DmRouteDeps } from "./dms.ts";
import { createNotificationRoutes } from "./notifications.ts";
import { createPeopleRoutes } from "./people.ts";
import { dispatchRoutes, type RouteHandler } from "./table.ts";

const BOSS = "boss@x.test";
const ADA = "ada@x.test";
const BOB = "bob@x.test";
const CAL = "cal@x.test";
const GUS = "gus@x.test";
const lists = { admins: [BOSS], members: [ADA, BOB, CAL], guests: [GUS] };

const who: Record<string, RequestAuth> = {};
for (const [name, email, admin, guest] of [["boss", BOSS, true, false], ["ada", ADA, false, false], ["bob", BOB, false, false], ["cal", CAL, false, false], ["gus", GUS, false, true]] as const) {
  who[name] = { kind: "session", via: "bearer", scopes: admin ? ["admin", "client"] : ["client"], session: { id: name, email, ...(guest ? { guest: true } : {}) } } as unknown as RequestAuth;
}
who.desktop = { kind: "loopback", scopes: ["admin", "client"] };

const servers: Server[] = [];
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "nordus-people-routes-")); });
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  rmSync(dir, { recursive: true, force: true });
});

async function serve(build: (members: { directory: PeopleDirectory; dms: DirectMessages }) => RouteHandler[], rooms: Array<{ id: string; people?: string[] }> = [], dmLimits?: Partial<DirectLimits>) {
  const directory = new PeopleDirectory({
    file: join(dir, "people.json"), lists: () => lists, signedIn: () => [], profile: () => ({}),
    shareRoom: (a, b) => rooms.some((room) => room.people?.includes(a) && room.people.includes(b)),
  });
  const dms = new DirectMessages({ file: join(dir, "dms.json"), nameOf: (email) => directory.nameOf(email), ...(dmLimits ? { limits: dmLimits } : {}) });
  const routes = build({ directory, dms });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = who[String(req.headers["x-as"])] ?? who.desktop!;
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { "x-as": as, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  return { call, directory, dms };
}

describe("direct message routes", () => {
  function dmRoutes(extra: Partial<DmRouteDeps> = {}) {
    const sent: Array<{ to: string[]; payload: Record<string, unknown> }> = [];
    const notify = vi.fn<(notification: Notification) => void>();
    return {
      sent, notify,
      build: ({ directory, dms }: { directory: PeopleDirectory; dms: DirectMessages }) => [
        createDmRoutes({ dms, directory, emailOf: authEmail, sendTo: (to, payload) => sent.push({ to: [...to], payload }), notify, ...extra }),
      ],
    };
  }

  it("opens one conversation for two people, the same from either side", async () => {
    const spy = dmRoutes();
    const { call } = await serve(spy.build);
    const opened = await call("ada", "POST", "/api/dms", { peer: BOB });
    expect(opened.status).toBe(200);
    expect(opened.body.dm).toMatchObject({ peer: BOB, peerName: "Bob", unread: false });
    const again = await call("bob", "POST", "/api/dms", { peer: ADA });
    expect(again.body.dm.id).toBe(opened.body.dm.id);
    expect((await call("ada", "GET", "/api/dms")).body.dms.map((dm: { id: string }) => dm.id)).toEqual([opened.body.dm.id]);
    expect(spy.sent[0]).toMatchObject({ to: [ADA], payload: { kind: "dm" } });
  });

  it("refuses a conversation with yourself, a stranger, or nobody", async () => {
    const { call } = await serve(dmRoutes().build);
    for (const peer of [ADA, "stranger@x.test", "nonsense", undefined, 7]) {
      expect((await call("ada", "POST", "/api/dms", { peer })).status, String(peer)).toBe(404);
    }
  });

  it("shows a line to the two people only, and notifies the other one only", async () => {
    const spy = dmRoutes();
    const { call } = await serve(spy.build);
    const { id } = (await call("ada", "POST", "/api/dms", { peer: BOB })).body.dm;
    spy.sent.length = 0;
    const posted = await call("ada", "POST", `/api/dms/${id}/messages`, { text: "  vamos almoçar?  " });
    expect(posted.status).toBe(201);
    expect(posted.body.message).toMatchObject({ from: ADA, text: "vamos almoçar?" });
    const lines = spy.sent.filter((frame) => frame.payload.kind === "dm.message");
    expect(lines.map((frame) => frame.to).sort()).toEqual([[ADA], [BOB]]);
    expect(spy.sent.every((frame) => frame.to.every((email) => [ADA, BOB].includes(email)))).toBe(true);
    expect(spy.notify).toHaveBeenCalledTimes(1);
    const notification = spy.notify.mock.calls[0]![0];
    expect(notification).toMatchObject({ kind: "mention", toPersons: [BOB], threadId: `dm:${id}`, groupId: id, body: "vamos almoçar?" });
    const mine = (await call("ada", "GET", `/api/dms/${id}/messages`)).body;
    expect(mine.messages.map((m: { text: string }) => m.text)).toEqual(["vamos almoçar?"]);
    expect((await call("bob", "GET", "/api/dms")).body.dms[0]).toMatchObject({ unread: true });
    expect((await call("bob", "POST", `/api/dms/${id}/read`)).body.dm.unread).toBe(false);
  });

  it("keeps everyone else out, admins included, as if the conversation did not exist", async () => {
    const spy = dmRoutes();
    const { call } = await serve(spy.build);
    const { id } = (await call("ada", "POST", "/api/dms", { peer: BOB })).body.dm;
    await call("ada", "POST", `/api/dms/${id}/messages`, { text: "só entre nós" });
    for (const outsider of ["boss", "cal", "gus", "desktop"]) {
      const listed = await call(outsider, "GET", "/api/dms");
      expect(JSON.stringify(listed.body), outsider).not.toContain("só entre nós");
      for (const [method, path, body] of [
        ["GET", `/api/dms/${id}/messages`], ["POST", `/api/dms/${id}/messages`, { text: "intruso" }], ["POST", `/api/dms/${id}/read`],
      ] as const) {
        const res = await call(outsider, method, path, body);
        expect([403, 404], `${outsider} ${method} ${path}`).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain("só entre nós");
      }
    }
    expect((await call("ada", "GET", `/api/dms/${id}/messages`)).body.messages).toHaveLength(1);
  });

  it("answers 429 to someone who sends too many lines in a short while, and not to the person they write to", async () => {
    let now = 1_000_000;
    const spy = dmRoutes({ now: () => now, sendWindows: [{ limit: 3, windowMs: 60_000 }] });
    const { call } = await serve(spy.build);
    const { id } = (await call("ada", "POST", "/api/dms", { peer: BOB })).body.dm;
    for (const text of ["um", "dois", "três"]) expect((await call("ada", "POST", `/api/dms/${id}/messages`, { text })).status, text).toBe(201);
    const refused = await call("ada", "POST", `/api/dms/${id}/messages`, { text: "quatro" });
    expect(refused.status).toBe(429);
    expect(String(refused.body.error)).toMatch(/too many|slow/i);
    expect((await call("bob", "POST", `/api/dms/${id}/messages`, { text: "calma" })).status).toBe(201);
    expect((await call("ada", "GET", `/api/dms/${id}/messages`)).body.messages.map((m: { text: string }) => m.text)).toEqual(["um", "dois", "três", "calma"]);
    now += 61_000;
    expect((await call("ada", "POST", `/api/dms/${id}/messages`, { text: "voltei" })).status).toBe(201);
  });

  it("answers 409 when opening one more conversation would pass what the person or the workspace may hold", async () => {
    const { call } = await serve(dmRoutes().build, [], { pairsPerPerson: 1 });
    expect((await call("ada", "POST", "/api/dms", { peer: BOB })).status).toBe(200);
    expect((await call("ada", "POST", "/api/dms", { peer: BOB })).status).toBe(200);
    const refused = await call("ada", "POST", "/api/dms", { peer: CAL });
    expect(refused.status).toBe(409);
    expect((await call("cal", "POST", "/api/dms", { peer: BOB })).status).toBe(409);
  });

  it("asks someone with no address of their own to sign in with one", async () => {
    const { call } = await serve(dmRoutes().build);
    expect((await call("desktop", "POST", "/api/dms", { peer: ADA })).status).toBe(403);
    expect((await call("desktop", "GET", "/api/dms")).status).toBe(403);
  });

  it("lets a guest write only to people who share a room with them", async () => {
    const { call } = await serve(dmRoutes().build, [{ id: "r1", people: [GUS, ADA] }]);
    expect((await call("gus", "POST", "/api/dms", { peer: ADA })).status).toBe(200);
    expect((await call("gus", "POST", "/api/dms", { peer: BOB })).status).toBe(404);
    expect((await call("gus", "POST", "/api/dms", { peer: BOSS })).status).toBe(404);
    expect((await call("ada", "POST", "/api/dms", { peer: GUS })).status).toBe(200);
  });

  it("refuses an empty line and pages older ones", async () => {
    const { call } = await serve(dmRoutes().build);
    const { id } = (await call("ada", "POST", "/api/dms", { peer: BOB })).body.dm;
    expect((await call("ada", "POST", `/api/dms/${id}/messages`, { text: "   " })).status).toBe(400);
    expect((await call("ada", "POST", `/api/dms/${id}/messages`, {})).status).toBe(400);
    for (const text of ["um", "dois", "três"]) await call("ada", "POST", `/api/dms/${id}/messages`, { text });
    const page = (await call("bob", "GET", `/api/dms/${id}/messages?limit=2`)).body;
    expect(page.messages.map((m: { text: string }) => m.text)).toEqual(["dois", "três"]);
    expect(page.hasMore).toBe(true);
    const older = (await call("bob", "GET", `/api/dms/${id}/messages?limit=2&before=${page.messages[0].id}`)).body;
    expect(older.messages.map((m: { text: string }) => m.text)).toEqual(["um"]);
    expect(older.hasMore).toBe(false);
  });
});

describe("the people routes", () => {
  type Room = { id: string; name: string; people?: string[]; createdBy?: string; general?: true; memberIds: string[]; threadId: string; dm?: true };
  function roomRoutes(rooms: Room[]) {
    const audienceChanged = vi.fn();
    const bots = [{ id: "b1", threadId: "tb1" }];
    const store = {
      group: (id: string) => rooms.find((room) => room.id === id),
      patchGroup: (id: string, patch: { people?: string[] }) => {
        const room = rooms.find((candidate) => candidate.id === id);
        if (!room) return undefined;
        if (patch.people === undefined) delete room.people; else room.people = patch.people;
        return room;
      },
    };
    return {
      audienceChanged, rooms,
      build: ({ directory }: { directory: PeopleDirectory }) => [
        createPeopleRoutes({
          directory, store: store as never, emailOf: authEmail, audienceChanged, publicGroupState: (group) => group,
          visibleFor: (auth) => {
            const viewer: Viewer = authIsAdmin(auth) ? { kind: "all" } : { kind: "member", ...(authEmail(auth) ? { email: authEmail(auth)! } : {}), ...(authIsGuest(auth) ? { guest: true } : {}) };
            return new VisibleSet(bots, rooms, viewer);
          },
        }),
      ],
    };
  }
  const rooms = (): Room[] => [
    { id: "eng", name: "Engenharia", memberIds: ["b1"], threadId: "teng", people: [ADA, BOB], createdBy: ADA },
    { id: "open", name: "Aberta", memberIds: ["b1"], threadId: "topen" },
    { id: "geral", name: "Geral", memberIds: ["b1"], threadId: "tgeral", general: true },
  ];

  it("lists the directory with roles and nothing else, and a guest only the people who share a room with them", async () => {
    const spy = roomRoutes(rooms());
    const { call } = await serve(spy.build, [{ id: "eng", people: [GUS, ADA] }]);
    const everyone = await call("ada", "GET", "/api/people/directory");
    expect(everyone.status).toBe(200);
    expect(everyone.body.map((person: { email: string }) => person.email)).toEqual([ADA, BOB, BOSS, CAL, GUS]);
    for (const person of everyone.body) expect(Object.keys(person).sort()).toEqual(["email", "name", "role"]);
    expect(everyone.body.find((person: { email: string }) => person.email === GUS).role).toBe("guest");
    const seen = await call("gus", "GET", "/api/people/directory");
    expect(seen.body.map((person: { email: string }) => person.email)).toEqual([ADA, GUS]);
  });

  it("lets an admin and the person who opened a room choose its people, and keeps the opener in", async () => {
    const spy = roomRoutes(rooms());
    const { call } = await serve(spy.build);
    const byAdmin = await call("boss", "PUT", "/api/people/rooms/eng/people", { people: [BOB, CAL] });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.group.people).toEqual([BOB, CAL, ADA]);
    expect(spy.audienceChanged).toHaveBeenCalledTimes(1);
    const byOpener = await call("ada", "PUT", "/api/people/rooms/eng/people", { people: [CAL] });
    expect(byOpener.status).toBe(200);
    expect(byOpener.body.group.people).toEqual([CAL, ADA]);
    expect(spy.audienceChanged).toHaveBeenCalledTimes(2);
  });

  it("refuses a member who only belongs to the room, and shows a room one is not in as missing", async () => {
    const spy = roomRoutes(rooms());
    const { call } = await serve(spy.build);
    const listed = await call("bob", "PUT", "/api/people/rooms/eng/people", { people: [ADA, BOB, CAL] });
    expect(listed.status).toBe(403);
    expect((await call("cal", "PUT", "/api/people/rooms/eng/people", { people: [CAL] })).status).toBe(404);
    expect((await call("gus", "PUT", "/api/people/rooms/eng/people", { people: [GUS] })).status).toBe(404);
    expect((await call("bob", "PUT", "/api/people/rooms/open/people", { people: [BOB] })).status).toBe(403);
    expect(spy.rooms[0]!.people).toEqual([ADA, BOB]);
    expect(spy.audienceChanged).not.toHaveBeenCalled();
  });

  it("opens a room to everyone again with null, and never limits Geral", async () => {
    const spy = roomRoutes(rooms());
    const { call } = await serve(spy.build);
    const opened = await call("ada", "PUT", "/api/people/rooms/eng/people", { people: null });
    expect(opened.status).toBe(200);
    expect(opened.body.group).not.toHaveProperty("people");
    expect((await call("boss", "PUT", "/api/people/rooms/geral/people", { people: [ADA] })).status).toBe(400);
  });

  it("refuses an address that is not on this workspace's list, and an empty room", async () => {
    const spy = roomRoutes(rooms());
    const { call } = await serve(spy.build);
    const stranger = await call("boss", "PUT", "/api/people/rooms/open/people", { people: [ADA, "stranger@x.test"] });
    expect(stranger.status).toBe(400);
    expect(stranger.body.error).toContain("stranger@x.test");
    expect((await call("boss", "PUT", "/api/people/rooms/open/people", { people: [] })).status).toBe(400);
    expect((await call("boss", "PUT", "/api/people/rooms/open/people", { people: "ada@x.test" })).status).toBe(400);
    expect((await call("boss", "PUT", "/api/people/rooms/nope/people", { people: [ADA] })).status).toBe(404);
  });
});

describe("the notification feed", () => {
  const entry = (id: string, extra: Partial<NotificationLogEntry>): NotificationLogEntry =>
    ({ id, at: 1, kind: "done", botId: "b1", botName: "Otter", threadId: "t-open", title: id, body: "", read: false, ...extra });
  const feed: NotificationLogEntry[] = [
    entry("for-all", {}),
    entry("approval-ada", { kind: "approval", toPersons: [ADA] }),
    entry("mention-bob", { kind: "mention", botId: "", threadId: "t-open", toPersons: [BOB] }),
    entry("dm-bob", { kind: "mention", botId: "", threadId: "dm:xyz", toPersons: [BOB] }),
    entry("in-private-room", { threadId: "t-private" }),
    entry("hidden-agent", { botId: "b-hidden" }),
  ];

  async function feedServer(log: NotificationLogEntry[]) {
    const markRead = vi.fn();
    const markAllRead = vi.fn();
    const bots = [{ id: "b1", threadId: "tb1" }, { id: "b-hidden", threadId: "tbh", visibility: "admins" as const }];
    const groups = [
      { id: "open", threadId: "t-open", memberIds: ["b1"] },
      { id: "private", threadId: "t-private", memberIds: ["b1"], people: [ADA] },
    ];
    const recent = vi.fn(() => log.map((row) => ({ ...row })));
    const audience = {
      emailOf: authEmail,
      visibleFor: (auth: RequestAuth) => new VisibleSet(bots, groups, authIsAdmin(auth) ? { kind: "all" } : { kind: "member", ...(authEmail(auth) ? { email: authEmail(auth)! } : {}) }),
    };
    const served = await serve(() => [createNotificationRoutes({ recent, markRead, markAllRead }, undefined, audience)]);
    return { ...served, markRead, markAllRead };
  }
  const ids = (body: { notifications: NotificationLogEntry[] }) => body.notifications.map((row) => row.id);

  it("shows each person what was for everyone or for them, about what they can see", async () => {
    const { call } = await feedServer(feed);
    expect(ids((await call("ada", "GET", "/api/notifications")).body)).toEqual(["for-all", "approval-ada", "in-private-room"]);
    expect(ids((await call("bob", "GET", "/api/notifications")).body)).toEqual(["for-all", "mention-bob", "dm-bob"]);
    expect(ids((await call("cal", "GET", "/api/notifications")).body)).toEqual(["for-all"]);
  });

  it("shows an admin what an admin answers for, even when it was sent to someone else, but not another person's mention or message", async () => {
    const { call } = await feedServer(feed);
    expect(ids((await call("boss", "GET", "/api/notifications")).body)).toEqual(["for-all", "approval-ada", "in-private-room", "hidden-agent"]);
  });

  it("keeps the workspace's spend alerts and the day's summary from every member, rows from before addressing included", async () => {
    const money = [
      entry("spend-alert", { kind: "spend", body: "Otter has spent $12.40 of $20.00 this month." }),
      entry("spend-ada", { kind: "spend", toPersons: [ADA], body: "Otter está perto do limite que você definiu." }),
      entry("digest", { kind: "daily-digest", botId: "", body: "3 avisos do dia." }),
      entry("for-all", {}),
    ];
    const { call } = await feedServer(money);
    expect(ids((await call("ada", "GET", "/api/notifications")).body)).toEqual(["spend-ada", "for-all"]);
    expect(ids((await call("bob", "GET", "/api/notifications")).body)).toEqual(["for-all"]);
    expect(ids((await call("cal", "GET", "/api/notifications")).body)).toEqual(["for-all"]);
    expect(JSON.stringify((await call("cal", "GET", "/api/notifications")).body)).not.toContain("$12.40");
    expect(ids((await call("boss", "GET", "/api/notifications")).body)).toEqual(["spend-alert", "digest", "for-all"]);
    expect((await call("cal", "POST", "/api/notifications/spend-alert/read")).status).toBe(404);
  });

  it("marks read only what the person can see", async () => {
    const { call, markRead, markAllRead } = await feedServer(feed);
    expect((await call("cal", "POST", "/api/notifications/approval-ada/read")).status).toBe(404);
    expect((await call("cal", "POST", "/api/notifications/dm-bob/read")).status).toBe(404);
    expect(markRead).not.toHaveBeenCalled();
    expect((await call("bob", "POST", "/api/notifications/dm-bob/read")).status).toBe(200);
    expect(markRead).toHaveBeenCalledWith("dm-bob");
    markRead.mockClear();
    expect((await call("cal", "POST", "/api/notifications/read-all")).status).toBe(200);
    expect(markRead.mock.calls.map(([id]) => id)).toEqual(["for-all"]);
    expect(markAllRead).not.toHaveBeenCalled();
  });
});
