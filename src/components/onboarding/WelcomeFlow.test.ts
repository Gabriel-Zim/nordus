import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { BeatId } from "@/lib/onboarding";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useEffect: (effect: EffectCallback) => {
    fixture.effects.push(effect);
  },
}));
const store = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
const mode = vi.hoisted(() => ({ advanced: false }));
const team = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/state/store", () => {
  class ApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, api: store.api, useStore: () => ({ state: { bots: [], instances: [] }, dispatch: store.dispatch }) };
});
vi.mock("@/lib/starter-team", async (original) => ({
  ...(await original<typeof import("@/lib/starter-team")>()),
  createStarterTeam: team.create,
}));
vi.mock("@/components/DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => mode.advanced }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn(), emailGateDone: () => false }));
vi.mock("@/components/Avatar", () => ({ CritterAvatar: () => null }));
vi.mock("./view-transition", () => ({ withViewTransition: (update: () => void) => update() }));
vi.mock("./beats/HelloBeat", async () => {
  const { createElement } = await import("react");
  return { HelloBeat: (props: { onNext: () => void }) => createElement("button", { "data-beat": "hello", onClick: props.onNext }) };
});
vi.mock("./beats/EnginesBeat", async () => {
  const { createElement } = await import("react");
  return { EnginesBeat: (props: { onNext: () => void }) => createElement("button", { "data-beat": "engines", onClick: props.onNext }) };
});
vi.mock("./beats/PermissionsBeat", async () => {
  const { createElement } = await import("react");
  return { PermissionsBeat: (props: { onNext: () => void }) => createElement("button", { "data-beat": "permissions", onClick: props.onNext }) };
});
vi.mock("./beats/PhoneBeat", async () => {
  const { createElement } = await import("react");
  return { PhoneBeat: (props: { onNext: () => void }) => createElement("button", { "data-beat": "phone", onClick: props.onNext }) };
});
vi.mock("./beats/MeetYourBotBeat", async () => {
  const { createElement } = await import("react");
  return { MeetYourBotBeat: (props: { onFinish: () => void }) => createElement("button", { "data-beat": "bot", onClick: props.onFinish }) };
});
vi.mock("./reel/FeatureReel", async () => {
  const { createElement } = await import("react");
  return { FeatureReel: (props: { onNext: () => void }) => createElement("button", { "data-beat": "reel", onClick: props.onNext }) };
});
vi.mock("./beats/TeamBeat", async () => {
  const { createElement } = await import("react");
  return { TeamBeat: (props: { onNext: () => void }) => createElement("button", { "data-beat": "team", onClick: props.onNext }) };
});
vi.mock("./beats/StarterTeamWelcome", async () => {
  const { createElement } = await import("react");
  return {
    StarterTeamWelcome: (props: { onBusyChange?: (busy: boolean) => void }) =>
      createElement("button", { "data-team": "", onClick: () => props.onBusyChange?.(true) }),
  };
});
import { WelcomeFlow } from "./WelcomeFlow";
import { HelloBeat } from "./beats/HelloBeat";
import { EnginesBeat } from "./beats/EnginesBeat";
import { PermissionsBeat } from "./beats/PermissionsBeat";
import { PhoneBeat } from "./beats/PhoneBeat";
import { MeetYourBotBeat } from "./beats/MeetYourBotBeat";
import { StarterTeamWelcome } from "./beats/StarterTeamWelcome";
import { TeamBeat } from "./beats/TeamBeat";

const BEAT_TYPES = new Map<unknown, string>([
  [HelloBeat, "hello"],
  [EnginesBeat, "engines"],
  [PermissionsBeat, "permissions"],
  [PhoneBeat, "phone"],
  [MeetYourBotBeat, "bot"],
  [StarterTeamWelcome, "starter"],
  [TeamBeat, "team"],
]);

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode; onClick?: () => void }>;

function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

function beat(tree: ReactNode): { id: string; advance: () => void } | null {
  const node = nodes(tree).find((candidate) => BEAT_TYPES.has(candidate.type));
  if (!node) return null;
  return {
    id: BEAT_TYPES.get(node.type)!,
    advance: (node.props.onBuilt ?? node.props.onNext ?? node.props.onFinish) as () => void,
  };
}

interface FlowOptions {
  replay?: boolean;
  initialBeat?: BeatId;
  hosted?: boolean;
  team?: boolean;
}

function render(options: FlowOptions, onDone: () => void) {
  fixture.index = 0;
  let tree: ReactNode = null;
  function Capture() {
    tree = WelcomeFlow({
      bot: null,
      onDone,
      replay: options.replay ?? false,
      initialBeat: options.initialBeat,
      hosted: options.hosted ?? false,
      team: options.team ?? false,
      dictation: false,
      reel: false,
    });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, tree };
}

function walk(options: FlowOptions) {
  const onDone = vi.fn();
  const seen: string[] = [];
  let view = render(options, onDone);
  for (let step = 0; step < 10 && !onDone.mock.calls.length; step++) {
    const current = beat(view.tree);
    if (!current) break;
    seen.push(current.id);
    current.advance();
    view = render(options, onDone);
  }
  return { seen, onDone, final: view };
}

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.effects = [];
  store.api.mockReset();
  store.api.mockResolvedValue({});
  store.dispatch.mockReset();
  team.create.mockReset();
  mode.advanced = false;
  vi.stubGlobal("window", { ogb: { remoteClient: { active: false } } });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("which welcome flow a viewer gets", () => {
  it("opens a first run in simple mode on the one-screen starter team", () => {
    const onDone = vi.fn();
    const { html, tree } = render({}, onDone);
    expect(beat(tree)?.id).toBe("starter");
    expect(html).not.toContain("Skip tour");
    expect(html).not.toContain("Step ");
  });

  it("walks every step on replay, with skip and progress available", () => {
    const first = render({ replay: true }, vi.fn());
    expect(first.html).toContain("Skip tour");
    expect(first.html).toContain("Step 1 of 4");
    const { seen, onDone } = walk({ replay: true });
    expect(seen).toEqual(["hello", "engines", "phone", "bot"]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("keeps the complete walkthrough in advanced mode", () => {
    mode.advanced = true;
    const first = render({}, vi.fn());
    expect(first.html).toContain("Step 1 of 4");
    expect(walk({}).seen).toEqual(["hello", "engines", "phone", "bot"]);
  });

  it("resumes the complete walkthrough on the requested beat", () => {
    const { seen } = walk({ initialBeat: "engines" });
    expect(seen).toEqual(["engines", "phone", "bot"]);
  });

  it("keeps the reduced flow when the greeting is the step being resumed", () => {
    const onDone = vi.fn();
    const { html, tree } = render({ initialBeat: "hello" }, onDone);
    expect(beat(tree)?.id).toBe("starter");
    expect(html).not.toContain("Step ");
  });

  it("moves from the built starter team to the invite step, then finishes", () => {
    const { seen, onDone, final } = walk({ team: true });
    expect(seen).toEqual(["starter", "team"]);
    expect(onDone).toHaveBeenCalledOnce();
    expect(final.html).toContain("Step 2 of 2");
  });

  it("finishes straight after the starter team when the invite step is not offered", () => {
    const { seen, onDone } = walk({});
    expect(seen).toEqual(["starter"]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("lets a replay reach the invite step before the bot", () => {
    expect(walk({ replay: true, team: true }).seen).toEqual(["hello", "engines", "phone", "team", "bot"]);
  });

  it("keeps the complete hosted walkthrough", () => {
    const { seen } = walk({ hosted: true });
    expect(seen).toEqual(["hello", "bot"]);
  });

  it("ignores Escape while the starter team is still being created", () => {
    const onDone = vi.fn();
    const first = render({}, onDone);
    const teamNode = nodes(first.tree).find((node) => node.type === StarterTeamWelcome)!;
    (teamNode.props.onBusyChange as (busy: boolean) => void)(true);

    const { tree } = render({}, onDone);
    const dialog = nodes(tree).find((node) => node.props.role === "dialog")!;
    const preventDefault = vi.fn();
    (dialog.props.onKeyDown as (event: unknown) => void)({ key: "Escape", preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the dialog when every button is disabled", () => {
    const onDone = vi.fn();
    const first = render({}, onDone);
    const teamNode = nodes(first.tree).find((node) => node.type === StarterTeamWelcome)!;
    (teamNode.props.onBusyChange as (busy: boolean) => void)(true);

    const cardRef = fixture.values.find(
      (value) => Boolean(value) && typeof value === "object" && "current" in (value as object) && (value as { current: unknown }).current === null,
    ) as { current: unknown };
    const focus = vi.fn();
    cardRef.current = { querySelectorAll: () => [], focus };

    const { tree } = render({}, onDone);
    const dialog = nodes(tree).find((node) => node.props.role === "dialog")!;
    const preventDefault = vi.fn();
    (dialog.props.onKeyDown as (event: unknown) => void)({ key: "Tab", shiftKey: false, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
