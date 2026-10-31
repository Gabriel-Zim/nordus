import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
}));
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn() }));
const team = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: store.state, dispatch: store.dispatch }) }));
vi.mock("@/lib/starter-team", async (original) => ({
  ...(await original<typeof import("@/lib/starter-team")>()),
  createStarterTeam: team.create,
}));
import { StarterTeamBuildError, StarterTeamUnavailableError } from "@/lib/starter-team";
import { StarterTeamWelcome } from "./StarterTeamWelcome";

type Node = ReactElement<{ children?: ReactNode; onClick?: () => unknown; disabled?: boolean }>;

function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

function button(tree: ReactNode, label: string): Node | undefined {
  return nodes(tree).find((node) => node.props.onClick && node.props.children === label);
}

function render(onFinish: () => void, onBusyChange?: (busy: boolean) => void) {
  fixture.index = 0;
  let tree: ReactNode = null;
  function Capture() {
    tree = StarterTeamWelcome({ onFinish, onBusyChange });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, tree };
}

const bots = [
  { id: "chief", name: "Chief" },
  { id: "scout", name: "Scout" },
  { id: "ops", name: "Ops" },
] as Bot[];
const chief = bots[0]!;

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  store.dispatch.mockReset();
  team.create.mockReset();
  store.state = { bots: [] };
  setLocale("en");
});

describe("the simple-mode welcome", () => {
  it("builds the team in one click, opens the chief, and finishes onboarding", async () => {
    team.create.mockResolvedValue({ bots, chief });
    const onFinish = vi.fn();
    const { tree } = render(onFinish);

    expect(button(tree, "Build my team")).toBeTruthy();
    await button(tree, "Build my team")!.props.onClick!();

    expect(team.create).toHaveBeenCalledOnce();
    expect(team.create).toHaveBeenCalledWith(store.api, { existing: [] });
    const added = store.dispatch.mock.calls.filter(([action]) => (action as { type: string }).type === "botAdded");
    expect(added).toHaveLength(3);
    expect(store.dispatch).toHaveBeenCalledWith({ type: "select", id: "chief" });
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("explains a missing model instead of showing the raw error, and lets the person connect an AI right there", async () => {
    team.create.mockRejectedValue(new StarterTeamUnavailableError('model instance "claude" is unavailable'));
    const onFinish = vi.fn();
    const first = render(onFinish);

    await button(first.tree, "Build my team")!.props.onClick!();
    expect(team.create).toHaveBeenCalledOnce();

    const shown = render(onFinish);
    expect(shown.html).toContain("Your team needs a model to run.");
    expect(shown.html).not.toContain("model instance");
    expect(shown.html).toContain('data-connect-ai="embedded"');
    expect(onFinish).not.toHaveBeenCalled();

    button(shown.tree, "Continue without a team")!.props.onClick!();
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("keeps the bots the server confirmed and shows what is ready after a failure", async () => {
    team.create.mockRejectedValue(new StarterTeamBuildError({
      confirmedBots: [bots[0]!],
      uncertain: true,
    }));
    const onFinish = vi.fn();
    const first = render(onFinish);

    await button(first.tree, "Build my team")!.props.onClick!();

    const shown = render(onFinish);
    expect(shown.html).toContain("Already ready: Chief");
    expect(shown.html).toContain("There may be an extra bot in your list");
    expect(shown.html).not.toContain("bot-1");
    expect(store.dispatch).toHaveBeenCalledWith({ type: "botAdded", bot: chief, preserveSelection: true });
    expect(onFinish).not.toHaveBeenCalled();
    expect(button(shown.tree, "Try again")).toBeTruthy();
  });

  it("never shows a raw technical failure", async () => {
    team.create.mockRejectedValue(new Error("POST /api/bots returned 500: unique constraint bots_name_key"));
    const onFinish = vi.fn();
    const first = render(onFinish);

    await button(first.tree, "Build my team")!.props.onClick!();

    const shown = render(onFinish);
    expect(shown.html).toContain("The team couldn&#x27;t be set up.");
    expect(shown.html).not.toContain("unique constraint");
    expect(shown.html).not.toContain("/api/bots");
  });

  it("keeps the quieter single-bot path", () => {
    const onFinish = vi.fn();
    const { tree } = render(onFinish);

    button(tree, "Create just one bot")!.props.onClick!();

    expect(onFinish).toHaveBeenCalledOnce();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "toggleNewBot", open: true });
    expect(team.create).not.toHaveBeenCalled();
  });

  it("disables every exit while the team is still being created", () => {
    team.create.mockReturnValue(new Promise(() => {}));
    const onFinish = vi.fn();
    const onBusyChange = vi.fn();
    const first = render(onFinish, onBusyChange);
    void button(first.tree, "Build my team")!.props.onClick!();

    const shown = render(onFinish, onBusyChange);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(button(shown.tree, "Building your team…")!.props.disabled).toBe(true);
    const single = button(shown.tree, "Create just one bot")!;
    const skip = button(shown.tree, "Continue without a team")!;
    expect(single.props.disabled).toBe(true);
    expect(skip.props.disabled).toBe(true);
    single.props.onClick!();
    skip.props.onClick!();
    expect(onFinish).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
