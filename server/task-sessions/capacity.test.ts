import { describe, expect, it } from "vitest";
import { atServerSessionCapacity, countBusySessions, diskHasRoom, MAX_SERVER_SESSIONS } from "./capacity.ts";

const GiB = 1024 ** 3;
const fakeStatfs = (bytes: number) => (() => ({ bavail: bytes / 4096, bsize: 4096 })) as never;

describe("atServerSessionCapacity", () => {
  it("bloqueia só ao atingir o teto", () => {
    expect(MAX_SERVER_SESSIONS).toBe(100);
    expect(atServerSessionCapacity(99)).toBe(false);
    expect(atServerSessionCapacity(100)).toBe(true);
  });
});

describe("countBusySessions", () => {
  it("conta tarefas ocupadas em todos os bots", () => {
    const store = {
      bots: [{ id: "a" }, { id: "b" }],
      tasks: (id: string) => (id === "a" ? [{ threadId: "1" }, { threadId: "2" }] : [{ threadId: "3" }]),
    };
    expect(countBusySessions(store, (_bot: string, thread: string) => thread !== "2")).toBe(2);
  });
});

describe("diskHasRoom", () => {
  it("respeita o piso de 20 GiB", () => {
    expect(diskHasRoom("/x", undefined, fakeStatfs(19 * GiB))).toBe(false);
    expect(diskHasRoom("/x", undefined, fakeStatfs(21 * GiB))).toBe(true);
  });
  it("não bloqueia às cegas quando statfs falha", () => {
    expect(diskHasRoom("/x", undefined, (() => { throw new Error("boom"); }) as never)).toBe(true);
  });
});
