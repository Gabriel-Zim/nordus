import { describe, expect, it } from "vitest";
import type { Message } from "./store.ts";
import { turnDoneCount } from "./turn-done.ts";

let id = 0;
const row = (fields: Partial<Message>): Message => ({ id: `m${(id += 1)}`, at: id, role: "bot", kind: "activity", ...fields } as Message);
const call = (turnId: string, ok = true) => row({ turnId, tool: { name: "send_email", ok, itemId: `i${id}` } });

describe("turnDoneCount", () => {
  it("counts every tool call the turn started, a running or failed one included, not other turns' ones", () => {
    const running = row({ turnId: "t2", tool: { name: "Bash", itemId: "held" } });
    const rows = [call("t1"), call("t2"), call("t2", false), call("t2"), row({ turnId: "t2", tool: { name: "notice: retrying", ok: true } }), running];
    expect(turnDoneCount(rows, "t2")).toBe(4);
    expect(turnDoneCount([call("t3"), row({ turnId: "t4", tool: { name: "Bash", itemId: "held" } })], "t4")).toBe(1);
  });

  it("without a turn id counts only what came after the person's last message", () => {
    const rows = [call("t1"), row({ role: "user", kind: "text", text: "de novo" }), call("t2"), call("t2")];
    expect(turnDoneCount(rows)).toBe(2);
    expect(turnDoneCount([...rows, row({ role: "user", kind: "text", text: "e agora?" })])).toBe(0);
  });
});
