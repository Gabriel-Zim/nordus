import { describe, expect, it, vi } from "vitest";
import { accessSignInExpired } from "./access-session";

const answer = (fields: Partial<Response>) => vi.fn(async () => fields as Response) as unknown as typeof fetch;

describe("accessSignInExpired", () => {
  it("a redirect instead of Nordus's answer means the sign-in in front of it expired", async () => {
    expect(await accessSignInExpired(answer({ type: "opaqueredirect", status: 0 }))).toBe(true);
    expect(await accessSignInExpired(answer({ type: "basic", status: 302 }))).toBe(true);
  });

  it("Nordus answering, or no network at all, is not an expired sign-in", async () => {
    expect(await accessSignInExpired(answer({ type: "basic", status: 200 }))).toBe(false);
    expect(await accessSignInExpired(answer({ type: "basic", status: 401 }))).toBe(false);
    expect(await accessSignInExpired(vi.fn(async () => { throw new TypeError("Load failed"); }) as unknown as typeof fetch)).toBe(false);
  });

  it("asks without following the redirect, so the browser never leaves for the sign-in page", async () => {
    const request = answer({ type: "basic", status: 200 });
    await accessSignInExpired(request);
    expect(request).toHaveBeenCalledWith("/api/health", expect.objectContaining({ redirect: "manual" }));
  });
});
