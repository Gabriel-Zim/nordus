import { describe, expect, it } from "vitest";

import { isInternalBot } from "./bot-audience.ts";
import type { SecondBrainConfig } from "./second-brain.ts";

const brain = (clientFacing: string[]) => ({ args: [], env: {}, bots: [], record: true, consult: true, clientFacing, roomDocs: {} }) as SecondBrainConfig;

describe("isInternalBot", () => {
  it("counts only a bot marked internal, so a new or unmarked bot is a client's", () => {
    expect(isInternalBot({ id: "gerentedeoperacao", audience: "internal" }, null)).toBe(true);
    expect(isInternalBot({ id: "new" }, null)).toBe(false);
    expect(isInternalBot({ id: "evergreen", audience: "client" }, null)).toBe(false);
  });

  it("never counts a bot that serves clients directly, even when marked internal", () => {
    expect(isInternalBot({ id: "suporte", audience: "internal" }, brain(["suporte"]))).toBe(false);
    expect(isInternalBot({ id: "gerentedeoperacao", audience: "internal" }, brain(["suporte"]))).toBe(true);
  });
});
