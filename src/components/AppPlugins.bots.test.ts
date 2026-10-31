import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), bots: [] as unknown[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: fixture.dispatch }) };
});

const { BotsForApp } = await import("./AppPlugins");

const remote = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: "http" as const, url: `https://${name}.example.com/mcp`, headerKeys: [], enabled: true, ...extra });
const listing = [
  remote("notion"),
  { name: "notes", command: "npx", args: [], envKeys: [], enabled: true },
  remote("trafego", { explicit: true }),
];

function bot(overrides: Partial<Bot>): Bot {
  return {
    id: "bot-1", threadId: "t", name: "Scout", title: "Scout", description: "", notifications: false, color: "green", unread: false,
    modelSelection: { instanceId: "local", model: "m" }, messages: [], ...overrides,
  } as Bot;
}

function switches(node: ReactNode, found: ReactElement<{ role?: string; onClick?: () => void; "aria-checked"?: boolean }>[] = []) {
  if (Array.isArray(node)) node.forEach((child) => switches(child, found));
  else if (isValidElement<{ role?: string; children?: ReactNode }>(node)) {
    if (node.props.role === "switch") found.push(node as ReactElement<{ role?: string; onClick?: () => void }>);
    switches(node.props.children, found);
  }
  return found;
}

beforeEach(() => fixture.dispatch.mockReset());

describe("who uses a connected app", () => {
  it("never writes an explicit server into the list of an internal bot without one", () => {
    fixture.bots = [bot({ internal: true })];
    const [row] = switches(BotsForApp({ name: "notion", servers: listing }));
    row.props.onClick?.();
    const patch = fixture.dispatch.mock.calls[0][0].patch.mcpServers as string[];
    expect(patch).not.toContain("trafego");
    expect(patch).toEqual(["notes"]);
  });

  it("shows an explicit server as off for a bot that does not name it", () => {
    fixture.bots = [bot({ internal: true })];
    const [row] = switches(BotsForApp({ name: "trafego", servers: listing }));
    expect(row.props["aria-checked"]).toBe(false);
  });

  it("turns an explicit server on for a bot only by adding it to that bot's own list", () => {
    fixture.bots = [bot({ internal: true, mcpServers: ["notion"] })];
    const [row] = switches(BotsForApp({ name: "trafego", servers: listing }));
    row.props.onClick?.();
    expect(fixture.dispatch.mock.calls[0][0].patch.mcpServers).toEqual(["notion", "trafego"]);
  });
});
