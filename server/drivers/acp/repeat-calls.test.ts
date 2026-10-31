import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { ensureDirs } from "../../config.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { createLoopGuard } from "../../host/loop-guard.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { recordEvents } from "../../testing/events.ts";
import { GrokAgentDriver } from "./grok.ts";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../../testing/fake-acp-cli.ts");
const directories: string[] = [];
const instances: ProviderInstance[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.dispose();
  for (const directory of directories.splice(0)) await removeTempDir(directory);
});

/** Grok 1.0.41 runs X search on xAI's side: the call's start carries only `{variant, backend}`, and what it
 * searched for arrives with the result (recorded from the lab's Pesquisador de Design, 18/10/2026). */
function xSearch(id: number, query: string) {
  const toolCallId = `ctc_fixture_call-${id}`;
  return [
    { sessionUpdate: "tool_call", toolCallId, title: "X search:", kind: "search", status: "in_progress", rawInput: { variant: "XSearch", backend: true }, _meta: { backend: true } },
    { sessionUpdate: "tool_call_update", toolCallId, status: "completed", title: "X search:",
      rawOutput: { call_id: `xs_call-${id}`, input: JSON.stringify({ query, limit: "5", mode: "Latest" }), name: "x_keyword_search", id: toolCallId } },
  ];
}

async function run(updates: object[]) {
  ensureDirs(); chmodSync(cli, 0o755);
  const home = mkdtempSync(join(tmpdir(), "nordus-acp-repeat-")); directories.push(home);
  mkdirSync(join(home, ".grok")); writeFileSync(join(home, ".grok/auth.json"), "{}");
  const instance = await GrokAgentDriver.create({ instanceId: "repeat", displayName: "Repeat fixture", enabled: true, config: { cli, fullAuto: true },
    environment: { HOME: home, USERPROFILE: home, FAKE_ACP_GROK_VERSION: "1.0.41", FAKE_ACP_UPDATES: JSON.stringify(updates), FAKE_ACP_TEXT_REPLY: "done" } });
  instances.push(instance);
  const rows: string[] = [];
  const guard = createLoopGuard({
    settings: () => ({ enabled: false, steerAt: 5 }),
    append: (_threadId, tool) => { rows.push(tool.name); },
    live: () => true, waiting: () => false, canSteer: () => false,
    steer: async () => "refused", interrupt: async () => undefined, log: () => {},
  });
  const recorder = recordEvents(instance.adapter);
  instance.adapter.onEvent((event) => guard.onEvent(event));
  await instance.adapter.sendTurn({ threadId: "searches", text: "Find references" });
  await recorder.until((event) => event.type === "turn.completed");
  return { rows, events: recorder.events };
}

async function notices(updates: object[]): Promise<string[]> {
  return (await run(updates)).rows;
}

// OpenCode's ACP (packages/opencode/src/acp, session.tool.input.started) starts a call with no arguments, `{}` or a
// shell's `{ cwd }`, and sends the arguments in a later in_progress tool_call_update.
function opencodeRead(id: number, filePath: string) {
  const toolCallId = `call_${id}`;
  return [
    { sessionUpdate: "tool_call", toolCallId, title: "read", kind: "read", status: "pending", locations: [], rawInput: {} },
    { sessionUpdate: "tool_call_update", toolCallId, status: "in_progress", kind: "read", title: "read", rawInput: { filePath } },
    { sessionUpdate: "tool_call_update", toolCallId, status: "completed", content: [], rawOutput: {} },
  ];
}
function opencodeShell(id: number, command: string) {
  const toolCallId = `sh_${id}`;
  return [
    { sessionUpdate: "tool_call", toolCallId, title: "bash", kind: "execute", status: "pending", locations: [], rawInput: { cwd: "/w" } },
    { sessionUpdate: "tool_call_update", toolCallId, status: "in_progress", kind: "execute", title: command, rawInput: { command, cwd: "/w" } },
    { sessionUpdate: "tool_call_update", toolCallId, status: "completed", content: [], rawOutput: {} },
  ];
}

it("never counts X searches for different words as the same call", async () => {
  const queries = ["luxury home dusk", "reel cover luxury", "quiet luxury villa", "custom home sunset", "dark architecture", "golden hour estate"];
  expect(await notices(queries.flatMap((query, index) => xSearch(index, query)))).toEqual([]);
});

it("still says so when the very same X search repeats", async () => {
  const rows = await notices(Array.from({ length: 5 }, (_, index) => xSearch(index, "luxury home dusk")).flat());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatch(/^Same call repeated 5× — /);
});

it("leaves a call that starts without its arguments uncounted, as before", async () => {
  const updates = Array.from({ length: 5 }, (_, index) => [
    { sessionUpdate: "tool_call", toolCallId: `bare-${index}`, title: "run" },
    { sessionUpdate: "tool_call_update", toolCallId: `bare-${index}`, status: "completed" },
  ]).flat();
  expect(await notices(updates)).toEqual([]);
});

it("never counts OpenCode reads of different files as the same call", async () => {
  expect(await notices(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].flatMap((path, index) => opencodeRead(index, path)))).toEqual([]);
});

it("never counts different OpenCode shell commands as the same call", async () => {
  expect(await notices(["ls", "git status", "pnpm test", "cat a", "pwd"].flatMap((command, index) => opencodeShell(index, command)))).toEqual([]);
});

it("still says so when OpenCode reads the very same file five times", async () => {
  expect(await notices(Array.from({ length: 5 }, (_, index) => opencodeRead(index, "a.ts")).flat())).toHaveLength(1);
});

it("counts a tool whose own arguments say backend: true like any other call", async () => {
  const updates = Array.from({ length: 5 }, (_, index) => [
    { sessionUpdate: "tool_call", toolCallId: `mcp-${index}`, title: "deploy", rawInput: { backend: true, target: "staging" } },
    { sessionUpdate: "tool_call_update", toolCallId: `mcp-${index}`, status: "completed", rawOutput: { ok: true } },
  ]).flat();
  expect(await notices(updates)).toHaveLength(1);
});

it("keeps the arguments' digest from being recomputed outside this process", async () => {
  const args = { path: "notes/secret-pin-4821.txt" };
  const { events } = await run([
    { sessionUpdate: "tool_call", toolCallId: "read-1", title: "read_file", rawInput: args },
    { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed", rawOutput: {} },
  ]);
  const digests = events.flatMap((event) => "argsDigest" in event && typeof event.argsDigest === "string" ? [event.argsDigest] : []);
  expect(digests).toHaveLength(1);
  const plain = createHash("sha256").update(JSON.stringify(["read_file", args])).digest("hex");
  expect(plain.startsWith(digests[0]!)).toBe(false);
});
