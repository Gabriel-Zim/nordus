import { describe, expect, it } from "vitest";
import { preferCompatibleBackup, recoveryCapabilityError, recoveryUnavailableMessage } from "./automatic-recovery.ts";

describe("automatic recovery capabilities", () => {
  const engine = { driverKind: "qwenAgent", capabilities: {
    sessionModelSwitch: "unsupported" as const, agentsMcp: true, browserMcp: true,
    customMcp: true, dataMcp: true, highlevelMcp: true, images: true,
  } };
  it("keeps a compatible local workspace and rejects losing a tool or attachment", () => {
    expect(recoveryCapabilityError(engine, { ...engine, driverKind: "claudeAgent" })).toBeUndefined();
    for (const key of ["agentsMcp", "browserMcp", "customMcp", "dataMcp", "highlevelMcp", "images"] as const) {
      expect(recoveryCapabilityError(engine, { ...engine, capabilities: { ...engine.capabilities, [key]: false } })).toMatch(/tools and attachments/);
    }
  });
  it("does not silently move work to a file-less engine", () => {
    expect(recoveryCapabilityError(engine, { ...engine, driverKind: "openai-compat" })).toMatch(/same workspace/);
  });
  it("prefers a backup that keeps every tool, and falls back to the first so the refusal can name it", () => {
    expect(preferCompatibleBackup([0, 2], index => index === 2)).toBe(2);
    expect(preferCompatibleBackup([1, 2], () => false)).toBe(1);
    expect(preferCompatibleBackup([], () => true)).toBe(-1);
  });
  it("tells a person in Portuguese to change the bot's account instead of the technical text", () => {
    const text = recoveryUnavailableMessage(recoveryCapabilityError(engine, { ...engine, capabilities: { ...engine.capabilities, images: false } })!, "Codex is at its usage limit.");
    expect(text).toMatch(/^A recuperação automática não pôde continuar/);
    expect(text).toMatch(/Troque a conta/);
    expect(text).toContain("Original error: Codex is at its usage limit.");
    expect(text).not.toMatch(/^Automatic recovery/);
  });
});
