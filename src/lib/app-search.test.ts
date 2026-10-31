import { describe, expect, it } from "vitest";

import { matchesSearch } from "./app-search";
import { mcpDisplay } from "./mcp-display";

describe("app search", () => {
  const zim = mcpDisplay({ name: "zim-studio", url: "https://mcp.zim.studio/mcp" });

  it.each(["zim studio", "zimstudio", "ZIM-Studio", "Zim.Studio", "zím stúdio"])("finds the zim-studio server and Zim Studio with %j", (query) => {
    expect(matchesSearch(query, zim.label, "zim-studio")).toBe(true);
  });

  it("finds ElevenLabs by a piece of its name and rejects other apps", () => {
    expect(matchesSearch("eleven", mcpDisplay({ name: "elevenlabs" }).label)).toBe(true);
    expect(matchesSearch("zim studio", "ElevenLabs", "elevenlabs")).toBe(false);
    expect(matchesSearch("   ", "Qualquer")).toBe(true);
  });
});
