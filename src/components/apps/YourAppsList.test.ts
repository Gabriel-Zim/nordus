import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Effects never run under server rendering, so the two lists the component loads are seeded as a finished load leaves them.
const fixture = vi.hoisted(() => ({ servers: [] as unknown[], oauth: [] as unknown[], index: 0, counting: false }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      if (!fixture.counting) return react.useState(initial);
      const index = fixture.index++;
      if (index === 0) return [fixture.servers, () => {}];
      if (index === 1) return [fixture.oauth, () => {}];
      return [initial, () => {}];
    },
  };
});
vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})) }));
import { setLocale } from "@/lib/i18n";
import { YourAppsList } from "./YourAppsList";

function render(props: Partial<Parameters<typeof YourAppsList>[0]> = {}) {
  function Capture() {
    fixture.index = 0;
    fixture.counting = true;
    try { return YourAppsList({ cards: [], status: {}, highLevelConnected: null, onConnectCatalog: () => {}, ...props }); } finally { fixture.counting = false; }
  }
  return renderToStaticMarkup(createElement(Capture));
}
const rows = (html: string) => [...html.matchAll(/data-your-app="([^"]+)" data-app-state="([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);

beforeEach(() => {
  vi.stubGlobal("window", {});
  setLocale("en");
  fixture.servers = [];
  fixture.oauth = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("Your apps", () => {
  it("joins the catalog, built-in apps, platform sign-ins and custom connections in one list", () => {
    fixture.servers = [
      { name: "notion", url: "https://mcp.notion.com/mcp", enabled: true, auth: "needs-sign-in" },
      { name: "whop", type: "http", url: "https://mcp.whop.com/mcp", enabled: true, auth: "signed-in" },
      { name: "cerebro", url: "https://cerebro.example.com/mcp", enabled: true, health: { state: "down", reason: "O app demorou demais para responder." } },
      { name: "notes", command: "npx", enabled: false },
    ];
    fixture.oauth = [
      { provider: "github", configured: true, connected: false },
      { provider: "google", configured: true, connected: true },
      { provider: "slack", configured: true, connected: false },
    ];
    const html = render({
      cards: [{ slug: "gmail", label: "Gmail" }],
      status: { gmail: { connected: true, accounts: [{ id: "1", status: "ACTIVE" }] } },
      highLevelConnected: true,
    });
    expect(rows(html)).toEqual([
      "native:notion=needs-sign-in",
      "oauth:github=needs-sign-in",
      "custom:cerebro=problem",
      "catalog:gmail=connected",
      "native:whop=connected",
      "oauth:google=connected",
      "native:highlevel=connected",
      "custom:notes=off",
    ]);
    expect(html.match(/>Sign in</g)).toHaveLength(2);
    expect(html).toContain("O app demorou demais para responder.");
    expect(html).toContain(">Off<");
    expect(html).toContain(">Notion<");
  });

  it("speaks of apps only: no connection type, address, header, variable or timeout in the list", () => {
    fixture.servers = [
      { name: "cerebro", type: "http", url: "https://cerebro.example.com/mcp", headerKeys: ["Authorization"], enabled: true, health: { state: "degraded", reason: "Não consegui falar com o app agora." } },
      { name: "files", command: "npx", args: ["-y", "files-mcp"], envKeys: ["TOKEN"], enabled: true },
    ];
    const html = render();
    expect(rows(html)).toEqual(["custom:cerebro=problem", "custom:files=connected"]);
    const text = html.replace(/<[^>]*>/g, " ");
    for (const technical of [/MCP/i, /server/i, /OAuth/i, /Composio/i, /https?:/i, /Authorization/, /TOKEN/, /npx/, /timeout/i, /redirect/i, /client id/i, /Test\b/]) {
      expect(text).not.toMatch(technical);
    }
  });

  it("filters by the search and renders nothing when nothing is the person's", () => {
    fixture.servers = [{ name: "notes", command: "npx", enabled: true }, { name: "docs", url: "https://docs.example.com/mcp", enabled: true }];
    expect(rows(render({ query: "docs" }))).toEqual(["custom:docs=connected"]);
    expect(render({ query: "nothing like it" })).toBe("");
    fixture.servers = [];
    expect(render()).toBe("");
  });

  it("gives the Sign in button only to rows that need one", () => {
    fixture.servers = [{ name: "notes", command: "npx", enabled: true }];
    expect(render()).not.toContain("Sign in");
  });
});
