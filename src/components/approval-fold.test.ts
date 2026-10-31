// @vitest-environment happy-dom
// Gerente De Operacao's conversation in simple mode: the changes he applied and the permissions already decided each read as one quiet line.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setAdvancedMode } = await import("@/lib/interface-mode");
const { t, setLocale } = await import("@/lib/i18n");

const at = new Date(2026, 9, 17, 9, 0).getTime();
const model = { instanceId: "test", model: "m" };

const bot = (id: string, name: string, messages: Message[]): Bot => ({
  id, threadId: `${id}-main`, name, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages, modelSelection: model,
  tasks: [{ threadId: `${id}-main`, title: "Principal", createdAt: 1, busy: false, activity: "idle", modelSelection: model, approvalMode: "ask" }],
  activeLeafId: messages.at(-1)?.id,
});

const chain = (rows: Omit<Message, "parentId">[]): Message[] => rows.map((row, i) => ({ ...row, parentId: i === 0 ? undefined : rows[i - 1]!.id }));
const ask: Omit<Message, "parentId"> = { id: "ask", at, role: "user", kind: "text", text: "Ajusta o seu perfil" };

const profileChange = (n: number): Omit<Message, "parentId"> => ({
  id: `profile${n}`, at, role: "bot", kind: "options",
  card: {
    title: "Profile", subtitle: "", options: ["Allow", "Deny"], requestId: `profile-${n}`, tool: "update_profile",
    answered: "allow", autoApplied: true, answeredBy: { kind: "loopback" },
    profileRequest: {
      version: 1, requestId: `profile-${n}`, botId: "gerentedeoperacao", threadId: "gerentedeoperacao-main", targetBotId: "gerentedeoperacao", targetName: "Gerente De Operacao",
      createdAt: at, reason: "", changes: { soul: `v${n}` }, before: { soul: "v0" }, expectedRevision: "r", undo: { appliedRevision: `a${n}` },
    },
  },
});

const permission = (id: string, answered?: "allow" | "deny"): Omit<Message, "parentId"> => ({
  id, at, role: "bot", kind: "options",
  card: { title: "Approval needed", subtitle: `ls ${id}`, options: ["Allow", "Deny"], requestId: `req-${id}`, tool: "Bash", intent: `ver a pasta ${id}`, ...(answered ? { answered } : {}) },
});

function mount(messages: Message[]) {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const gerentedeoperacao = bot("gerentedeoperacao", "Gerente De Operacao", messages);
  const state: AppState = {
    ...initialState, connected: true, selectedId: gerentedeoperacao.id, bots: [gerentedeoperacao],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
    config: { features: { showToolCalls: false }, rooms: { turnTimeoutMinutes: 30 } } as unknown as AppState["config"],
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(ChatView, { bot: gerentedeoperacao }) })));
  return { container, unmount: () => { root.unmount(); container.remove(); } };
}

const toggle = (container: HTMLElement, kind: string) => container.querySelector<HTMLButtonElement>(`[data-approval-group="${kind}"] button`)!;
const undoButtons = (container: HTMLElement) => [...container.querySelectorAll("button")].filter((button) => button.textContent === t("approval.applied.undo"));

afterEach(() => {
  vi.unstubAllGlobals();
  setAdvancedMode(false);
  setLocale("pt-br");
});

describe("changes a bot applied on its own", () => {
  const threeChanges = chain([ask, profileChange(1), profileChange(2), profileChange(3)]);

  it("read as one line that opens onto each change with its Undo", () => {
    setLocale("pt-br");
    const mounted = mount(threeChanges);
    try {
      const group = mounted.container.querySelector("[data-approval-group=applied]");
      expect(group!.textContent).toContain("Gerente De Operacao fez 3 mudanças");
      expect(mounted.container.querySelectorAll("[data-applied-change]")).toHaveLength(0);
      expect(undoButtons(mounted.container)).toHaveLength(0);
      flushSync(() => toggle(mounted.container, "applied").click());
      expect(mounted.container.querySelectorAll("[data-applied-change]")).toHaveLength(3);
      expect(undoButtons(mounted.container)).toHaveLength(3);
    } finally {
      mounted.unmount();
    }
  });

  it("stay as today when there is only one", () => {
    setLocale("pt-br");
    const mounted = mount(chain([ask, profileChange(1)]));
    try {
      expect(mounted.container.querySelector("[data-approval-group]")).toBeNull();
      expect(mounted.container.querySelectorAll("[data-applied-change]")).toHaveLength(1);
      expect(undoButtons(mounted.container)).toHaveLength(1);
    } finally {
      mounted.unmount();
    }
  });

  it("stay one line each in advanced mode", () => {
    setLocale("pt-br");
    setAdvancedMode(true);
    const mounted = mount(threeChanges);
    try {
      expect(mounted.container.querySelector("[data-approval-group]")).toBeNull();
      expect(mounted.container.querySelectorAll("[data-applied-change]")).toHaveLength(3);
    } finally {
      mounted.unmount();
    }
  });

  it("start over after the person writes", () => {
    setLocale("pt-br");
    const again: Omit<Message, "parentId"> = { ...ask, id: "again", text: "De novo" };
    const mounted = mount(chain([ask, profileChange(1), profileChange(2), again, profileChange(3)]));
    try {
      expect(mounted.container.querySelectorAll("[data-approval-group=applied]")).toHaveLength(1);
      expect(mounted.container.querySelectorAll("[data-applied-change]")).toHaveLength(1);
    } finally {
      mounted.unmount();
    }
  });
});

describe("permissions the person already decided", () => {
  it("read as one line that counts them and says one was denied, with a waiting card left whole", () => {
    setLocale("pt-br");
    const mounted = mount(chain([ask, permission("a", "allow"), permission("b", "deny"), permission("wait"), permission("c", "allow")]));
    try {
      expect(mounted.container.querySelectorAll('[data-approval-row="settled"]')).toHaveLength(0);
      expect(toggle(mounted.container, "settled").textContent).toBe(t("approval.group.permissionsOneDenied", { count: 3 }));
      const pending = mounted.container.querySelector('[data-approval-row="pending"]')!;
      expect([...pending.querySelectorAll("button")].map((button) => button.textContent)).toEqual(expect.arrayContaining([t("approval.action.allowOnce"), t("approval.action.deny")]));
      flushSync(() => toggle(mounted.container, "settled").click());
      expect(mounted.container.querySelectorAll('[data-approval-row="settled"]')).toHaveLength(3);
      expect(mounted.container.querySelectorAll('[data-approval-row="pending"]')).toHaveLength(1);
    } finally {
      mounted.unmount();
    }
  });

  it("count without a denial note when all were allowed, and a single record is untouched", () => {
    setLocale("pt-br");
    const several = mount(chain([ask, permission("a", "allow"), permission("b", "allow")]));
    try {
      expect(toggle(several.container, "settled").textContent).toBe(t("approval.group.permissions", { count: 2 }));
    } finally {
      several.unmount();
    }
    const one = mount(chain([ask, permission("a", "deny")]));
    try {
      expect(one.container.querySelector("[data-approval-group]")).toBeNull();
      expect(one.container.querySelectorAll('[data-approval-row="settled"]')).toHaveLength(1);
    } finally {
      one.unmount();
    }
  });

  it("stay one record each in advanced mode", () => {
    setLocale("pt-br");
    setAdvancedMode(true);
    const mounted = mount(chain([ask, permission("a", "allow"), permission("b", "deny")]));
    try {
      expect(mounted.container.querySelector("[data-approval-group]")).toBeNull();
      expect(mounted.container.querySelectorAll('[data-approval-row="settled"]')).toHaveLength(2);
    } finally {
      mounted.unmount();
    }
  });
});
