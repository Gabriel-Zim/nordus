import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readHermesBridge, whatsappForBot } from "./hermes-bridge.ts";
import { customMcpPrompt } from "./system-prompt.ts";

const dir = () => mkdtempSync(join(tmpdir(), "ponte-"));

describe("hermes WhatsApp access", () => {
  it("reaches only the listed bots, per account, and never a client-facing one", () => {
    const data = dir();
    writeFileSync(join(data, "hermes-bridge.json"), JSON.stringify({
      command: "/usr/bin/ssh", args: ["-T", "host"],
      whatsapp: { pessoal: { bots: ["boss"] }, jordan: { bots: ["boss", "assistentefinanceiro"] } },
    }));
    const config = readHermesBridge(data);
    expect(whatsappForBot(config, "boss", false)).toEqual({
      "whatsapp-pessoal": { command: "/usr/bin/ssh", args: ["-T", "host", "wa-mcp", "pessoal"], env: {}, enabled: true },
      "whatsapp-jordan": { command: "/usr/bin/ssh", args: ["-T", "host", "wa-mcp", "jordan"], env: {}, enabled: true },
    });
    expect(Object.keys(whatsappForBot(config, "assistentefinanceiro", false))).toEqual(["whatsapp-jordan"]);
    expect(whatsappForBot(config, "social", false)).toEqual({});
    expect(whatsappForBot(config, "boss", true)).toEqual({});
  });

  it("is off without a file, without a command, or with a broken file", () => {
    const data = dir();
    expect(whatsappForBot(readHermesBridge(data), "boss", false)).toEqual({});
    writeFileSync(join(data, "hermes-bridge.json"), JSON.stringify({ whatsapp: { pessoal: { bots: ["boss"] } } }));
    expect(whatsappForBot(readHermesBridge(data), "boss", false)).toEqual({});
    writeFileSync(join(data, "hermes-bridge.json"), "{ not json");
    expect(readHermesBridge(data)).toBeNull();
  });

  it("hands the reading rules to whoever mounts an account", () => {
    expect(customMcpPrompt(["whatsapp-pessoal"])).toContain("read-only");
    expect(customMcpPrompt(["notes"])).not.toContain("WhatsApp");
  });
});
