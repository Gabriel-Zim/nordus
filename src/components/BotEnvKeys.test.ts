import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = {
  bots: [{ id: "atlas", name: "Atlas" }],
  config: { botEnv: [
    { name: "APIFY_TOKEN", purpose: "Raspar perfis do Instagram", bots: ["atlas"] },
    { name: "META_ACCESS_TOKEN", purpose: null, bots: null },
  ] },
};
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state, dispatch: vi.fn() }),
}));

import { BotEnvKeys } from "./BotEnvKeys";

describe("BotEnvKeys", () => {
  it("lists each saved key by name with who gets it, offering replace and delete but never a value", () => {
    const html = renderToStaticMarkup(createElement(BotEnvKeys));
    expect(html).toContain("Chaves dos robôs");
    expect(html).toContain('data-bot-env-key="APIFY_TOKEN"');
    expect(html).toContain("Raspar perfis do Instagram · Só para Atlas");
    expect(html).toContain("Todos os robôs da casa");
    expect(html).toContain("Trocar");
    expect(html).toContain("Apagar APIFY_TOKEN");
    expect(html).toContain('type="password"');
    expect(html).not.toContain("—");
  });
});
