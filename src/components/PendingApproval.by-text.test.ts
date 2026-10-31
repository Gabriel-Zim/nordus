import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { pendingApprovals } from "./PendingApproval";

const approval = (card: Partial<NonNullable<Message["card"]>> = {}): Message => ({
  id: "a", role: "bot", kind: "options", at: 1,
  card: { title: "Approval needed", subtitle: "git push", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash", ...card },
});

describe("pendingApprovals", () => {
  it("leaves out a card asked in words, which the person answers by typing in the conversation", () => {
    expect(pendingApprovals([approval()])).toHaveLength(1);
    expect(pendingApprovals([approval({ byText: true })])).toEqual([]);
  });
});
