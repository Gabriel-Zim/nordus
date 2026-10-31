#!/usr/bin/env node
// Offline stand-in for Moonshot's `kimi` CLI sign-in (`--version`, `login` printing kimi-code 2.3.1's device
// instructions on stderr): no network, no real credential; needs explicit opt-in and a disposable HOME.
//   FAKE_KIMI_MODE  success | approve (once HOME/.nordus-fake-kimi-approved exists) | waiting | evil (a page on another
//     host) | expired | denied | crash | no-credential | ignore-term | slow (prints the page, never the code line)
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const home = process.env.HOME;
if (process.env.NORDUS_DEVICE_AUTH_FIXTURE !== "1" || !home || !isAbsolute(home)) {
  process.stderr.write("This fake CLI requires NORDUS_DEVICE_AUTH_FIXTURE=1 and an isolated HOME.\n");
  process.exit(2);
}
const kimiHome = process.env.KIMI_CODE_HOME || join(home, ".kimi-code");
const mode = process.env.FAKE_KIMI_MODE || "success";
const args = process.argv.slice(2);
appendFileSync(join(home, "fake-kimi-calls.jsonl"), `${JSON.stringify({ args, home, kimiHome, moonshotKey: process.env.MOONSHOT_API_KEY ?? null, browser: process.env.BROWSER ?? null, display: process.env.DISPLAY ?? null })}\n`);

const signIn = () => {
  mkdirSync(join(kimiHome, "credentials"), { recursive: true });
  writeFileSync(join(kimiHome, "credentials", "kimi-code.json"), "{\"fixture\":\"offline, not a credential\"}\n", { mode: 0o600 });
  process.stderr.write("Logged in to Kimi Code.\n");
  process.exit(0);
};

if (args.join(" ") === "--version") {
  process.stdout.write("2.3.1 (fixture)\n");
} else if (args.join(" ") === "login") {
  writeFileSync(join(home, "fake-kimi-login.pid"), String(process.pid));
  const code = "4F19-U3XI";
  const page = mode === "evil" ? "https://kimi.com.evil.test/code/authorize_device" : `https://www.kimi.com/code/authorize_device?user_code=${code}`;
  process.stderr.write(`\nOpening browser for Kimi device login: ${page}\n`);
  if (mode !== "slow") {
    process.stderr.write(`If the browser did not open, paste the URL above and enter code: ${code}\nCode expires in 1800s.\nWaiting for authorization to complete…\n`);
  }
  const later = (then: () => void) => setTimeout(then, 80);
  if (mode === "success") later(signIn);
  else if (mode === "approve") setInterval(() => { if (existsSync(join(home, ".nordus-fake-kimi-approved"))) signIn(); }, 100);
  else if (mode === "no-credential") later(() => process.exit(0));
  else if (mode === "expired") later(() => { process.stderr.write("Login failed: device code expired secret-token\n"); process.exit(1); });
  else if (mode === "denied") later(() => { process.stderr.write("Login cancelled: access denied secret-token\n"); process.exit(1); });
  else if (mode === "crash") later(() => { process.stderr.write("Login failed: access_token=secret-token\n"); process.exit(1); });
  else {
    if (mode === "ignore-term") process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  }
} else {
  process.stderr.write("Unsupported offline fixture command.\n");
  process.exitCode = 2;
}
