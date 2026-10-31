import { describe, expect, it, vi } from "vitest";

import { APPROVAL_CHANGE_REFUSALS, checkApprovalChange } from "./approval-change-guard.ts";

const sonnet = { instanceId: "claude", model: "sonnet" };

describe("checkApprovalChange", () => {
  it("allows a change with nothing pending", () => {
    expect(checkApprovalChange({ bot: { modelSelection: sonnet }, current: "ask", next: "auto", supports: () => true }))
      .toEqual({ ok: true });
  });

  it("refuses while a two-phase approval grant is still in flight", () => {
    const result = checkApprovalChange({
      bot: { approvalGrant: { requestId: "grant-1", mode: "full", phase: "prepared" } },
      current: "ask",
      next: "auto",
    });
    expect(result).toMatchObject({ ok: false, code: "grant_pending", status: 409, error: APPROVAL_CHANGE_REFUSALS.grantPending });
  });

  it("ignores a stale grant when no approval field was requested", () => {
    expect(checkApprovalChange({
      bot: { approvalGrant: { requestId: "grant-1", mode: "full", phase: "prepared" } },
      current: "auto",
      next: "auto",
      requested: false,
    })).toEqual({ ok: true });
  });

  it("refuses while the bot is busy and the level changes", () => {
    expect(checkApprovalChange({ bot: {}, current: "ask", next: "edits", busy: true }))
      .toMatchObject({ ok: false, code: "busy", status: 409, error: APPROVAL_CHANGE_REFUSALS.busy });
  });

  it("lets a busy bot keep the level it already has", () => {
    expect(checkApprovalChange({ bot: {}, current: "auto", next: "auto", busy: true })).toEqual({ ok: true });
  });

  it("refuses a whole-team change while any conversation is busy", () => {
    expect(checkApprovalChange({ bot: {}, current: "auto", next: "auto", allThreads: true, busy: true }))
      .toMatchObject({ ok: false, code: "busy", status: 409 });
  });

  it("keeps moving into or out of Custom to the packaged desktop", () => {
    for (const [current, next] of [["ask", "custom"], ["custom", "ask"], ["custom", "auto"]] as const) {
      expect(checkApprovalChange({ bot: {}, current, next }), `${current} → ${next}`)
        .toMatchObject({ ok: false, code: "custom_needs_desktop", status: 403, error: APPROVAL_CHANGE_REFUSALS.customNeedsDesktop });
      expect(checkApprovalChange({ bot: {}, current, next, desktop: true }), `${current} → ${next} on desktop`).toEqual({ ok: true });
    }
  });

  it("refuses leaving Custom when a conversation in the team is still on it", () => {
    expect(checkApprovalChange({
      bot: { modelSelection: sonnet },
      tasks: [{ modelSelection: sonnet, approvalMode: "custom" }],
      current: "ask",
      next: "auto",
      allThreads: true,
    })).toMatchObject({ ok: false, code: "custom_needs_desktop", status: 403 });
  });

  it("refuses Full access on a hosted workspace", () => {
    expect(checkApprovalChange({
      bot: {},
      current: "ask",
      next: "full",
      hosted: true,
      hostedFullAccessRefusal: "Full access comes from the operator",
    })).toMatchObject({ ok: false, code: "hosted_full_access", status: 403, error: "Full access comes from the operator" });
  });

  it("keeps the Full access a hosted bot already had unless it covers every conversation", () => {
    expect(checkApprovalChange({ bot: {}, current: "full", next: "full", hosted: true })).toEqual({ ok: true });
    expect(checkApprovalChange({
      bot: {},
      current: "full",
      next: "full",
      hosted: true,
      allThreads: true,
      hostedFullAccessRefusal: "Full access comes from the operator",
    })).toMatchObject({ ok: false, code: "hosted_full_access", status: 403 });
  });

  it("refuses a level the target's engine does not offer", () => {
    expect(checkApprovalChange({ bot: { modelSelection: sonnet }, current: "ask", next: "edits", supports: () => false }))
      .toMatchObject({ ok: false, code: "unsupported", status: 400, error: APPROVAL_CHANGE_REFUSALS.unsupported });
  });

  it("checks every conversation's engine for a whole-team change", () => {
    const result = checkApprovalChange({
      bot: { modelSelection: sonnet },
      tasks: [{ modelSelection: sonnet }, { modelSelection: { instanceId: "codex", model: "gpt" } }],
      current: "ask",
      next: "edits",
      allThreads: true,
      supports: (selection) => selection?.instanceId === "claude",
    });
    expect(result).toMatchObject({ ok: false, code: "unsupported", status: 400 });
  });

  it("does not look at engine support when the level and the team stay the same", () => {
    const supports = vi.fn(() => false);
    expect(checkApprovalChange({ bot: {}, current: "auto", next: "auto", supports })).toEqual({ ok: true });
    expect(supports).not.toHaveBeenCalled();
  });

  it("reports the first failing rule: grant before busy", () => {
    const result = checkApprovalChange({
      bot: { approvalGrant: { requestId: "grant-1", mode: "full", phase: "prepared" } },
      current: "ask",
      next: "auto",
      busy: true,
    });
    expect(result).toMatchObject({ ok: false, code: "grant_pending" });
  });
});
