import { describe, expect, it } from "vitest";
import { toolDoneLine, toolInputGist, toolWillLine } from "./human-tool";

describe("tool requests in plain words", () => {
  it("keeps the useful part of the parameters and drops the JSON", () => {
    const raw = JSON.stringify({ query: "OpenAI Realtime API pricing", mode: "standard" });
    expect(toolDoneLine("Social", "WebSearch", raw)).toBe("Social searched the web: OpenAI Realtime API pricing");
    expect(toolDoneLine("Social", "WebSearch", raw)).not.toContain("{");
  });

  it("names a page by its address and a file by its name", () => {
    expect(toolInputGist("WebFetch", JSON.stringify({ url: "https://www.example.com/a/b" }))).toBe("example.com/a/b");
    expect(toolInputGist("Read", JSON.stringify({ file_path: "/home/nordus/zorg/notes.md" }))).toBe("notes.md");
  });

  it("never shows a shell command, only its description", () => {
    expect(toolWillLine("Bash", "git status --short")).toBe("It can change files on the bot's computer");
    expect(toolWillLine("Bash", JSON.stringify({ command: "rm -rf x", description: "Clean the build" }))).toBe("It can change files on the bot's computer: Clean the build");
  });

  it("falls back to a friendly tool name", () => {
    expect(toolDoneLine("Ops", "mcp__trello__get_cards", "{}")).toMatch(/^Ops used a tool: /);
  });
});
