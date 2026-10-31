import { describe, expect, it } from "vitest";
import { loadLocalePack } from "./load";

describe("language packs", () => {
  it("loads a real language and refuses the translation bookkeeping file", async () => {
    expect(Object.keys(await loadLocalePack("en")).length).toBeGreaterThan(100);
    await expect(loadLocalePack("source-hashes")).rejects.toThrow("No language pack");
  });
});
