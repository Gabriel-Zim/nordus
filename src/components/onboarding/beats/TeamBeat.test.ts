import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

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
  useEffect: (effect: EffectCallback) => {
    fixture.effects.push(effect);
  },
}));
const store = vi.hoisted(() => ({ api: vi.fn() }));
const config = vi.hoisted(() => ({ once: vi.fn(), apply: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api }));
vi.mock("@/lib/config-cache", () => ({ configOnce: config.once, applyConfig: config.apply }));
import { TeamBeat } from "./TeamBeat";

type Node = ReactElement<{ children?: ReactNode; onClick?: () => unknown; onSubmit?: (event: { preventDefault: () => void }) => unknown; onChange?: (event: { target: { value: string } }) => void; id?: string }>;

function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

function render(onNext: () => void, onSkip: () => void) {
  fixture.index = 0;
  fixture.effects = [];
  let tree: ReactNode = null;
  function Capture() {
    tree = TeamBeat({ onNext, onSkip, origin: "https://team.example.test" });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, tree };
}

const link = { token: "tok12345678", createdAt: 1 };

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.effects = [];
  store.api.mockReset();
  config.once.mockReset();
  config.apply.mockReset();
  config.once.mockResolvedValue({ signIn: { admins: ["owner@example.test"], members: [] } });
  setLocale("pt-br");
});

describe("the invite step", () => {
  it("shows the emails card, the read-only link with its note, and both ways forward", () => {
    fixture.values = [{ link, requests: [] }];
    const { html } = render(vi.fn(), vi.fn());
    expect(html).toContain("Time (opcional)");
    expect(html).toContain("Convide por e-mail ou compartilhe o link.");
    expect(html).toContain("nome@empresa.com, outra@empresa.com");
    expect(html).toContain("https://team.example.test/pair?join=tok12345678");
    expect(html).toContain("readOnly");
    expect(html).toContain("Você aprova cada pessoa que pedir.");
    expect(html).toContain("Continuar");
    expect(html).toContain("Pular esta etapa");
  });

  it("creates the link only when none exists yet", async () => {
    store.api.mockResolvedValueOnce({ link: null, requests: [] }).mockResolvedValueOnce({ link });
    render(vi.fn(), vi.fn());
    await fixture.effects[0]!();
    expect(store.api.mock.calls.map(([path, init]) => [path, (init as RequestInit | undefined)?.method ?? "GET"])).toEqual([
      ["/api/people/join", "GET"],
      ["/api/people/join/link", "POST"],
    ]);

    store.api.mockReset();
    store.api.mockResolvedValueOnce({ link, requests: [] });
    render(vi.fn(), vi.fn());
    await fixture.effects[0]!();
    expect(store.api).toHaveBeenCalledOnce();
  });

  it("advances without any request when nothing was typed", async () => {
    const onNext = vi.fn();
    const { tree } = render(onNext, vi.fn());
    nodes(tree).find((node) => node.props.onSubmit)!.props.onSubmit!({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(onNext).toHaveBeenCalledOnce());
    expect(store.api).not.toHaveBeenCalled();
  });

  it("invites everything typed in one change, then advances", async () => {
    store.api.mockResolvedValue({});
    const onNext = vi.fn();
    const first = render(onNext, vi.fn());
    nodes(first.tree).find((node) => node.props.id === "team-emails")!.props.onChange!({ target: { value: "ada@example.test, bob@example.test" } });
    const { tree } = render(onNext, vi.fn());
    nodes(tree).find((node) => node.props.onSubmit)!.props.onSubmit!({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(onNext).toHaveBeenCalledOnce());

    expect(store.api).toHaveBeenCalledOnce();
    const [path, init] = store.api.mock.calls[0]!;
    expect(path).toBe("/api/config");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      signIn: { admins: ["owner@example.test"], members: ["ada@example.test", "bob@example.test"] },
    });
  });

  it("stays and names what is not an address", async () => {
    store.api.mockResolvedValue({});
    const onNext = vi.fn();
    const first = render(onNext, vi.fn());
    nodes(first.tree).find((node) => node.props.id === "team-emails")!.props.onChange!({ target: { value: "ada@example.test, nope" } });
    const second = render(onNext, vi.fn());
    nodes(second.tree).find((node) => node.props.onSubmit)!.props.onSubmit!({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(render(onNext, vi.fn()).html).toContain("Estes não parecem e-mails: nope"));
    expect(onNext).not.toHaveBeenCalled();
    expect(store.api).toHaveBeenCalledOnce();
  });

  it("skips without inviting anyone", () => {
    const onSkip = vi.fn();
    const { tree } = render(vi.fn(), onSkip);
    nodes(tree).find((node) => node.props.onClick && node.props.children === "Pular esta etapa")!.props.onClick!();
    expect(onSkip).toHaveBeenCalledOnce();
    expect(store.api).not.toHaveBeenCalled();
  });
});
