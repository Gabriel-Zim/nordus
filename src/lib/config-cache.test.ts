import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyConfig, configOnce, resetConfigCache } from "./config-cache";

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("one config request for the whole page", () => {
  beforeEach(() => resetConfigCache());

  it("turns simultaneous callers into one fetch and keeps the answer", async () => {
    const fetchImpl = reply({ signIn: { admins: ["a@example.test"] } });
    const answers = await Promise.all([1, 2, 3, 4].map(() => configOnce(false, fetchImpl)));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Set(answers).size).toBe(1);
    await configOnce(false, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("forgets a failure so the next caller asks again", async () => {
    await expect(configOnce(false, reply({ error: "down" }, 503))).rejects.toThrow("down");
    const ok = reply({ ok: true });
    expect(await configOnce(false, ok)).toEqual({ ok: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("asks again when forced", async () => {
    const fetchImpl = reply({ n: 1 });
    await configOnce(false, fetchImpl);
    await configOnce(true, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("is replaced by the server's answer to a save", async () => {
    const fetchImpl = reply({ n: 1 });
    await configOnce(false, fetchImpl);
    applyConfig({ n: 2 } as never);
    expect(await configOnce(false, fetchImpl)).toEqual({ n: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
