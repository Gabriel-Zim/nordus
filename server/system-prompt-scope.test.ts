import { describe, expect, it } from "vitest";
import { PROFILE_PROMPT, TRIGGER_PROMPT, whenToolAllowed } from "./system-prompt.ts";

describe("prompt paragraphs follow the tool selection", () => {
  it("keeps them for a bot with no selection or one that allows the tool", () => {
    expect(whenToolAllowed(undefined, "create_trigger", TRIGGER_PROMPT)).toBe(TRIGGER_PROMPT);
    expect(whenToolAllowed({ allow: ["mcp:agents:create_trigger"] }, "create_trigger", TRIGGER_PROMPT)).toBe(TRIGGER_PROMPT);
    expect(whenToolAllowed({ deny: ["mcp:agents:vm_exec"] }, "propose_profile", PROFILE_PROMPT)).toBe(PROFILE_PROMPT);
  });

  it("drops them when the selection leaves the tool out", () => {
    expect(whenToolAllowed({ deny: ["mcp:agents:create_trigger"] }, "create_trigger", TRIGGER_PROMPT)).toBe("");
    expect(whenToolAllowed({ allow: ["mcp:agents:list_bots"] }, "propose_profile", PROFILE_PROMPT)).toBe("");
  });

  it("drops them for a selection that is not valid, the way the tools themselves are refused", () => {
    expect(whenToolAllowed({ allow: "everything" }, "create_trigger", TRIGGER_PROMPT)).toBe("");
  });
});
