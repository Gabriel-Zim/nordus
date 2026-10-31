import { describe, expect, it } from "vitest";

import { TRANSCRIPT_END_PAD, composerDockHeightValue } from "./composer-dock";

describe("composer dock height", () => {
  it("rounds the measured height up to whole pixels", () => {
    expect(composerDockHeightValue(71.2)).toBe("72px");
  });

  it("leaves the fallback in place before the dock has a size", () => {
    expect(composerDockHeightValue(0)).toBeNull();
    expect(composerDockHeightValue(Number.NaN)).toBeNull();
  });

  it("pads the transcript by the dock height plus the row gap", () => {
    expect(TRANSCRIPT_END_PAD).toBe("calc(var(--composer-dock-h, 64px) + 0.75rem)");
  });
});
