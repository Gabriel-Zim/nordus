import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASK_RELEASE_IDLE_MS, TaskReleaseStore, releasableCard, releaseEnded, releaseTaskFromCard, type ReleaseFromCardDeps, type ReleasedTask } from "./task-release.ts";
import type { CardAnswerer, OptionCardData } from "../shared/wire.ts";

const HOUR = 60 * 60_000;
const NOW = 1_800_000_000_000;
const AVERY: CardAnswerer = { kind: "session", name: "Avery" };
type TaskRow = ReleasedTask & { updatedAt?: number };
const OWNER: CardAnswerer = { kind: "loopback" };

describe("releaseEnded", () => {
  const release = { at: NOW, usedAt: NOW };
  it("ends with the task: gone, archived or closed by its bot", () => {
    expect(releaseEnded(release, undefined, NOW)).toBe(true);
    expect(releaseEnded(release, { archivedAt: NOW }, NOW)).toBe(true);
    expect(releaseEnded(release, { closedBy: { botId: "a", name: "A", at: NOW } }, NOW)).toBe(true);
    expect(releaseEnded(release, {}, NOW)).toBe(false);
  });

  it("ends after four idle hours, counted from the release or its last activity, never from the task's own clock", () => {
    expect(releaseEnded(release, {}, NOW + TASK_RELEASE_IDLE_MS)).toBe(false);
    expect(releaseEnded(release, {}, NOW + TASK_RELEASE_IDLE_MS + 1)).toBe(true);
    expect(releaseEnded({ at: NOW, usedAt: NOW + 3 * HOUR }, {}, NOW + 6 * HOUR)).toBe(false);
    const task: TaskRow = { updatedAt: NOW + 5 * HOUR };
    expect(releaseEnded(release, task, NOW + 6 * HOUR)).toBe(true);
  });
});

describe("TaskReleaseStore", () => {
  let directory: string;
  let filename: string;
  let tasks: Map<string, TaskRow>;
  const lookup = (botId: string, threadId: string) => tasks.get(`${botId}:${threadId}`);
  const open = () => new TaskReleaseStore(filename, lookup);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "nordus-task-releases-"));
    filename = join(directory, "task-releases.json");
    tasks = new Map([["bot-a:t1", {}], ["bot-a:t2", {}], ["bot-b:t3", {}]]);
  });
  afterEach(() => {
    chmodSync(directory, 0o700);
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("grants one task of one bot, survives a restart, and answers for no other task or bot", () => {
    const store = open();
    expect(store.active("bot-a", "t1", NOW)).toBeUndefined();
    const granted = store.grant("bot-a", "t1", AVERY, NOW);
    expect(granted).toEqual({ botId: "bot-a", threadId: "t1", at: NOW, usedAt: NOW, by: "Avery", answerer: AVERY });
    expect(store.active("bot-a", "t1", NOW + HOUR)).toEqual(granted);
    expect(store.active("bot-a", "t2", NOW)).toBeUndefined();
    expect(store.active("bot-b", "t1", NOW)).toBeUndefined();
    expect(store.forThread("t1", NOW)).toEqual(granted);
    expect(open().active("bot-a", "t1", NOW + HOUR)).toEqual(granted);
    expect(open().grant("bot-a", "t2", OWNER, NOW)).toMatchObject({ by: "owner", answerer: OWNER });
    if (process.platform !== "win32") expect(statSync(filename).mode & 0o777).toBe(0o600);
  });

  it("keeps a release alive through activity, writing the disk copy once a minute, and drops it once the task ends or is revoked", () => {
    const store = open();
    store.grant("bot-a", "t1", AVERY, NOW);
    store.touch("t1", NOW + 30_000);
    expect(open().active("bot-a", "t1", NOW + HOUR)?.usedAt).toBe(NOW);
    store.touch("t1", NOW + 3 * HOUR);
    expect(open().active("bot-a", "t1", NOW + 6 * HOUR)?.usedAt).toBe(NOW + 3 * HOUR);
    expect(store.active("bot-a", "t1", NOW + 8 * HOUR)).toBeUndefined();
    store.grant("bot-a", "t1", AVERY, NOW + 8 * HOUR);
    tasks.set("bot-a:t1", { closedBy: { botId: "bot-a", name: "A", at: NOW } });
    expect(store.active("bot-a", "t1", NOW + 9 * HOUR)).toBeUndefined();
    store.grant("bot-a", "t2", AVERY, NOW);
    expect(store.revoke("bot-b", "t2")).toBe(false);
    expect(store.revoke("bot-a", "t2")).toBe(true);
    expect(open().active("bot-a", "t2", NOW + HOUR)).toBeUndefined();
    store.grant("bot-a", "t2", AVERY, NOW);
    store.dropThread("t2");
    expect(open().forThread("t2", NOW)).toBeUndefined();
  });

  it("ends for good: a message after four idle hours does not revive it, and neither does unarchiving the task", () => {
    const store = open();
    store.grant("bot-a", "t1", AVERY, NOW);
    tasks.set("bot-a:t1", { updatedAt: NOW + TASK_RELEASE_IDLE_MS + 1 });
    store.touch("t1", NOW + TASK_RELEASE_IDLE_MS + 1);
    expect(store.active("bot-a", "t1", NOW + TASK_RELEASE_IDLE_MS + 2)).toBeUndefined();
    expect(open().active("bot-a", "t1", NOW)).toBeUndefined();

    store.grant("bot-a", "t2", AVERY, NOW);
    tasks.set("bot-a:t2", { archivedAt: NOW + HOUR });
    expect(store.active("bot-a", "t2", NOW + HOUR)).toBeUndefined();
    tasks.set("bot-a:t2", {});
    expect(store.active("bot-a", "t2", NOW + HOUR)).toBeUndefined();
    expect(open().active("bot-a", "t2", NOW + HOUR)).toBeUndefined();
  });

  it("sweeps ended releases and reports whose bots changed", () => {
    const store = open();
    store.grant("bot-a", "t1", AVERY, NOW);
    store.grant("bot-b", "t3", AVERY, NOW + 3 * HOUR);
    tasks.delete("bot-a:t1");
    expect(store.sweep(NOW + 4 * HOUR).map((release) => release.threadId)).toEqual(["t1"]);
    expect(open().forThread("t3", NOW + 4 * HOUR)).toBeDefined();
    expect(store.sweep(NOW + 4 * HOUR)).toEqual([]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("keeps going when the disk refuses a touch or a sweep, and says so once per failure", () => {
    const store = open();
    store.grant("bot-a", "t1", AVERY, NOW);
    store.grant("bot-b", "t3", AVERY, NOW);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    chmodSync(directory, 0o500);
    expect(() => store.touch("t1", NOW + 2 * HOUR)).not.toThrow();
    expect(store.active("bot-a", "t1", NOW + 5 * HOUR)).toBeDefined();
    tasks.delete("bot-b:t3");
    expect(store.sweep(NOW + 2 * HOUR).map((release) => release.threadId)).toEqual(["t3"]);
    expect(store.forThread("t3", NOW)).toBeUndefined();
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged.mock.calls.flat().join(" ")).not.toContain("Avery");
    chmodSync(directory, 0o700);
    expect(open().active("bot-a", "t1", NOW + HOUR)?.usedAt).toBe(NOW);
  });

  it("keeps the newest 500 releases", () => {
    const store = open();
    for (let index = 0; index < 501; index += 1) {
      tasks.set(`bot-a:thread-${index}`, {});
      store.grant("bot-a", `thread-${index}`, AVERY, NOW + index);
    }
    expect(JSON.parse(readFileSync(filename, "utf8")).releases).toHaveLength(500);
    expect(store.active("bot-a", "thread-0", NOW + 501)).toBeUndefined();
    expect(store.active("bot-a", "thread-1", NOW + 501)).toBeDefined();
    expect(store.active("bot-a", "thread-500", NOW + 501)).toBeDefined();
  });

  it("loads a record saved before the answerer was kept, and fails closed on a damaged store: nothing is released and nothing overwrites it", () => {
    open().grant("bot-a", "t1", AVERY, NOW);
    const saved = readFileSync(filename, "utf8");
    writeFileSync(filename, JSON.stringify({ version: 1, releases: [{ botId: "bot-a", threadId: "t1", at: NOW, usedAt: NOW, by: "x" }] }));
    expect(open().active("bot-a", "t1", NOW)).toEqual({ botId: "bot-a", threadId: "t1", at: NOW, usedAt: NOW, by: "x" });
    for (const damaged of [
      "{ not json",
      JSON.stringify({ version: 2, releases: [] }),
      JSON.stringify({ version: 1, releases: [{ botId: "bot-a", threadId: "t1", at: NOW, usedAt: NOW, by: "x", extra: 1 }] }),
      JSON.stringify({ version: 1, releases: [{ botId: "bot-a", threadId: "t1", at: "soon", usedAt: NOW, by: "x" }] }),
      JSON.stringify({ version: 1, releases: [{ botId: "bot-a", threadId: "t1", at: NOW, usedAt: NOW, by: "" }] }),
      JSON.stringify({ version: 1, releases: [{ botId: "bot-a", threadId: "t1", at: NOW, usedAt: NOW, by: "x", answerer: { kind: "session" } }] }),
      JSON.stringify({ version: 1, releases: [{ botId: "bot-a", threadId: "t1", at: NOW, usedAt: NOW, by: "x", answerer: { kind: "loopback", name: "x" } }] }),
      JSON.stringify({ version: 1, releases: [{ botId: "bot-a", threadId: "t1", at: NOW, usedAt: NOW, by: "x", answerer: { kind: "admin" } }] }),
    ]) {
      writeFileSync(filename, damaged);
      const store = open();
      expect(store.active("bot-a", "t1", NOW)).toBeUndefined();
      expect(() => store.grant("bot-a", "t1", AVERY, NOW)).toThrow(expect.objectContaining({ status: 503 }));
      expect(store.revoke("bot-a", "t1")).toBe(false);
      expect(store.sweep(NOW + 9 * HOUR)).toEqual([]);
      expect(readFileSync(filename, "utf8")).toBe(damaged);
    }
    writeFileSync(filename, saved);
    expect(open().active("bot-a", "t1", NOW)).toBeDefined();
  });
});

describe("releaseTaskFromCard", () => {
  const card = (requestId: string, extra: Partial<OptionCardData> = {}): OptionCardData =>
    ({ title: "Approval needed", subtitle: requestId, options: ["Allow", "Deny"], requestId, requestType: "permission", tool: "Bash", canReleaseTask: true, ...extra });
  const harness = (cards: OptionCardData[], options: { blocked?: string[]; onAnswer?: (requestId: string) => Promise<void> | void } = {}) => {
    const messages = cards.map((c, index) => ({ id: `m${index}`, card: c }));
    const granted: Array<[string, string, CardAnswerer]> = [];
    const answered: Array<[string, string | undefined]> = [];
    const patches: Array<[string, Record<string, unknown>]> = [];
    const broadcast: string[] = [];
    const deps: ReleaseFromCardDeps = {
      messagesFor: () => messages,
      botByThread: () => ({ id: "bot-a" }),
      patchCard: (_thread: string, messageId: string, fields: Partial<OptionCardData>) => {
        patches.push([messageId, fields]);
        const message = messages.find((m) => m.id === messageId)!;
        message.card = { ...message.card, ...fields };
      },
      floorBlocks: (c: OptionCardData) => options.blocked?.includes(c.requestId!) ?? false,
      releases: { grant: (botId: string, threadId: string, answerer: CardAnswerer) => { granted.push([botId, threadId, answerer]); return { botId, threadId, at: 1, usedAt: 1, by: "x", answerer }; } },
      answerAllow: async (_thread: string, requestId: string, rule?: string) => {
        answered.push([requestId, rule]);
        await options.onAnswer?.(requestId);
        const message = messages.find((m) => m.card.requestId === requestId)!;
        if (!message.card.answered) message.card = { ...message.card, answered: "allow" };
        return "allowed-once" as const;
      },
      broadcastBot: (botId: string) => { broadcast.push(botId); },
    };
    return { deps, messages, granted, answered, patches, broadcast };
  };
  const release = (deps: ReleaseFromCardDeps, requestId: string) =>
    releaseTaskFromCard(deps, { threadId: "t1", requestId, answerer: AVERY });

  it("releases the task, answers the clicked card as the person's allow and the other pending provider cards as released by that person", async () => {
    const { deps, messages, granted, answered, patches, broadcast } = harness([
      card("r1"), card("r2"), card("r3", { answered: "deny" }),
      card("q1", { canReleaseTask: undefined, requestType: "question", tool: undefined }),
      card("s1", { canReleaseTask: undefined, skillRequest: {} as OptionCardData["skillRequest"] }),
    ]);
    const result = await release(deps, "r2");
    expect(result).toEqual({ status: 200, body: { ok: true, released: true, answered: 2, outcome: "allowed-once" } });
    expect(granted).toEqual([["bot-a", "t1", AVERY]]);
    expect(answered).toEqual([["r2", undefined], ["r1", "task-release"]]);
    expect(messages.map((m) => [m.card.answered, m.card.releasedTask, m.card.answeredBy])).toEqual([
      ["allow", true, AVERY], ["allow", undefined, undefined], ["deny", undefined, undefined], [undefined, undefined, undefined], [undefined, undefined, undefined],
    ]);
    expect(patches).toEqual([["m0", { releasedTask: true }], ["m0", { answeredBy: AVERY }]]);
    expect(broadcast).toEqual(["bot-a"]);
  });

  it("leaves a sibling the safety floor blocks for the person, and stamps nobody on a card the engine no longer takes", async () => {
    const { deps, messages } = harness([card("r1"), card("r2"), card("r3")], { blocked: ["r1"] });
    deps.answerAllow = async (_thread, requestId) => {
      if (requestId === "r3") return "unavailable";
      const message = messages.find((m) => m.card.requestId === requestId)!;
      message.card = { ...message.card, answered: "allow" };
      return "allowed-once";
    };
    const result = await release(deps, "r2");
    expect(result.body).toMatchObject({ answered: 2 });
    expect(messages[0]!.card).toMatchObject({ requestId: "r1", canReleaseTask: true });
    expect(messages[0]!.card.answered).toBeUndefined();
    expect(messages[0]!.card.releasedTask).toBeUndefined();
    expect(messages[2]!.card).toMatchObject({ releasedTask: true });
    expect(messages[2]!.card.answeredBy).toBeUndefined();
  });

  it("skips a sibling someone else settled while the loop ran, reading each card as it is at that moment", async () => {
    const { deps, messages, answered } = harness([card("r1"), card("r2"), card("r3")], {
      onAnswer: (requestId) => {
        if (requestId !== "r1") return;
        const other = messages.find((m) => m.card.requestId === "r3")!;
        other.card = { ...other.card, answered: "deny", answeredBy: OWNER };
      },
    });
    await release(deps, "r2");
    expect(answered.map(([requestId]) => requestId)).toEqual(["r2", "r1"]);
    expect(messages[2]!.card).toMatchObject({ answered: "deny", answeredBy: OWNER });
    expect(messages[2]!.card.releasedTask).toBeUndefined();
  });

  it("takes one release per task at a time: a second click while the first runs answers ok and grants nothing more", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const { deps, granted } = harness([card("r1"), card("r2")], { onAnswer: () => gate });
    const first = release(deps, "r1");
    const second = await release(deps, "r2");
    expect(second).toEqual({ status: 200, body: { ok: true, released: true, answered: 0 } });
    expect(granted).toHaveLength(1);
    finish();
    expect((await first).status).toBe(200);
    const { deps: later } = harness([card("r9")]);
    expect((await release(later, "r9")).status).toBe(200);
  });

  it("never releases the task from a card that waits for the person's hold, and leaves such cards alone when it releases from another", async () => {
    const { deps, granted, answered, messages } = harness([
      card("r1", { heldCode: "approval.held.sensitive" }), card("r2"), card("r3", { heldCode: "approval.held.outbound" }),
      card("r4", { tool: "Bash", subtitle: "git push origin main" }),
    ]);
    const refused = await release(deps, "r1");
    expect(refused.status).toBe(409);
    expect(granted).toEqual([]);
    expect(answered).toEqual([]);
    const released = await release(deps, "r2");
    expect(released).toEqual({ status: 200, body: { ok: true, released: true, answered: 1, outcome: "allowed-once" } });
    expect(answered).toEqual([["r2", undefined]]);
    for (const waiting of [messages[0]!, messages[2]!, messages[3]!]) {
      expect(waiting.card.answered).toBeUndefined();
      expect(waiting.card.releasedTask).toBeUndefined();
    }
  });

  it("refuses a card that is settled or cannot release its task, and grants nothing", async () => {
    for (const settled of [card("r1", { answered: "allow" }), card("r1", { dismissed: true }), card("r1", { expired: true }), card("r1", { canReleaseTask: undefined })]) {
      const { deps, granted, answered } = harness([settled]);
      expect((await release(deps, "r1")).status).toBe(409);
      expect(granted).toEqual([]);
      expect(answered).toEqual([]);
    }
    const { deps } = harness([]);
    expect((await release({ ...deps, botByThread: () => undefined }, "r1")).status).toBe(404);
  });
});

describe("releasableCard", () => {
  const base: OptionCardData = { title: "Approval needed", subtitle: "pnpm build", options: ["Allow", "Deny"], requestId: "r1", requestType: "permission", tool: "Bash", canReleaseTask: true };

  it("takes a request of the task that is still waiting", () => {
    expect(releasableCard(base)).toBe(true);
    expect(releasableCard({ ...base, heldCode: "approval.held.native" })).toBe(true);
  });

  it("does not take a critical action, which is approved by holding the button on its own card", () => {
    expect(releasableCard({ ...base, heldCode: "approval.held.sensitive" })).toBe(false);
    expect(releasableCard({ ...base, heldCode: "approval.held.outbound" })).toBe(false);
    expect(releasableCard({ ...base, heldCode: "approval.held.sandbox" })).toBe(false);
    expect(releasableCard({ ...base, subtitle: "git push origin main" })).toBe(false);
  });
});
