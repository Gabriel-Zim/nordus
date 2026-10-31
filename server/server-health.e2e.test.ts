// Real server: /api/health carries the event-loop numbers, and a frozen process shows up as one log line.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { verificationServerEnvironment } from "../scripts/control-nordus.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_CLI = join(ROOT, "server/testing/fake-claude-cli.ts");

const homes: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) await waitForExit(child, { signal: "SIGTERM" });
  for (const home of homes.splice(0)) await removeTempDir(home);
});

it.skipIf(process.platform === "win32")("reports event-loop delay on /api/health and logs a frozen loop", async () => {
  const home = mkdtempSync(join(tmpdir(), "nordus-server-health-"));
  homes.push(home);
  mkdirSync(join(home, "tmp"), { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({
    instances: { claude: { driver: "claudeAgent", displayName: "Verification fixture", config: { cli: FAKE_CLI } } },
  }));
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
    cwd: ROOT,
    env: verificationServerEnvironment({ ...process.env }, home, port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  const health = async () => {
    if (child.exitCode !== null) throw new Error(`server exited:\n${output}`);
    try { return await (await fetch(base + "/api/health")).json() as any; } catch { return null; }
  };

  await expect.poll(async () => (await health())?.eventLoop?.samples ?? 0, { timeout: 30_000, interval: 100 }).toBeGreaterThan(0);
  const body = await health();
  expect(body.app).toBe("nordus");
  expect(body.eventLoop).toEqual({
    lagMs: expect.any(Number), p99Ms: expect.any(Number), maxMs: expect.any(Number), samples: expect.any(Number),
  });

  child.kill("SIGSTOP");
  await sleep(1_500);
  child.kill("SIGCONT");
  await expect.poll(() => /\[saude\] atraso no event loop: \d+ms/.test(output), { timeout: 10_000, interval: 100 }).toBe(true);
  expect((await health()).eventLoop.maxMs).toBeGreaterThanOrEqual(1_000);
}, 60_000);
