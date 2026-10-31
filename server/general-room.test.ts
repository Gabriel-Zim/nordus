import { describe, expect, it } from "vitest";

import { ensureGeneralRoom, GENERAL_ROOM_NAME, keepGeneralRoom, resyncGeneralRoom } from "./general-room.ts";
import type { BotRecord, GroupRecord } from "./store.ts";

const options = { internal: (bot: BotRecord) => bot.audience === "internal" };

function fakeStore(bots: Array<Pick<BotRecord, "id" | "visibility" | "audience" | "client">>) {
  const groups: GroupRecord[] = [];
  const listeners = new Set<(change: { type: string; botId?: string }) => void>();
  const store = {
    bots: bots as BotRecord[],
    groups,
    createGroup(name: string, memberIds: string[]) {
      const group = { id: `g${groups.length}`, name, memberIds, dm: undefined } as GroupRecord;
      groups.push(group);
      return group;
    },
    patchGroup(id: string, patch: Partial<GroupRecord>) {
      const group = groups.find((candidate) => candidate.id === id)!;
      Object.assign(group, patch);
      return group;
    },
    onChange(listener: (change: { type: string; botId?: string }) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(change: { type: string; botId?: string }) {
      for (const listener of listeners) listener(change);
    },
  };
  return store;
}

describe("ensureGeneralRoom", () => {
  it("waits for two bots, then creates one marked room and never a second", () => {
    const store = fakeStore([{ id: "a", visibility: undefined, audience: "internal" }]);
    expect(ensureGeneralRoom(store as never, options)).toBeUndefined();
    store.bots.push({ id: "b", visibility: "everyone", audience: "internal" } as BotRecord);
    const room = ensureGeneralRoom(store as never, options);
    expect(room).toMatchObject({ name: GENERAL_ROOM_NAME, general: true, memberIds: ["a", "b"] });
    ensureGeneralRoom(store as never, options);
    ensureGeneralRoom(store as never, options);
    expect(store.groups).toHaveLength(1);
  });

  it("leaves restricted bots out and keeps the room's audience open", () => {
    const store = fakeStore([
      { id: "a", visibility: "everyone", audience: "internal" },
      { id: "b", visibility: undefined, audience: "internal" },
      { id: "hr", visibility: { people: ["ada@example.test"] }, audience: "internal" },
      { id: "boss", visibility: "admins", audience: "internal" },
    ]);
    const room = ensureGeneralRoom(store as never, options)!;
    expect(room.memberIds).toEqual(["a", "b"]);
    expect(room.audienceFloor).toBeUndefined();
  });

  it("follows bots as they are created, deleted and change visibility", () => {
    const store = fakeStore([{ id: "a", audience: "internal" }, { id: "b", audience: "internal" }] as BotRecord[]);
    keepGeneralRoom(store as never, () => options);
    store.emit({ type: "bot", botId: "a" });
    const room = store.groups[0]!;
    expect(room.memberIds).toEqual(["a", "b"]);

    store.bots.push({ id: "c", visibility: undefined, audience: "internal" } as BotRecord);
    store.emit({ type: "bot", botId: "c" });
    expect(room.memberIds).toEqual(["a", "b", "c"]);

    store.bots.find((bot) => bot.id === "b")!.visibility = "admins";
    room.audienceFloor = "admins";
    store.emit({ type: "bot", botId: "b" });
    expect(room.memberIds).toEqual(["a", "c"]);
    expect(room.audienceFloor).toBeUndefined();

    store.bots.find((bot) => bot.id === "b")!.visibility = "everyone";
    store.emit({ type: "bot", botId: "b" });
    expect(room.memberIds).toEqual(["a", "c", "b"]);

    store.bots.splice(store.bots.findIndex((bot) => bot.id === "a"), 1);
    store.emit({ type: "bot.deleted", botId: "a" });
    expect(room.memberIds).toEqual(["c", "b"]);
    expect(store.groups).toHaveLength(1);
  });

  it("never takes a client's bot, nor an unmarked one, and drops one that becomes a client's", () => {
    const store = fakeStore([
      { id: "a", audience: "internal" },
      { id: "b", audience: "internal" },
      { id: "scoped", audience: "internal", client: "evergreen" },
      { id: "facing", audience: "client" },
      { id: "unmarked" },
    ] as BotRecord[]);
    const room = ensureGeneralRoom(store as never, options)!;
    expect(room.memberIds).toEqual(["a", "b"]);

    store.bots.find((bot) => bot.id === "b")!.client = "evergreen";
    expect(ensureGeneralRoom(store as never, options)!.memberIds).toEqual(["a"]);
    store.bots.find((bot) => bot.id === "a")!.audience = "client";
    expect(ensureGeneralRoom(store as never, options)!.memberIds).toEqual([]);
  });

  it("does nothing until a bot changes", () => {
    const store = fakeStore([{ id: "a", audience: "internal" }, { id: "b", audience: "internal" }] as BotRecord[]);
    keepGeneralRoom(store as never, () => options);
    expect(store.groups).toHaveLength(0);
  });

  it("drops a bot that became direct client service when the room is recomputed", () => {
    const direct = new Set<string>();
    const dynamic = { internal: (bot: BotRecord) => bot.audience === "internal" && !direct.has(bot.id) };
    const store = fakeStore([{ id: "a", audience: "internal" }, { id: "b", audience: "internal" }, { id: "c", audience: "internal" }] as BotRecord[]);
    const room = ensureGeneralRoom(store as never, dynamic)!;
    expect(room.memberIds).toEqual(["a", "b", "c"]);
    direct.add("b");
    expect(ensureGeneralRoom(store as never, dynamic)!.memberIds).toEqual(["a", "c"]);
  });

  it("re-syncs an existing room at start but never creates one", () => {
    const direct = new Set<string>();
    const dynamic = { internal: (bot: BotRecord) => bot.audience === "internal" && !direct.has(bot.id) };
    const store = fakeStore([{ id: "a", audience: "internal" }, { id: "b", audience: "internal" }] as BotRecord[]);
    resyncGeneralRoom(store as never, dynamic);
    expect(store.groups).toHaveLength(0);
    const room = ensureGeneralRoom(store as never, dynamic)!;
    direct.add("b");
    resyncGeneralRoom(store as never, dynamic);
    expect(room.memberIds).toEqual(["a"]);
  });
});
