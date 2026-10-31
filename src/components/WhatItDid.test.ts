import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { digestsByReply, whatItDidLines } from "./WhatItDid";

const digest = (patch: Partial<NonNullable<Message["digest"]>> = {}, id = "d1") => ({
  id, role: "bot", kind: "digest", at: 1,
  digest: { turnId: "t", botId: "b", threadId: "th", at: 1, durationMs: 9000, tools: [{ name: "WebSearch", count: 2, failed: 0 }], memory: [], reply: "", hookCoverage: "full", usage: { input: 1200, output: 80, costUsd: 0.0123 }, ...patch },
}) as unknown as Message;
const text = (id: string, role: "user" | "bot", botId?: string) => ({ id, role, kind: "text", at: 1, text: "oi", ...(botId ? { from: { botId, name: botId } } : {}) }) as unknown as Message;

describe("what it did", () => {
  it("tells the steps in the past and in plain words, never cost or tokens", () => {
    const lines = whatItDidLines(digest());
    expect(lines).toEqual(["Searched the web"]);
    expect(lines.join(" ")).not.toMatch(/0\.0123|token/);
  });

  it("groups repeated steps and leaves out a failure the bot worked around", () => {
    expect(whatItDidLines(digest({ tools: [{ name: "Read", count: 3, failed: 1 }, { name: "WebFetch", count: 1, failed: 1 }] })))
      .toEqual(["Read 2 files", "Opened a page (something went wrong)"]);
  });

  it("is empty when the bot only talked or only did its own housekeeping", () => {
    expect(whatItDidLines(digest({ tools: [] }))).toEqual([]);
    expect(whatItDidLines(digest({ tools: [{ name: "ToolSearch", count: 1, failed: 0 }, { name: "mcp__agents__propose_lesson", count: 1, failed: 0 }] }))).toEqual([]);
  });

  it("hangs each digest on its own bot's last reply, also in a room", () => {
    const map = digestsByReply([text("u", "user"), text("a", "bot", "A"), text("b", "bot", "B"), digest({ botId: "A" }, "dA"), digest({ botId: "B" }, "dB")]);
    expect(map.get("a")?.id).toBe("dA");
    expect(map.get("b")?.id).toBe("dB");
    const direct = digestsByReply([text("u", "user"), text("r", "bot"), digest({ botId: "x" }, "dx")]);
    expect(direct.get("r")?.id).toBe("dx");
  });
});
