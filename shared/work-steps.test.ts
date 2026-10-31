import { describe, expect, it } from "vitest";

import { withRunningCommand } from "./work-steps";

describe("withRunningCommand", () => {
  const steps = [{ at: 1, tool: "Read" }, { at: 2, tool: "Bash", command: "allTests" as const }];
  const bash = { role: "bot", kind: "activity", at: 2, tool: { name: "Bash", summary: "pnpm test" } };

  it("marks the shell step with when its command began, while it runs", () => {
    expect(withRunningCommand(steps, [bash]).at(-1)).toEqual({ at: 2, tool: "Bash", command: "allTests", since: 2 });
    expect(withRunningCommand(steps, [bash, { role: "bot", kind: "activity", at: 9, tool: { name: "ok", ok: true, approved: true } }]).at(-1)?.since).toBe(9);
  });

  it("leaves the step unmarked while the command waits for a yes or after it ended", () => {
    const waiting = { role: "bot", kind: "activity", at: 3, tool: { name: "Esperando DESIGNERGRAFICO decidir", ok: true, awaitingApproval: true } };
    expect(withRunningCommand(steps, [bash, waiting])).toBe(steps);
    expect(withRunningCommand(steps, [{ ...bash, tool: { ...bash.tool, ok: true } }])).toBe(steps);
  });

  it("leaves steps alone when the last one is not a command", () => {
    const own = [{ at: 1, text: "Montando a lâmina 2" }];
    expect(withRunningCommand(own, [bash])).toBe(own);
  });
});
