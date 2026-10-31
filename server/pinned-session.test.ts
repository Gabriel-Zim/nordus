import { describe, expect, it } from "vitest";

import { sessionOnOtherModel } from "./pinned-session.ts";

const base = { pinned: true, instanceId: "grok", model: "grok-4.7", liveSessionModel: undefined, lastContextModel: undefined };

describe("sessionOnOtherModel", () => {
  it("starts over when a pinned session ran a smaller model last time", () => {
    expect(sessionOnOtherModel({ ...base, lastContextModel: "grok:grok-4.7-fast" })).toBe(true);
    expect(sessionOnOtherModel({ ...base, liveSessionModel: "grok-4.7-fast", lastContextModel: "grok:grok-4.7" })).toBe(true);
  });

  it("resumes when the model is the same, unknown, from another engine, or the engine can switch", () => {
    expect(sessionOnOtherModel({ ...base, lastContextModel: "grok:grok-4.7" })).toBe(false);
    expect(sessionOnOtherModel(base)).toBe(false);
    expect(sessionOnOtherModel({ ...base, lastContextModel: "claude:claude-opus-5-5" })).toBe(false);
    expect(sessionOnOtherModel({ ...base, pinned: false, lastContextModel: "grok:grok-4.7-fast" })).toBe(false);
  });
});
