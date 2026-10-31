// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import { approvalId, type ApprovalItem } from "../../shared/approvals";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  dispatch: vi.fn(),
  items: [] as unknown[],
  session: { kind: "session", id: "s-1", label: "phone", scopes: ["client"], expiresAt: 0, email: "marina@example.test", name: "Marina" } as Record<string, unknown>,
}));
vi.mock("@/state/api", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/api")>(), api: fixture.api }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: {}, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/approvals-feed", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/approvals-feed")>(),
  useApprovalsFeed: () => ({ items: fixture.items, loaded: true, failed: false }),
}));
vi.mock("@/lib/session", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/session")>(), sessionOnce: async () => fixture.session }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));

const { ApprovalCard } = await import("./ApprovalCard");
const { PendingApprovalActions, pendingApprovals } = await import("./PendingApproval");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;
const THREAD = "thread-1";
const bot = { id: "atlas", name: "Atlas" } as Bot;
let host: HTMLDivElement;
let root: Root;

const permission = (extra: Partial<NonNullable<Message["card"]>> = {}): Message => ({
  id: "m1", role: "bot", kind: "options", at: Date.now(),
  card: { title: "Approval needed", subtitle: "pnpm build", options: ["Allow", "Deny"], requestId: "req-1", tool: "Bash", intent: "montar o site", ...extra },
});
const itemOf = (extra: Partial<ApprovalItem> = {}): ApprovalItem => ({
  id: approvalId(THREAD, "m1"), kind: "permission", botId: "atlas", botName: "Atlas", threadId: THREAD, messageId: "m1", requestId: "req-1",
  title: "Atlas quer montar o site", summary: "", risk: "normal", requestedAt: Date.now(), expiresAt: Date.now() + 24 * HOUR,
  fields: [{ code: "action", label: "Ação", value: "Montar o site" }, { code: "decider", label: "Quem decide", value: "Administradores" }],
  decider: "Administradores", canDecide: true, action: "decide", ...extra,
});

async function render(message: Message) {
  await act(async () => root.render(createElement(ApprovalCard, { message, bot, threadId: THREAD })));
  await act(async () => {});
}
const text = () => host.textContent ?? "";
const button = (label: string) => Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
const click = (element: Element | undefined) => act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); });
const declines = () => fixture.api.mock.calls.filter(([path]) => String(path).endsWith("/decline"));
const decided = () => fixture.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === "decideRequest");
const type = (field: HTMLTextAreaElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = (form: Element) => act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  fixture.api.mockResolvedValue({ ok: true });
  fixture.dispatch.mockReset();
  fixture.items = [];
  fixture.session = { kind: "session", id: "s-1", label: "phone", scopes: ["client"], expiresAt: 0, email: "marina@example.test", name: "Marina" };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a permission waiting in the conversation", () => {
  it("says it waits for you and when it runs out, with what is decided and who decides", async () => {
    fixture.items = [itemOf()];
    await render(permission({ approval: { expiresAt: Date.now() + 24 * HOUR } }));
    expect(host.querySelector("[data-approval-pill]")?.textContent).toBe("Waiting for you · expires in 24 h");
    const facts = host.querySelector("[data-approval-facts]")!;
    expect(facts.textContent).toContain("Action");
    expect(facts.textContent).toContain("Montar o site");
    expect(facts.textContent).toContain("Who decides");
    expect(facts.textContent).toContain("Administrators");
    expect(text()).toContain("You are Marina here");
  });

  it("counts down in minutes in the last hour", async () => {
    await render(permission({ approval: { expiresAt: Date.now() + 25 * 60_000 } }));
    expect(host.querySelector("[data-approval-pill]")?.textContent).toMatch(/^Waiting for you · expires in (24|25) min$/);
  });

  it("names who answers when it is not this person, and does not tell them who they are", async () => {
    fixture.items = [itemOf({ canDecide: false, decider: "Rafael" })];
    await render(permission());
    expect(host.querySelector("[data-approval-pill]")?.textContent).toContain("Waiting for Rafael");
    expect(text()).not.toContain("You are");
  });

  it("stays one click for a normal action", async () => {
    await render(permission());
    expect(host.querySelector("[data-hold-to-approve]")).toBeNull();
    await click(button("Allow once"));
    expect(decided()).toEqual([expect.objectContaining({ threadId: THREAD, requestId: "req-1", behavior: "allow" })]);
  });

  it("must be held for a critical one, and offers no one-click approval", async () => {
    fixture.items = [itemOf({ risk: "critical" })];
    await render(permission({ heldCode: "approval.held.sensitive", subtitle: "git push origin main" }));
    expect(host.querySelector("[data-hold-to-approve]")?.textContent).toContain("Hold to approve");
    expect(button("Allow once")).toBeUndefined();
    await click(host.querySelector("[data-hold-to-approve]")!);
    expect(decided()).toEqual([]);
  });

  it("leaves no way around the hold: allowing the whole task is offered on a normal card only", async () => {
    await render(permission({ canReleaseTask: true }));
    expect(button("Allow everything in this task")).toBeDefined();
    expect(host.querySelector("[data-hold-to-approve]")).toBeNull();
    for (const critical of [
      permission({ canReleaseTask: true, heldCode: "approval.held.sensitive", subtitle: "git push origin main" }),
      permission({ canReleaseTask: true, heldCode: "approval.held.outbound" }),
      permission({ canReleaseTask: true, subtitle: "git push origin main" }),
    ]) {
      await render(critical);
      expect(host.querySelector("[data-hold-to-approve]")).not.toBeNull();
      expect(button("Allow everything in this task")).toBeUndefined();
      expect(button("Allow once")).toBeUndefined();
      await click(host.querySelector("[data-hold-to-approve]")!);
      expect(decided()).toEqual([]);
    }
  });

  it("says a refusal's lesson came from the refusal", async () => {
    await render(permission({ approval: { fromRefusal: true } }));
    expect(text()).toContain("This lesson came from your refusal.");
  });
});

describe("declining from the conversation", () => {
  it("asks why before it declines, and declines plainly when nothing is typed", async () => {
    await render(permission());
    await click(button("Deny"));
    expect(decided()).toEqual([]);
    const form = host.querySelector("[data-approval-decline]")!;
    expect(form.textContent).toContain("Why? (optional)");
    expect(button("Allow once")).toBeUndefined();
    await submit(form);
    expect(decided()).toEqual([expect.objectContaining({ threadId: THREAD, requestId: "req-1", behavior: "deny" })]);
    expect(declines()).toEqual([]);
    expect(host.querySelector("[data-approval-decline]")).toBeNull();
  });

  it("sends the person's words with the decline, through the approvals route", async () => {
    await render(permission());
    await click(button("Deny"));
    await type(host.querySelector("textarea")!, "  not on Fridays ");
    await submit(host.querySelector("[data-approval-decline]")!);
    expect(declines()).toEqual([[`/api/approvals/${approvalId(THREAD, "m1")}/decline`, { method: "POST", body: JSON.stringify({ reason: "not on Fridays" }) }]]);
    expect(decided()).toEqual([]);
  });

  it("goes back to the buttons when the person changes their mind", async () => {
    await render(permission());
    await click(button("Deny"));
    await click(button("Cancel"));
    expect(host.querySelector("[data-approval-decline]")).toBeNull();
    expect(button("Allow once")).toBeDefined();
    expect(decided()).toEqual([]);
  });

  it("shows the server's refusal when the decline does not go through", async () => {
    fixture.api.mockRejectedValue(new Error("Quem decide aqui é Rafael."));
    await render(permission());
    await click(button("Deny"));
    await type(host.querySelector("textarea")!, "no");
    await submit(host.querySelector("[data-approval-decline]")!);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "error", message: "Quem decide aqui é Rafael." });
  });
});

describe("a proposal is answered as before", () => {
  const lesson = permission({ tool: "propose_lesson", lessonRequest: { lesson: "Pergunte antes de apagar" } as never, options: ["Make it a rule", "Discard"] });

  it("denies at once, with no question, when the card is a lesson, a routine or a profile change", () => {
    const pending = pendingApprovals([lesson])[0]!;
    const onAskWhy = vi.fn();
    const tree = PendingApprovalActions({ pending, bot, threadId: THREAD, part: "primary", onAskWhy });
    const buttons = (tree!.props as { children: Array<{ type: string; key: string; props: { onClick: () => void } }> }).children.filter((node) => node?.type === "button");
    buttons.find((node) => node.key === "deny")!.props.onClick();
    expect(onAskWhy).not.toHaveBeenCalled();
    expect(decided()).toEqual([expect.objectContaining({ behavior: "deny" })]);
  });

  it("asks first when it is a plain permission and the caller can take the reason", () => {
    const pending = pendingApprovals([permission()])[0]!;
    const onAskWhy = vi.fn();
    const tree = PendingApprovalActions({ pending, bot, threadId: THREAD, part: "primary", onAskWhy });
    const buttons = (tree!.props as { children: Array<{ type: string; key: string; props: { onClick: () => void } }> }).children.filter((node) => node?.type === "button");
    buttons.find((node) => node.key === "deny")!.props.onClick();
    expect(onAskWhy).toHaveBeenCalledTimes(1);
    expect(decided()).toEqual([]);
  });
});

describe("what the conversation keeps once it is decided", () => {
  const settled = (answered: "allow" | "deny", extra: Partial<NonNullable<Message["card"]>> = {}) =>
    permission({ answered, answeredBy: { kind: "loopback" }, ...extra });

  it("keeps the familiar words when the person decided", async () => {
    await render(settled("allow"));
    expect(text()).toContain("You allowed");
    await render(settled("deny"));
    expect(text()).toContain("You denied");
    await render(settled("allow", { answeredBy: { kind: "session", name: "marina@example.test" } }));
    expect(text()).toContain("You allowed");
  });

  it("names the other person who decided", async () => {
    await render(settled("allow", { answeredBy: { kind: "session", name: "ada@example.test" } }));
    expect(text()).toContain("Approved by ada · sent");
    await render(settled("deny", { answeredBy: { kind: "session", name: "ada@example.test" } }));
    expect(text()).toContain("Declined by ada");
  });

  it("says a refusal with a reason becomes a lesson", async () => {
    await render(settled("deny", { approval: { declinedWhy: "not on Fridays" } }));
    expect(text()).toContain("Declined by you · the reason becomes a lesson");
    await render(settled("deny", { answeredBy: { kind: "session", name: "ada@example.test" }, approval: { declinedWhy: "not on Fridays" } }));
    expect(text()).toContain("Declined by ada · the reason becomes a lesson");
  });

  it("says plainly that a request ran out and was declined by itself", async () => {
    await render(settled("deny", { approval: { lapsed: true } }));
    expect(text()).toContain("Expired · declined automatically");
    expect(text()).not.toContain("You denied");
  });

  it("leaves no line for a request that ran out when nobody was waiting for the answer", async () => {
    await render(permission({ expired: true, approval: { lapsed: true } }));
    expect(text()).toBe("");
  });
});
