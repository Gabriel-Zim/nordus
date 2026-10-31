// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ api: vi.fn(async () => ({})) }));
vi.mock("@/state/store", () => ({ api: calls.api }));
const { answerSignIn } = await import("./sign-in");
const { BROWSER_STAGE_CLOSE_EVENT } = await import("./browser-stage");

afterEach(() => { calls.api.mockClear(); });

const ref = { botId: "b1", threadId: "t1", messageId: "m1", place: "browser" as const };

describe("answering a sign-in in the browser", () => {
  for (const [choice, path] of [["done", "done"], ["cancel", "cancel"]] as const) {
    it(`${choice} settles the request on the server (which hands the browser back and wakes the bot) and closes the stage`, async () => {
      const closed: string[] = [];
      const listen = (event: Event) => closed.push((event as CustomEvent<{ botId: string }>).detail.botId);
      window.addEventListener(BROWSER_STAGE_CLOSE_EVENT, listen);
      await answerSignIn(ref, choice);
      window.removeEventListener(BROWSER_STAGE_CLOSE_EVENT, listen);
      expect(calls.api).toHaveBeenCalledWith(`/api/bots/b1/sign-in-cards/m1/${path}`, expect.objectContaining({ method: "POST" }));
      expect(closed).toEqual(["b1"]);
    });
  }

  it("keeps the stage open when the server refuses", async () => {
    calls.api.mockRejectedValueOnce(new Error("no"));
    const closed: string[] = [];
    const listen = () => closed.push("x");
    window.addEventListener(BROWSER_STAGE_CLOSE_EVENT, listen);
    await expect(answerSignIn(ref, "done")).rejects.toThrow();
    window.removeEventListener(BROWSER_STAGE_CLOSE_EVENT, listen);
    expect(closed).toEqual([]);
  });
});
