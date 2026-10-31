import { describe, expect, it, vi } from "vitest";

import { GoalLive } from "./live.ts";
import { runGoalTool, type GoalToolDeps } from "./tool.ts";

describe("runGoalTool", () => {
  it("has the run live, with its first line on the site, before the page is opened", async () => {
    const live = new GoalLive();
    const seen: Array<{ status: string; first: string | undefined; url: string }> = [];
    const open = vi.fn(async () => {
      const run = live.list("t1")[0]!;
      seen.push({ status: run.status, first: run.steps[0]?.label, url: run.url });
      return null;
    });
    const deps = {
      relay: async () => ({ success: false, data: null, error: "no engine" }),
      frame: async () => { throw new Error("none"); },
      decider: { ask: async () => { throw new Error("none"); } },
      textModel: null, live, run: { threadId: "t1", botId: "b", botName: "Bot" }, stopped: () => false, budgetMs: 1_000, open, url: "https://www.g1.globo.com/economia",
    } as unknown as GoalToolDeps;
    await runGoalTool(deps, { goal: "ler manchetes", url: "https://www.g1.globo.com/economia" }).catch(() => undefined);
    expect(seen).toEqual([{ status: "running", first: "Abrindo g1.globo.com", url: "https://www.g1.globo.com/economia" }]);
  });

  it("ends as unavailable when the page was refused", async () => {
    const live = new GoalLive();
    const refused = { isError: true as const, content: [{ type: "text" as const, text: "Navigation refused" }] };
    const deps = { relay: vi.fn(), frame: vi.fn(), decider: { ask: vi.fn() }, textModel: null, live, run: { threadId: "t1", botId: "b", botName: "Bot" }, stopped: () => false, budgetMs: 1_000, open: async () => refused, url: "https://x.test" } as unknown as GoalToolDeps;
    await expect(runGoalTool(deps, { goal: "ler manchetes", url: "https://x.test" })).resolves.toBe(refused);
    expect(live.list("t1")[0]).toMatchObject({ status: "unavailable" });
    expect(deps.relay).not.toHaveBeenCalled();
  });
});
