import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { botFolder } from "./bot-folder.ts";
import { profileRevision } from "./profile-revision.ts";
import { flushProfileHistory, readHistory } from "./profile-versions.ts";
import {
  ProfileRequestService,
  profileTurnKey,
  type OptionCardLike,
  type ProfileRequestStore,
} from "./profile-requests.ts";
import { profileItems, reviewedProfileKey, type ProfileRequestV1 } from "../shared/profile-request.ts";
import type { BotRecord } from "./store.ts";
import { appliesNow, directApply, type DirectApplyCheck } from "./direct-apply.ts";

interface StoredMessage {
  id: string;
  card?: OptionCardLike;
}

class MemoryStore implements ProfileRequestStore {
  readonly bots = new Map<string, BotRecord>();
  readonly threads = new Map<string, StoredMessage[]>();
  readonly setSoulCalls: Array<[string, string]> = [];
  private sequence = 0;

  bot(id: string): BotRecord | undefined {
    return this.bots.get(id);
  }

  messagesFor(threadId: string): StoredMessage[] {
    return this.threads.get(threadId) ?? [];
  }

  appendMessage(
    threadId: string,
    message: { role: "bot"; kind: "options"; card: OptionCardLike; from?: { botId: string; name: string; color: string } },
  ): StoredMessage {
    const stored: StoredMessage = { id: `message-${++this.sequence}`, card: message.card };
    const messages = this.threads.get(threadId) ?? [];
    messages.push(stored);
    this.threads.set(threadId, messages);
    return stored;
  }

  patchMessage(
    threadId: string,
    messageId: string,
    patch: { card: OptionCardLike },
  ): StoredMessage | null {
    const message = this.messagesFor(threadId).find((candidate) => candidate.id === messageId);
    if (!message) return null;
    message.card = patch.card;
    return message;
  }

  patchBot(id: string, patch: Parameters<ProfileRequestStore["patchBotProfile"]>[1]): BotRecord | null {
    const bot = this.bots.get(id);
    if (!bot) return null;
    Object.assign(bot, patch);
    return bot;
  }

  patchBotProfile(id: string, patch: Parameters<ProfileRequestStore["patchBotProfile"]>[1]): BotRecord | null {
    return this.patchBot(id, patch);
  }

  setSoul(id: string, soul: string): BotRecord | null {
    this.setSoulCalls.push([id, soul]);
    const bot = this.bots.get(id);
    if (!bot) return null;
    bot.soul = soul;
    return bot;
  }
}

function harness(options: { name: string; chiefOfStaff?: boolean }) {
  const store = new MemoryStore();
  const service = new ProfileRequestService({ store });

  function addBot(overrides: { name: string }): BotRecord {
    const record = {
      id: randomUUID(),
      threadId: randomUUID(),
      name: overrides.name,
      title: "",
      description: "",
      soul: "",
      notifications: true,
      color: "blue",
      unread: false,
      modelSelection: "default",
      resumeCursors: {},
    } as unknown as BotRecord;
    store.bots.set(record.id, record);
    // recordProfileChange skips its write when the bot's folder is gone, so a synthetic bot needs one too.
    mkdirSync(botFolder(record.id), { recursive: true, mode: 0o700 });
    return record;
  }

  const bot = addBot({ name: options.name });
  return { service, store, bot, addBot };
}

describe("ProfileRequestService", () => {
  it("applies Full Access from the source thread without exposing an unanswered card and claims replays", () => {
    const { store, bot } = harness({ name: "Scout" });
    bot.approvalMode = "full";
    const autoApply = vi.fn((_botId: string, threadId: string, _target: string) => (threadId === "full-thread" ? "full-access" as const : null));
    const service = new ProfileRequestService({ store, autoApply });
    const appended: OptionCardLike[] = [];
    const append = store.appendMessage.bind(store);
    vi.spyOn(store, "appendMessage").mockImplementation((threadId, message) => {
      appended.push(structuredClone(message.card));
      return append(threadId, message);
    });
    const patch = vi.spyOn(store, "patchBotProfile");
    const ask = service.submit({ botId: bot.id, threadId: bot.threadId, changes: { title: "Review me" }, reason: "requested" });
    expect(ask.state).toBe("pending");
    expect(bot.title).toBe("");
    expect(appended[0]).toMatchObject({ options: ["Confirm", "Cancel"] });

    const full = service.submit({ botId: bot.id, threadId: "full-thread", changes: { name: "Kiwi" }, reason: "requested" });
    expect(full).toMatchObject({ state: "applied", result: { state: "applied", applied: [{ targetBotId: bot.id, fields: ["name"] }] } });
    expect(bot.name).toBe("Kiwi");
    expect(autoApply).toHaveBeenLastCalledWith(bot.id, "full-thread", bot.id);
    expect(appended[1]).toMatchObject({ options: [], dismissed: true });
    expect(store.messagesFor("full-thread")[0]?.card).toMatchObject({ answered: "allow", dismissed: true });
    expect(service.resolve({ botId: bot.id, threadId: "full-thread", requestId: full.requestId, behavior: "allow" }))
      .toMatchObject({ state: "already_settled", behavior: "allow" });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("retains Full Access validation and reports application failures without a pending approval", () => {
    const { store, bot, addBot } = harness({ name: "Chief" });
    const peer = addBot({ name: "Peer" });
    const service = new ProfileRequestService({ store, autoApply: () => "full-access", validateTarget: () => "Outside your team" });
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, targetBotId: peer.id, changes: { name: "Changed" }, reason: "requested" }))
      .toThrow("Outside your team");
    expect(store.messagesFor(bot.threadId)).toHaveLength(0);
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, changes: { approvalMode: "full" }, reason: "requested" }))
      .toThrow("unsupported profile field");
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, changes: { toolScope: null }, reason: "requested" }))
      .toThrow("unsupported profile field");
    vi.spyOn(store, "patchBotProfile").mockImplementationOnce(() => { throw new Error("profile write failed"); });
    expect(() => service.submit({ botId: bot.id, threadId: bot.threadId, changes: { name: "Kiwi" }, reason: "requested" }))
      .toThrow("profile write failed");
    expect(bot.name).toBe("Chief");
    expect(store.messagesFor(bot.threadId)[0]?.card).toMatchObject({ dismissed: true, options: [] });
  });

  it("reports a committed Full Access profile accurately when its receipt cannot settle", () => {
    const { store, bot } = harness({ name: "Scout" });
    const service = new ProfileRequestService({ store, autoApply: () => "full-access" });
    const patch = vi.spyOn(store, "patchBotProfile");
    const settle = vi.spyOn(store, "patchMessage").mockImplementation(() => { throw new Error("receipt write failed"); });
    const result = service.submit({ botId: bot.id, threadId: bot.threadId, changes: { name: "Kiwi" }, reason: "requested" });
    expect(result).toMatchObject({ state: "applied", result: { settlementPending: true } });
    expect(result.state === "applied" && result.result.message).not.toContain("Confirm");
    expect(bot.name).toBe("Kiwi");
    expect(store.messagesFor(bot.threadId)[0]?.card).toMatchObject({ dismissed: true, options: [] });
    settle.mockRestore();
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: result.requestId, behavior: "allow" }))
      .toMatchObject({ state: "already_settled", behavior: "allow" });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it("validates through the profile boundary, pins a revision, and appends a durable card", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const result = service.propose({
      botId: bot.id,
      threadId: bot.threadId,
      changes: { name: "Kiwi", title: "Tracker", soul: "File bugs.\nNever noise. sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      reason: "You asked me to track Discord.",
    });
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card.tool).toBe("update_profile");
    expect(card.options).toEqual(["Confirm", "Cancel"]);
    expect(card.profileRequest).toMatchObject({ version: 2, botId: bot.id, threadId: bot.threadId });
    const [item] = profileItems(card.profileRequest!);
    expect(item).toMatchObject({
      targetBotId: bot.id,
      targetName: "Scout",
      changes: { name: "Kiwi", title: "Tracker" },
      before: { name: "Scout", title: "", soul: "" },
    });
    expect(item!.changes.soul).not.toContain("sk-ant-api03-AAAA");
    expect(item!.expectedRevision).toBe(profileRevision(bot));
    expect(result.title).toBe("Set up Scout?");
    expect(card.subtitle).toContain('Name: "Scout" → "Kiwi"');
    expect(card.subtitle).toContain("+File bugs.");
    expect(card.subtitle).toContain("Changes what Scout is told on every turn. Nothing runs.");
  });

  it("refuses unsupported fields, over-cap values, a missing reason, and empty changes with the boundary's copy", () => {
    const { service, bot } = harness({ name: "Scout" });
    const attempt = (changes: unknown, reason: unknown = "r") =>
      () => service.propose({ botId: bot.id, threadId: bot.threadId, changes, reason });
    expect(attempt({ voice: "alloy" })).toThrow("unsupported profile field: voice");
    expect(attempt({ autoApprove: true })).toThrow("unsupported profile field: autoApprove");
    expect(attempt({ soul: "x".repeat(24_001) })).toThrow("standing instructions must be at most 24000 bytes");
    expect(attempt({ name: "Kiwi" }, "")).toThrow("reason is required");
    expect(attempt({})).toThrow("Choose at least one of name, title, description, soul, cwd, notifications, speakReplies");
    expect(attempt({ name: "Scout" })).toThrow("Nothing would change");
  });

  it("proposes the alert and voice toggles as one-line before-and-after cards that apply on confirm", async () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const proposed = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { notifications: false }, reason: "r" });
    expect(proposed.summary).toContain("notifications");
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card.subtitle).toContain("Notifications: on → off");
    expect(card.subtitle).toContain("Nothing runs.");
    expect(card.subtitle).not.toContain("Changes what Scout is told");
    expect(profileItems(card.profileRequest!)[0]!.before).toEqual({ notifications: true });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposed.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "applied", applied: [{ fields: ["notifications"] }] });
    expect(store.bot(bot.id)!.notifications).toBe(false);

    const spoken = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { speakReplies: true }, reason: "r" });
    const spokenCard = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(spokenCard.subtitle).toContain("Speak replies: off → on");
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: spoken.requestId, behavior: "allow" }))
      .toMatchObject({ state: "applied" });
    expect(store.bot(bot.id)!.speakReplies).toBe(true);
    await flushProfileHistory(bot.id);
    expect(readHistory(bot.id).map((row) => row.field)).toEqual(["speakReplies", "notifications"]);
    expect(readHistory(bot.id)[0].summary).toBe('speakReplies: "off" → "on"');
  });

  it("describes a mixed folder-and-toggle card without the instruction line, and a text-plus-toggle card with it", () => {
    const { service, bot } = harness({ name: "Scout" });
    const dir = mkdtempSync(join(tmpdir(), "nordus-cwd-"));
    try {
      const mixed = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { cwd: dir, notifications: false }, reason: "r" });
      expect(mixed.detail).toContain(`Working folder: its private workspace → ${dir}`);
      expect(mixed.detail).toContain("Notifications: on → off");
      expect(mixed.detail).toContain("Scout's tools will read and write files in that folder.");
      expect(mixed.detail).not.toContain("told on every turn");
      expect(mixed.detail).toContain("Nothing runs.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const spoken = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "Tracker", speakReplies: true }, reason: "r" });
    expect(spoken.detail).toContain('Title: "" → "Tracker"');
    expect(spoken.detail).toContain("Speak replies: off → on");
    expect(spoken.detail).toContain("Changes what Scout is told on every turn. Nothing runs.");
  });

  it("fails a toggle card closed when the toggle moved after the card was prepared", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const proposed = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { notifications: false }, reason: "r" });
    store.patchBot(bot.id, { notifications: false });
    const stale = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposed.requestId, behavior: "allow" });
    expect(stale).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(store.bot(bot.id)!.notifications).toBe(false);
  });

  it("re-checks the cap after redaction, since a mask can be longer than the secret it replaces", () => {
    const { service, bot } = harness({ name: "Scout" });
    // "token: sk-ant-AAAAAAAA" masks to "token: «redacted 15 chars»" (+6 bytes); the raw value sits exactly at the cap, so only redaction growth pushes it over.
    const secretish = "token: sk-ant-AAAAAAAA";
    const filler = "x".repeat(24_000 - secretish.length - 1);
    const soul = `${filler}\n${secretish}`;
    expect(Buffer.byteLength(soul, "utf8")).toBe(24_000);
    expect(() => service.propose({ botId: bot.id, threadId: bot.threadId, changes: { soul }, reason: "r" }))
      .toThrow("standing instructions must be at most 24000 bytes");
  });

  it("applies only on confirm, through patchBot and setSoul, records history, and settles the card", async () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const { requestId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { name: "Kiwi", soul: "Be brief." }, reason: "r" });
    expect(store.bot(bot.id)!.name).toBe("Scout");
    const denied = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: "nope", behavior: "allow" });
    expect(denied).toEqual({ claimed: false, state: "not_found" });
    const applied = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" });
    expect(applied).toEqual({ claimed: true, state: "applied", applied: [{ targetBotId: bot.id, fields: ["name", "soul"] }], skipped: [] });
    expect(store.bot(bot.id)).toMatchObject({ name: "Kiwi", soul: "Be brief." });
    expect(store.setSoulCalls).toEqual([]);
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card.answered).toBe("allow");
    const [item] = profileItems(card.profileRequest!);
    expect(item!.outcome).toEqual({ state: "applied", appliedAt: expect.any(Number) });
    await flushProfileHistory(bot.id);
    const via = `card:${store.messagesFor(bot.threadId).at(-1)!.id}#${item!.itemId}`;
    expect(readHistory(bot.id).map((r) => [r.field, r.actor, r.via])).toEqual([["soul", "bot", via], ["name", "bot", via]]);
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toEqual({ claimed: true, state: "already_settled", behavior: "allow" });
  });

  it("denies without changing anything, and fails closed when the profile moved after the card", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const a = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: a.requestId, behavior: "deny" }))
      .toEqual({ claimed: true, state: "denied" });
    expect(store.bot(bot.id)!.title).toBe("");
    const b = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    store.patchBot(bot.id, { description: "changed elsewhere" });
    const stale = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: b.requestId, behavior: "allow" });
    expect(stale).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect((stale as { error: string }).error).toBe("This bot's profile changed after this card was prepared. Ask the bot to review it and propose again.");
    const dead = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(dead.held).toContain("changed after this card");
    expect(dead.expired).toBe(true);
    expect(dead.options).toEqual([]);
    expect(dead.answered).toBeUndefined();
    expect(store.bot(bot.id)!.title).toBe("");
  });

  it("never decides an expired card, even after the profile moves back under it", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const proposed = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    store.patchBot(bot.id, { description: "changed elsewhere" });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposed.requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 409 });
    const dead = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(dead.expired).toBe(true);

    store.patchBot(bot.id, { description: "" });
    const expired = "This profile request expired before it was confirmed. Ask for a fresh proposal.";
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposed.requestId, behavior: "allow" }))
      .toEqual({ claimed: true, state: "invalid", error: expired, status: 409 });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposed.requestId, behavior: "deny" }))
      .toEqual({ claimed: true, state: "invalid", error: expired, status: 409 });
    expect(store.bot(bot.id)!.title).toBe("");
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card).toMatchObject({ expired: true, options: [] });
    expect(card.answered).toBeUndefined();
  });

  it("scrubs existing profile secrets in the returned tool result as well as the card", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const secret = "sk-ant-api03-SECRETSECRETSECRETSECRETSECRET";
    store.setSoul(bot.id, `Keep ${secret} private.`);
    const result = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { soul: "Be brief." }, reason: "r" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(store.messagesFor(bot.threadId))).not.toContain(secret);
  });

  it("still cancels a proposal after its target bot was deleted", () => {
    const { service, store, bot, addBot } = harness({ name: "Chief" });
    const peer = addBot({ name: "Peer" });
    const proposed = service.propose({ botId: bot.id, threadId: bot.threadId, targetBotId: peer.id, changes: { title: "Tracker" }, reason: "r" });
    store.bots.delete(peer.id);
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: proposed.requestId, behavior: "deny" }))
      .toEqual({ claimed: true, state: "denied" });
  });

  it("commits profile fields once and can retry a failed card settlement without reapplying", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const proposed = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { name: "Kiwi", soul: "Be brief." }, reason: "r" });
    const patch = vi.spyOn(store, "patchBotProfile");
    const settle = vi.spyOn(store, "patchMessage").mockImplementationOnce(() => { throw new Error("card write failed"); });
    const args = { botId: bot.id, threadId: bot.threadId, requestId: proposed.requestId, behavior: "allow" };
    expect(service.resolve(args)).toMatchObject({ state: "applied", settlementPending: true, message: expect.stringContaining("Profile saved") });
    const [item] = profileItems(store.messagesFor(bot.threadId).at(-1)!.card!.profileRequest!);
    expect(bot).toMatchObject({ name: "Kiwi", soul: "Be brief.", lastProfileRequestId: item!.itemId });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(store.messagesFor(bot.threadId).at(-1)?.card?.held).toContain("Confirm again");
    expect(service.resolve(args)).toMatchObject({ state: "already_settled", behavior: "allow" });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(store.messagesFor(bot.threadId).at(-1)?.card?.answered).toBe("allow");
    settle.mockRestore();
  });

  it("never reapplies an interrupted card after a later proposal restores its original text", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const a = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { name: "Kiwi", soul: "Brief." }, reason: "r" });
    const patch = vi.spyOn(store, "patchBotProfile");
    vi.spyOn(store, "patchMessage").mockImplementationOnce(() => { throw new Error("card write failed"); });
    const args = { botId: bot.id, threadId: bot.threadId, requestId: a.requestId, behavior: "allow" };
    expect(service.resolve(args)).toMatchObject({ state: "applied", settlementPending: true });
    const b = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { name: "Scout", soul: "" }, reason: "restore" });
    expect(service.resolve({ ...args, requestId: b.requestId })).toMatchObject({ state: "applied" });
    expect(service.resolve(args)).toMatchObject({ state: "invalid", status: 409 });
    const [item] = profileItems(store.messagesFor(bot.threadId).at(-1)!.card!.profileRequest!);
    expect(bot).toMatchObject({ name: "Scout", soul: "", lastProfileRequestId: item!.itemId });
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it("pins ownership to the proposing conversation and rejects other behaviors", () => {
    const { service, bot } = harness({ name: "Scout" });
    const { requestId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    expect(service.resolve({ botId: "other", threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 403 });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "answer" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 400 });
  });

  it("lets a validated target be another bot, re-checks it at confirm, and applies to the target", () => {
    const { service, store, bot, addBot } = harness({ name: "Chief", chiefOfStaff: true });
    const peer = addBot({ name: "Peer" });
    let refuse: string | null = null;
    service.validateTarget = () => refuse;
    const { requestId, title } = service.propose({ botId: bot.id, threadId: bot.threadId, targetBotId: peer.id, changes: { title: "Analyst" }, reason: "r" });
    expect(title).toBe("Update @Peer's profile?");
    const card = store.messagesFor(bot.threadId).at(-1)!.card!;
    expect(card.subtitle.split("\n")[0]).toBe("Whose profile: @Peer");
    refuse = "@Peer is no longer in this section";
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 404 });
    refuse = null;
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(store.messagesFor(bot.threadId).at(-1)!.card).toMatchObject({ expired: true, options: [] });
    const fresh = service.propose({ botId: bot.id, threadId: bot.threadId, targetBotId: peer.id, changes: { title: "Analyst" }, reason: "r" });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: fresh.requestId, behavior: "allow" }))
      .toMatchObject({ state: "applied", applied: [{ targetBotId: peer.id }] });
    expect(store.bot(peer.id)!.title).toBe("Analyst");
    expect(store.bot(bot.id)!.title).toBe("");
  });

  it("bases isSetup on the target's whole profile, not just the fields this proposal touches", () => {
    const established = harness({ name: "Kiwi" });
    established.store.patchBot(established.bot.id, { title: "Tracker" });
    const rename = established.service.propose({ botId: established.bot.id, threadId: established.bot.threadId, changes: { name: "Kiwi2" }, reason: "r" });
    expect(rename.title).toBe("Update Kiwi's profile?");

    const blank = harness({ name: "Scout" });
    const first = blank.service.propose({ botId: blank.bot.id, threadId: blank.bot.threadId, changes: { title: "Tracker" }, reason: "r" });
    expect(first.title).toBe("Set up Scout?");

    const chief = harness({ name: "Chief", chiefOfStaff: true });
    const peer = chief.addBot({ name: "Peer" });
    const cross = chief.service.propose({ botId: chief.bot.id, threadId: chief.bot.threadId, targetBotId: peer.id, changes: { name: "Peer2" }, reason: "r" });
    expect(cross.title).toBe("Update @Peer's profile?");
  });

  it("rejects a payload whose requestId no longer matches its card", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const { requestId, messageId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    const message = store.messagesFor(bot.threadId).find((candidate) => candidate.id === messageId)!;
    const card = message.card!;
    store.patchMessage(bot.threadId, messageId, {
      card: { ...card, profileRequest: { ...card.profileRequest!, requestId: "mismatched" } },
    });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" }))
      .toEqual({ claimed: true, state: "invalid", error: "This profile request does not match its card", status: 409 });
  });

  it("shows the complete proposed instructions when a detailed diff is too large", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const before = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const after = Array.from({ length: 500 }, (_, i) => `changed ${i}`).join("\n");
    store.patchBot(bot.id, { title: "already set" });
    store.setSoul(bot.id, before);
    const { detail } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { soul: after }, reason: "r" });
    expect(detail).toContain("complete proposed instructions");
    expect(detail).toContain(after);
    expect(detail).toContain("changed 499");
    expect(detail).not.toContain("more lines)");
  });
});

describe("propose_profile working folder (cwd)", () => {
  it("proposes an existing folder, says where the tools will work, and applies it on confirm", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const dir = mkdtempSync(join(tmpdir(), "nordus-cwd-"));
    try {
      const result = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { cwd: dir }, reason: "You said the site lives there." });
      expect(result.detail).toContain(`Working folder: its private workspace → ${dir}`);
      expect(result.detail).toContain("Scout's tools will read and write files in that folder.");
      expect(result.detail).not.toContain("told on every turn");
      expect(result.detail).toContain("Nothing runs.");
      expect(store.bot(bot.id)!.cwd).toBeUndefined();
      const applied = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: result.requestId, behavior: "allow" });
      expect(applied).toEqual({ claimed: true, state: "applied", applied: [{ targetBotId: bot.id, fields: ["cwd"] }], skipped: [] });
      expect(store.bot(bot.id)!.cwd).toBe(dir);

      const clear = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { cwd: "" }, reason: "r" });
      expect(clear.detail).toContain(`Working folder: ${dir} → its private workspace`);
      service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: clear.requestId, behavior: "allow" });
      expect(store.bot(bot.id)!.cwd).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a missing or relative folder at proposal, and a folder that vanished before confirm", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const attempt = (cwd: string) => () => service.propose({ botId: bot.id, threadId: bot.threadId, changes: { cwd }, reason: "r" });
    expect(attempt("relative/path")).toThrow("working folder must be an absolute path");
    expect(attempt(join(tmpdir(), "nordus-definitely-missing-" + Date.now()))).toThrow(/that folder doesn't exist/);
    expect(attempt("")).toThrow("Nothing would change");

    const dir = mkdtempSync(join(tmpdir(), "nordus-cwd-"));
    const { requestId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { cwd: dir }, reason: "r" });
    rmSync(dir, { recursive: true, force: true });
    const result = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" });
    expect(result).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(store.bot(bot.id)!.cwd).toBeUndefined();
    expect(store.messagesFor(bot.threadId).at(-1)!.card!).toMatchObject({ expired: true, options: [], held: expect.stringMatching(/that folder doesn't exist/) });
  });

  it("a folder change elsewhere makes an open card stale, since cwd is part of the revision", () => {
    const { service, store, bot } = harness({ name: "Scout" });
    const { requestId } = service.propose({ botId: bot.id, threadId: bot.threadId, changes: { title: "T" }, reason: "r" });
    store.patchBot(bot.id, { cwd: tmpdir() });
    const result = service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "allow" });
    expect(result).toMatchObject({ claimed: true, state: "invalid", status: 409 });
  });
});

describe("a bot's profile changes below Full access", () => {
  const rule: DirectApplyCheck = (_botId, threadId) => appliesNow({ fullAccess: false, ownerMustConfirm: threadId === "guest-thread" });

  it("applies its own change and a peer's at Ask, each with an Undo", () => {
    const { store, bot, addBot } = harness({ name: "Scout" });
    const peer = addBot({ name: "Peer" });
    const service = new ProfileRequestService({ store, autoApply: rule });
    const own = service.submit({ botId: bot.id, threadId: bot.threadId, changes: { title: "Researcher" }, reason: "asked" });
    expect(own).toMatchObject({ state: "applied", appliedBy: "level" });
    expect(bot.title).toBe("Researcher");
    expect(store.messagesFor(bot.threadId)[0]?.card).toMatchObject({ autoApplied: true, answered: "allow", options: [] });
    const other = service.submit({ botId: bot.id, threadId: bot.threadId, targetBotId: peer.id, changes: { title: "Changed" }, reason: "asked" });
    expect(other).toMatchObject({ state: "applied", appliedBy: "level" });
    expect(peer.title).toBe("Changed");
    expect(store.messagesFor(bot.threadId)[1]?.card).toMatchObject({ autoApplied: true, answered: "allow", options: [] });
    expect(service.undo({ botId: bot.id, threadId: bot.threadId, requestId: other.requestId })).toMatchObject({ state: "undone", targetBotId: peer.id });
    expect(peer.title).toBe("");
  });

  it("keeps the card for its own working folder below Full access, and applies it at Full", () => {
    const { store, bot } = harness({ name: "Scout" });
    const fullAccess = (threadId: string) => threadId === "full-thread";
    const service = new ProfileRequestService({ store, autoApply: (botId, threadId, targetBotId) =>
      directApply({ fullAccess: fullAccess(threadId), botId, targetBotId, blocked: false }) });
    const dir = mkdtempSync(join(tmpdir(), "nordus-cwd-"));
    try {
      const asked = service.submit({ botId: bot.id, threadId: bot.threadId, changes: { cwd: dir, title: "Builder" }, reason: "asked" });
      expect(asked.state).toBe("pending");
      expect(store.bot(bot.id)!.cwd).toBeUndefined();
      expect(store.bot(bot.id)!.title).toBe("");
      expect(store.messagesFor(bot.threadId)[0]?.card).toMatchObject({ options: ["Confirm", "Cancel"] });
      const full = service.submit({ botId: bot.id, threadId: "full-thread", changes: { cwd: dir }, reason: "asked" });
      expect(full).toMatchObject({ state: "applied", appliedBy: "full-access" });
      expect(store.bot(bot.id)!.cwd).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is not held back by the open-card budget, which still holds the owner's card", () => {
    const { store, bot } = harness({ name: "Scout" });
    const canPersist = vi.fn((_botId: string, _threadId: string, opensCard: boolean) =>
      opensCard ? { ok: false as const, status: 429, error: "confirm or cancel an existing proposal first" } : { ok: true as const });
    const service = new ProfileRequestService({ store, autoApply: rule, canPersist });
    expect(service.submit({ botId: bot.id, threadId: bot.threadId, changes: { title: "Researcher" }, reason: "asked" }).state).toBe("applied");
    expect(() => service.submit({ botId: bot.id, threadId: "guest-thread", changes: { title: "Changed" }, reason: "asked" }))
      .toThrow("confirm or cancel an existing proposal first");
    expect(canPersist.mock.calls.map((call) => call[2])).toEqual([false, true]);
  });

  it("undoes only the fields it changed, once, and not after the profile moved", async () => {
    const { store, bot } = harness({ name: "Scout" });
    const service = new ProfileRequestService({ store, autoApply: rule });
    store.patchBot(bot.id, { description: "Keeps this" });
    const applied = service.submit({ botId: bot.id, threadId: bot.threadId, changes: { name: "Kiwi", title: "Brief" }, reason: "asked" });
    const undo = () => service.undo({ botId: bot.id, threadId: bot.threadId, requestId: applied.requestId });
    expect(undo()).toMatchObject({ state: "undone", targetBotId: bot.id });
    expect(bot).toMatchObject({ name: "Scout", title: "", description: "Keeps this" });
    expect(undo()).toMatchObject({ state: "already_undone" });
    expect(store.messagesFor(bot.threadId)[0]?.card).toMatchObject({ undone: true });
    await flushProfileHistory(bot.id);
    expect(readHistory(bot.id).some((row) => row.field === "name" && row.summary.includes("Kiwi"))).toBe(true);

    const stale = service.submit({ botId: bot.id, threadId: bot.threadId, changes: { title: "Bot's title" }, reason: "asked" });
    store.patchBot(bot.id, { title: "Person's title" });
    expect(service.undo({ botId: bot.id, threadId: bot.threadId, requestId: stale.requestId }))
      .toMatchObject({ state: "invalid", stale: true, error: "Changed since, so it can't be undone here." });
    expect(bot.title).toBe("Person's title");
  });

  it("offers no Undo when the old value could not be kept exactly", () => {
    const { store, bot } = harness({ name: "Scout" });
    store.patchBot(bot.id, { title: "Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH" });
    const service = new ProfileRequestService({ store, autoApply: rule });
    const applied = service.submit({ botId: bot.id, threadId: bot.threadId, changes: { title: "Be brief." }, reason: "asked" });
    expect(applied.state).toBe("applied");
    expect(store.messagesFor(bot.threadId)[0]?.card?.profileRequest?.undo).toBeUndefined();
    expect(service.undo({ botId: bot.id, threadId: bot.threadId, requestId: applied.requestId })).toMatchObject({ state: "invalid", status: 409 });
  });
});

describe("standing instructions wait for the person", () => {
  const TURN = "generation-1";

  function chief(grant: "full-access" | "self" | null = "full-access") {
    const h = harness({ name: "GerenteDeOperacao" });
    const peers = ["LUMON", "FABRIKAM", "EVERGREEN", "SOCIAL", "MontadorDeVideo"].map((name) => h.addBot({ name }));
    const live = new Set([profileTurnKey(TURN)]);
    const canPersist = vi.fn((_botId: string, _threadId: string, _opensCard: boolean) => ({ ok: true as const }));
    const service = new ProfileRequestService({
      store: h.store, autoApply: () => grant, canPersist, turnIsLive: (_threadId, key) => live.has(key),
    });
    const propose = (target: BotRecord, soul: string, turn: string | null = TURN, botId = h.bot.id) =>
      service.submit({ botId, threadId: h.bot.threadId, targetBotId: target.id, changes: { soul }, reason: "Padronizar tom", turn: turn ?? undefined });
    const card = (index = 0) => h.store.messagesFor(h.bot.threadId)[index]!.card!;
    const approve = (requestId: string, reviewedSha256?: string) =>
      service.resolve({ botId: h.bot.id, threadId: h.bot.threadId, requestId, behavior: "allow", reviewedSha256 });
    return { ...h, peers, live, canPersist, service, propose, card, approve };
  }

  it("keeps a soul change pending at Full access and at the self grant, for another bot and for itself", () => {
    for (const grant of ["full-access", "self"] as const) {
      const { bot, peers, propose, card } = chief(grant);
      const other = propose(peers[0]!, "Be calm.");
      const own = propose(bot, "Lead the team.");
      expect([other.state, own.state]).toEqual(["pending", "pending"]);
      expect(peers[0]!.soul).toBe("");
      expect(bot.soul).toBe("");
      expect(card()).toMatchObject({ options: ["Confirm", "Cancel"] });
      expect(card().autoApplied).toBeUndefined();
      expect(card().dismissed).toBeUndefined();
    }
  });

  it("applies the whole card only after Approve with the key of the list the person saw", async () => {
    const { bot, peers, propose, card, approve, store } = chief();
    const first = propose(peers[0]!, "Be calm.");
    propose(bot, "Lead the team.");
    const key = reviewedProfileKey(card().profileRequest!)!;
    expect(approve(first.requestId, "not-the-key")).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(peers[0]!.soul).toBe("");
    expect(approve(first.requestId, key)).toMatchObject({
      claimed: true, state: "applied", skipped: [],
      applied: [{ targetBotId: peers[0]!.id, fields: ["soul"] }, { targetBotId: bot.id, fields: ["soul"] }],
    });
    expect(peers[0]!.soul).toBe("Be calm.");
    expect(bot.soul).toBe("Lead the team.");
    expect(card().answered).toBe("allow");
    const items = profileItems(card().profileRequest!);
    expect(items.map((item) => item.outcome?.state)).toEqual(["applied", "applied"]);
    await flushProfileHistory(peers[0]!.id);
    const messageId = store.messagesFor(bot.threadId)[0]!.id;
    expect(readHistory(peers[0]!.id).map((row) => [row.field, row.actor, row.via])).toEqual([["soul", "bot", `card:${messageId}#${items[0]!.itemId}`]]);
  });

  it("refuses a batch without changing any profile or writing history", async () => {
    const { bot, peers, propose, card, service } = chief();
    const targets = peers.slice(0, 3);
    const revisions = targets.map((target) => profileRevision(target));
    let requestId = "";
    for (const target of targets) requestId = propose(target, `Soul of ${target.name}`).requestId;
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "deny" })).toEqual({ claimed: true, state: "denied" });
    expect(targets.map((target) => profileRevision(target))).toEqual(revisions);
    expect(profileItems(card().profileRequest!).every((item) => item.outcome === undefined)).toBe(true);
    for (const target of targets) {
      await flushProfileHistory(target.id);
      expect(readHistory(target.id)).toEqual([]);
    }
  });

  it("joins six proposals of one turn into one card with six items", () => {
    const { bot, peers, propose, card, store, canPersist } = chief();
    const targets = [...peers, bot];
    const results = targets.map((target) => propose(target, `Soul of ${target.name}`));
    expect(store.messagesFor(bot.threadId)).toHaveLength(1);
    expect(profileItems(card().profileRequest!).map((item) => item.targetBotId)).toEqual(targets.map((target) => target.id));
    expect(results.map((result) => result.state === "pending" && result.batch.joined)).toEqual([false, true, true, true, true, true]);
    expect(results.at(-1)).toMatchObject({ state: "pending", batch: { count: 6, targets: targets.map((target) => target.name) } });
    expect(new Set(results.map((result) => result.requestId)).size).toBe(1);
    expect(canPersist.mock.calls.map((call) => call[2])).toEqual([true, false, false, false, false, false]);
    expect(card().subtitle).toContain("@FABRIKAM");
  });

  it("opens a new card for a new turn, another proposer, a call without a turn, and past eight items", () => {
    const { bot, peers, propose, store, addBot, live } = chief();
    propose(peers[0]!, "One.");
    live.add(profileTurnKey("generation-2"));
    propose(peers[1]!, "Two.", "generation-2");
    expect(store.messagesFor(bot.threadId)).toHaveLength(2);
    const other = addBot({ name: "Other chief" });
    propose(other, "Mine.", "generation-2", other.id);
    expect(store.messagesFor(bot.threadId)).toHaveLength(3);
    propose(peers[2]!, "No turn.", null);
    expect(store.messagesFor(bot.threadId)).toHaveLength(4);
    const many = Array.from({ length: 9 }, (_, index) => addBot({ name: `Bot ${index}` }));
    live.add(profileTurnKey("generation-3"));
    for (const target of many) propose(target, "Same rules.", "generation-3");
    const cards = store.messagesFor(bot.threadId).slice(4).map((message) => profileItems(message.card!.profileRequest!).length);
    expect(cards).toEqual([8, 1]);
  });

  it("replaces a target's item when the same turn proposes it twice", () => {
    const { peers, propose, card } = chief();
    propose(peers[0]!, "First.");
    const keyBefore = reviewedProfileKey(card().profileRequest!);
    propose(peers[0]!, "Second.");
    const items = profileItems(card().profileRequest!);
    expect(items).toHaveLength(1);
    expect(items[0]!.changes.soul).toBe("Second.");
    expect(reviewedProfileKey(card().profileRequest!)).not.toBe(keyBefore);
  });

  it("refuses an approval of a list that grew after the person read it", () => {
    const { peers, propose, card, approve } = chief();
    const first = propose(peers[0]!, "One.");
    propose(peers[1]!, "Two.");
    const seen = reviewedProfileKey(card().profileRequest!)!;
    propose(peers[2]!, "Three.");
    expect(approve(first.requestId, seen)).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(peers.map((peer) => peer.soul)).toEqual(["", "", "", "", ""]);
    expect(card().answered).toBeUndefined();
    expect(card().expired).toBeUndefined();
    expect(approve(first.requestId, reviewedProfileKey(card().profileRequest!))).toMatchObject({ state: "applied" });
    expect(peers.slice(0, 3).map((peer) => peer.soul)).toEqual(["One.", "Two.", "Three."]);
  });

  it("takes an approval without a key only once the proposer's turn ended", () => {
    const { peers, propose, approve, live } = chief();
    const first = propose(peers[0]!, "One.");
    const waiting = approve(first.requestId);
    expect(waiting).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(peers[0]!.soul).toBe("");
    live.clear();
    expect(approve(first.requestId)).toMatchObject({ state: "applied" });
    expect(peers[0]!.soul).toBe("One.");
  });

  it("skips a target that moved since the card and applies the rest, and expires a card where nothing could apply", () => {
    const { bot, peers, propose, card, approve, store, live } = chief();
    const targets = [...peers, bot];
    let requestId = "";
    for (const target of targets) requestId = propose(target, `Soul of ${target.name}`).requestId;
    store.patchBot(peers[1]!.id, { description: "Changed by the person" });
    expect(approve(requestId, reviewedProfileKey(card().profileRequest!))).toMatchObject({
      state: "applied", skipped: [{ targetName: "FABRIKAM", state: "stale" }],
    });
    expect(targets.map((target) => target.soul === `Soul of ${target.name}`)).toEqual([true, false, true, true, true, true]);
    expect(card().answered).toBe("allow");
    expect(profileItems(card().profileRequest!)[1]!.outcome).toEqual({ state: "stale" });

    live.add(profileTurnKey("generation-2"));
    const again = propose(peers[1]!, "Retry.", "generation-2");
    propose(peers[2]!, "Retry.", "generation-2");
    store.patchBot(peers[1]!.id, { title: "Moved" });
    store.patchBot(peers[2]!.id, { title: "Moved" });
    expect(approve(again.requestId, reviewedProfileKey(card(1).profileRequest!))).toMatchObject({ claimed: true, state: "invalid", status: 409 });
    expect(card(1)).toMatchObject({ expired: true, options: [] });
    expect(card(1).answered).toBeUndefined();
  });

  it("resumes a batch that crashed midway without applying any item twice", () => {
    const { bot, peers, propose, card, approve, store } = chief();
    const targets = [...peers, bot];
    let requestId = "";
    for (const target of targets) requestId = propose(target, `Soul of ${target.name}`).requestId;
    const key = reviewedProfileKey(card().profileRequest!);
    const writes = vi.spyOn(store, "patchBotProfile");
    const save = store.patchMessage.bind(store);
    let saves = 0;
    const crash = vi.spyOn(store, "patchMessage").mockImplementation((threadId, messageId, patch) => {
      if (++saves === 2) throw new Error("disk full");
      return save(threadId, messageId, patch);
    });
    expect(approve(requestId, key)).toMatchObject({ state: "applied", settlementPending: true });
    expect(writes.mock.calls.map((call) => call[0])).toEqual([peers[0]!.id, peers[1]!.id]);
    crash.mockRestore();
    expect(approve(requestId, key)).toMatchObject({ state: "applied" });
    expect(writes.mock.calls.map((call) => call[0])).toEqual(targets.map((target) => target.id));
    expect(targets.every((target) => target.soul === `Soul of ${target.name}`)).toBe(true);
    expect(card().answered).toBe("allow");
  });

  it("refuses the rest of a batch that crashed midway, recording only what was really saved", async () => {
    const { bot, peers, propose, card, approve, store, service } = chief();
    const targets = peers.slice(0, 3);
    let requestId = "";
    for (const target of targets) requestId = propose(target, `Soul of ${target.name}`).requestId;
    const writes = vi.spyOn(store, "patchBotProfile");
    const save = store.patchMessage.bind(store);
    let saves = 0;
    const crash = vi.spyOn(store, "patchMessage").mockImplementation((threadId, messageId, patch) => {
      if (++saves === 2) throw new Error("disk full");
      return save(threadId, messageId, patch);
    });
    const crashed = approve(requestId, reviewedProfileKey(card().profileRequest!));
    crash.mockRestore();
    expect(crashed).toMatchObject({ state: "applied", settlementPending: true });
    const notice = "Saved @LUMON, @FABRIKAM before this stopped. Approve to apply the remaining change, or refuse to apply nothing more; saved changes are not applied again.";
    expect(card().held).toBe(notice);
    expect(crashed).toMatchObject({ message: notice });

    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId, behavior: "deny" })).toEqual({ claimed: true, state: "denied" });
    expect(writes.mock.calls.map((call) => call[0])).toEqual([peers[0]!.id, peers[1]!.id]);
    expect(targets.map((target) => target.soul)).toEqual(["Soul of LUMON", "Soul of FABRIKAM", ""]);
    expect(card()).toMatchObject({ answered: "deny" });
    expect(card().held).toBeUndefined();
    expect(profileItems(card().profileRequest!).map((item) => item.outcome?.state)).toEqual(["applied", "applied", undefined]);
    expect(approve(requestId)).toEqual({ claimed: true, state: "already_settled", behavior: "deny" });
    await flushProfileHistory(peers[2]!.id);
    expect(readHistory(peers[2]!.id)).toEqual([]);
  });

  it("opens a new card for a proposal that comes after the approval of the turn's card started", () => {
    const { bot, peers, propose, card, approve, store } = chief();
    const first = propose(peers[0]!, "One.");
    propose(peers[1]!, "Two.");
    const save = store.patchMessage.bind(store);
    let saves = 0;
    const crash = vi.spyOn(store, "patchMessage").mockImplementation((threadId, messageId, patch) => {
      if (++saves === 1) throw new Error("disk full");
      return save(threadId, messageId, patch);
    });
    expect(approve(first.requestId, reviewedProfileKey(card().profileRequest!))).toMatchObject({ state: "applied", settlementPending: true });
    crash.mockRestore();
    expect(card().answered).toBeUndefined();

    const late = propose(peers[2]!, "Three.");
    expect(late).toMatchObject({ state: "pending", batch: { joined: false, count: 1 } });
    expect(store.messagesFor(bot.threadId)).toHaveLength(2);
    expect(profileItems(card().profileRequest!).map((item) => item.targetBotId)).toEqual([peers[0]!.id, peers[1]!.id]);
    expect(approve(first.requestId)).toMatchObject({ state: "applied" });
    expect(peers.slice(0, 3).map((peer) => peer.soul)).toEqual(["One.", "Two.", ""]);
  });

  it("still applies a title, and a soul identical to the current one, at once with Undo", () => {
    const { bot, peers, service, card, store } = chief();
    store.patchBot(peers[0]!.id, { soul: "Same." });
    const titled = service.submit({ botId: bot.id, threadId: bot.threadId, targetBotId: peers[0]!.id, changes: { title: "Lead", soul: "Same." }, reason: "r", turn: TURN });
    expect(titled).toMatchObject({ state: "applied", appliedBy: "full-access" });
    expect(peers[0]!.title).toBe("Lead");
    expect(card()).toMatchObject({ autoApplied: true, answered: "allow", profileRequest: { undo: { appliedRevision: expect.any(String) } } });
    expect(service.undo({ botId: bot.id, threadId: bot.threadId, requestId: titled.requestId })).toMatchObject({ state: "undone" });
    expect(peers[0]!.title).toBe("");
  });

  it("still resolves and undoes cards written before cards held a list", () => {
    const { bot, peers, store, service } = chief();
    const v1 = (requestId: string, target: BotRecord, changes: { title: string }): ProfileRequestV1 => ({
      version: 1, requestId, botId: bot.id, threadId: bot.threadId, targetBotId: target.id, targetName: target.name,
      createdAt: 1, reason: "r", changes, before: { title: "" }, expectedRevision: profileRevision(target),
    });
    store.appendMessage(bot.threadId, { role: "bot", kind: "options", card: {
      title: "Update?", subtitle: "", options: ["Confirm", "Cancel"], requestId: "old-pending", tool: "update_profile",
      profileRequest: v1("old-pending", peers[0]!, { title: "Approved later" }),
    } });
    expect(service.resolve({ botId: bot.id, threadId: bot.threadId, requestId: "old-pending", behavior: "allow" }))
      .toMatchObject({ state: "applied", applied: [{ targetBotId: peers[0]!.id, fields: ["title"] }] });
    expect(peers[0]!.title).toBe("Approved later");

    const applied = v1("old-applied", peers[1]!, { title: "Applied alone" });
    store.patchBot(peers[1]!.id, { title: "Applied alone", lastProfileRequestId: "old-applied" });
    store.appendMessage(bot.threadId, { role: "bot", kind: "options", card: {
      title: "Update?", subtitle: "", options: [], dismissed: true, answered: "allow", autoApplied: true,
      requestId: "old-applied", tool: "update_profile",
      profileRequest: { ...applied, appliedAt: 1, undo: { appliedRevision: profileRevision(peers[1]!) } },
    } });
    expect(service.undo({ botId: bot.id, threadId: bot.threadId, requestId: "old-applied" })).toMatchObject({ state: "undone" });
    expect(peers[1]!.title).toBe("");
  });
});
