import { describe, expect, it, vi } from "vitest";
import { createSignedOutWatch, isSignedOutError, SIGNED_OUT_CODE } from "./signed-out";
import type { SessionState } from "./session";

const refusal = (status: number, message: string, body?: Record<string, unknown>) => Object.assign(new Error(message), { status, body });

describe("a browser that lost its session", () => {
  it("is told apart from other refusals by the server's code, or by the old servers' words", () => {
    expect(isSignedOutError(refusal(403, "anything", { code: SIGNED_OUT_CODE }))).toBe(true);
    expect(isSignedOutError(refusal(403, "forbidden: this request came through a proxy (pair this device to use the server remotely)"))).toBe(true);
    expect(isSignedOutError(refusal(401, "unauthorized: this session has expired or was revoked; pair this device again"))).toBe(true);
    expect(isSignedOutError(refusal(403, "forbidden: this session lacks the admin scope"))).toBe(false);
    expect(isSignedOutError(refusal(404, "pair this device", { code: SIGNED_OUT_CODE }))).toBe(false);
    expect(isSignedOutError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("shows the sign-in only once the server confirms there is no session", async () => {
    let state: SessionState = { kind: "session", id: "s", label: "Safari on iPhone", scopes: ["client"], expiresAt: 1 };
    const readSession = vi.fn(async () => state);
    const watch = createSignedOutWatch({ readSession });
    const seen = vi.fn();
    watch.subscribe(seen);
    const lost = refusal(403, "x", { code: SIGNED_OUT_CODE });
    expect(await watch.noteRefusal(lost)).toBe(false);
    expect(await watch.noteRefusal(refusal(500, "boom"))).toBe(false);
    expect(readSession).toHaveBeenCalledTimes(1);
    state = { kind: "unreachable", error: "offline" };
    expect(await watch.noteRefusal(lost)).toBe(false);
    state = { kind: "unauthenticated", error: "forbidden" };
    expect(await watch.noteRefusal(lost)).toBe(true);
    expect(watch.signedOut()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("checks a failing live stream at most every few seconds", async () => {
    let clock = 0;
    const readSession = vi.fn(async (): Promise<SessionState> => ({ kind: "unreachable", error: "offline" }));
    const watch = createSignedOutWatch({ readSession, now: () => clock });
    await Promise.all([watch.suspect(), watch.suspect()]);
    await watch.suspect();
    expect(readSession).toHaveBeenCalledTimes(1);
    clock += 15_000;
    await watch.suspect();
    expect(readSession).toHaveBeenCalledTimes(2);
  });
});
