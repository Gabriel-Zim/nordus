import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { BotBudget } from "@/state/bot-budget";

const fixture = vi.hoisted(() => ({
  viewer: { admin: true, guest: false } as { admin: boolean; guest: boolean; email?: string },
  people: [] as Array<{ email: string; name: string; role: string }>,
  budget: null as unknown,
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: {}, dispatch: () => {} }) }));
vi.mock("@/lib/use-viewer", () => ({ useViewer: () => fixture.viewer, useGuest: () => fixture.viewer.guest }));
vi.mock("@/state/people-directory", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/people-directory")>(),
  useDirectory: () => ({ loaded: true, people: fixture.people }),
}));
vi.mock("@/state/bot-budget", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/bot-budget")>(),
  useBotBudget: () => ({ budget: fixture.budget, save: async () => {} }),
}));
import { OwnerBudget } from "./OwnerBudget";
import { OwnerCard } from "./OwnerPicker";

const bot = (extra: Partial<Bot> = {}) => ({ id: "b1", name: "Atlas", ...extra }) as Bot;
const selectedOf = (html: string) => [...html.matchAll(/<option([^>]*)>/g)]
  .filter((match) => /\bselected(=|\s|$)/.test(match[1]!))
  .map((match) => /value="([^"]*)"/.exec(match[1]!)?.[1]);
const budget = (extra: Partial<BotBudget> = {}): BotBudget => ({
  month: "2026-10", runs: 12, input: 40_000, output: 2_500, monthlyUsd: 50, warnAtPercent: 80, percent: 42, warn: false, exceeded: false, ...extra,
});

beforeEach(() => {
  fixture.viewer = { admin: true, guest: false, email: "ana@acme.test" };
  fixture.people = [
    { email: "ana@acme.test", name: "Ana", role: "admin" },
    { email: "bruno@acme.test", name: "Bruno", role: "member" },
    { email: "gil@acme.test", name: "Gil", role: "guest" },
  ];
  fixture.budget = null;
});

describe("the Responsible picker", () => {
  it("lists the administrators, then the admins and members, for an admin", () => {
    const html = renderToStaticMarkup(createElement(OwnerCard, { bot: bot() }));
    expect(html).toContain("Responsible");
    expect(html).toContain(">Administrators</option>");
    expect(html).toContain(">Ana</option>");
    expect(html).toContain(">Bruno</option>");
    expect(html).not.toContain("Gil");
    expect(html).toContain('aria-label="Who is responsible for Atlas"');
  });

  it("selects the administrators while the agent has no owner, and the person once it has", () => {
    expect(selectedOf(renderToStaticMarkup(createElement(OwnerCard, { bot: bot() })))).toEqual(["admins"]);
    expect(selectedOf(renderToStaticMarkup(createElement(OwnerCard, { bot: bot({ owner: "bruno@acme.test" }) })))).toEqual(["bruno@acme.test"]);
  });

  it("still shows a saved owner who is not in the directory, by address", () => {
    const html = renderToStaticMarkup(createElement(OwnerCard, { bot: bot({ owner: "maria@elsewhere.test" }) }));
    expect(html).toContain(">maria@elsewhere.test</option>");
    expect(selectedOf(html)).toEqual(["maria@elsewhere.test"]);
  });

  it("is not there for anyone but an admin", () => {
    fixture.viewer = { admin: false, guest: false, email: "bruno@acme.test" };
    expect(renderToStaticMarkup(createElement(OwnerCard, { bot: bot({ owner: "bruno@acme.test" }) }))).toBe("");
  });

  it("is not there when there is nobody else to choose", () => {
    fixture.people = [{ email: "ana@acme.test", name: "Ana", role: "admin" }];
    expect(renderToStaticMarkup(createElement(OwnerCard, { bot: bot() }))).toBe("");
  });
});

describe("the monthly limit an owner sees", () => {
  it("shows the limit, how much of it is used, the runs and the tokens, and no money spent", () => {
    fixture.budget = budget();
    const html = renderToStaticMarkup(createElement(OwnerBudget, { bot: bot() }));
    expect(html).toContain("Limit: $50.00 a month");
    expect(html).toContain("42% of the limit used");
    expect(html).toContain("12 runs");
    expect(html).toContain("42.5K tokens");
    expect(html).toContain('aria-valuenow="42"');
    expect(html).not.toMatch(/spent/i);
    expect(html.match(/\$/g)).toHaveLength(1);
  });

  it("warns when close to the limit and says so when it was reached", () => {
    fixture.budget = budget({ percent: 91, warn: true });
    expect(renderToStaticMarkup(createElement(OwnerBudget, { bot: bot() }))).toContain("Close to the limit");
    fixture.budget = budget({ percent: 100, warn: true, exceeded: true });
    expect(renderToStaticMarkup(createElement(OwnerBudget, { bot: bot() }))).toContain("The limit for the month was reached");
  });

  it("says so when no limit is set, with nothing to measure", () => {
    fixture.budget = budget({ monthlyUsd: null, percent: null });
    const html = renderToStaticMarkup(createElement(OwnerBudget, { bot: bot() }));
    expect(html).toContain("No limit set");
    expect(html).not.toContain("progressbar");
  });

  it("waits while the limit is being read", () => {
    expect(renderToStaticMarkup(createElement(OwnerBudget, { bot: bot() }))).toContain("Checking");
  });
});
