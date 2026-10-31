// Real app + real file routes, entirely within a disposable fake-engine home.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchVerificationServer, runControlNordus } from "./control-nordus.ts";
import { fixtureApi, mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
// Synthetic media made for this script (a 0.5 s 192x108 H.264 clip and a 64x64 PNG), so it needs no recordings in the repository.
const DEMO_MP4_BASE64 = "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";
const DEMO_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAfUlEQVR42u3awQmAMBAEwItYgY1oZ1qKpdmI1mALQtQzOPvOIwNLDpKUcd6j5XTReAAAAAAAAAAy019ZtK1Dyuam5VAhAAAAgA/MgZpz+uk5o0IAAAAAAAAAAAAAAAAAAAAA8fq9UNa7gQoBAAAA3JbizxwAAAAAAADAjwEnneELDV9EIe0AAAAASUVORK5CYII=";
const fixture = await launchVerificationServer();
let ui: MountedPreview | undefined;
try {
  const api = fixtureApi(fixture.info.url);
  const control = (args: string[]) => runControlNordus([...args, "--url", fixture.info.url]);
  await control(["new-bot", "--name", "Pepper"]);
  const { bots } = await api("GET", "/api/bots?messages=0");
  const bot = bots.find((item: { name: string }) => item.name === "Pepper");
  const workspace = join(fixture.info.dataDir, "workspaces", bot.id);
  mkdirSync(workspace, { recursive: true });
  const video = join(workspace, "demo.mp4");
  writeFileSync(video, Buffer.from(DEMO_MP4_BASE64, "base64"));
  const files = ["brief.md", "metrics.csv", "notes.txt", "next-steps.md"];
  for (const name of files) writeFileSync(join(workspace, name), `Synthetic UI fixture: ${name}\n`, "utf8");
  const image = await fetch(`${fixture.info.url}/api/attachments`, {
    method: "POST", headers: { "content-type": "image/png" },
    body: Buffer.from(DEMO_PNG_BASE64, "base64"),
  }).then(async (response) => { if (!response.ok) throw new Error("fixture image upload failed"); return response.json(); });
  const reply = [
    "Here are the demo recording and files for review. These are isolated test artifacts.",
    `[Demo recording](${video})`,
    ...files.map((name) => `[${name}](${join(workspace, name)})`),
  ].join("\n\n");
  const wrapper = join(fixture.info.dataDir, "polish-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    `process.env.FAKE_CLAUDE_REPLIES = ${JSON.stringify(JSON.stringify([reply]))};`,
    `process.env.FAKE_CLAUDE_TOOL_CALLS = ${JSON.stringify(JSON.stringify([
      { name: "Bash", input: { command: "pnpm control:nordus doctor", password: "fixture-password" }, output: { text: "All fixture health checks passed.", token: "fixture-token" }, ok: true },
      { name: "Read", input: { file_path: "missing.txt" }, output: "File not found: missing.txt", ok: false },
      { name: "Search", input: { query: "release notes" }, ok: true },
    ]))};`,
    `await import(${JSON.stringify(pathToFileURL(join(root, "server/testing/fake-claude-cli.ts")).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  await api("PATCH", "/api/config", { features: { showToolCalls: true }, language: "en" });
  await control(["send", "--bot", bot.id, "--text", `Review these assets and show the tool results.\n<attached-image path="${image.path}" />`]);
  const settled = await control(["wait", "--bot", bot.id, "--timeout", "30"]);
  ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__chat-polish.html", title: "Isolated Nordus UI polish" });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: ui.previewUrl, botId: bot.id, settled }));
  await parkUntilSignal();
} finally {
  await ui?.close();
  await fixture.close();
}
