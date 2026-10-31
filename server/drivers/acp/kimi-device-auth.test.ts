// Every process here is the offline fake kimi in a disposable HOME: no real Kimi, no Moonshot call, no credentials.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deviceSignInLink, deviceSignInPrompt, isDeviceSignInCode } from "../../../shared/device-sign-in.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { DeviceAuthController } from "../device-auth.ts";
import { KIMI_DEVICE_SIGN_IN, KimiAgentDriver, kimiSignedIn } from "./kimi.ts";

const FAKE_KIMI = fileURLToPath(new URL("../../testing/fake-kimi-login-cli.ts", import.meta.url));
const CODE = "4F19-U3XI";
const PAGE = "https://www.kimi.com/code/authorize_device";
const COMPLETE = `${PAGE}?user_code=${CODE}`;

describe("Kimi device prompt", () => {
  // What `kimi login` 2.3.1 prints on stderr, verbatim.
  const printed = (page = COMPLETE, code = CODE) => stripVTControlCharacters(
    `\nOpening browser for Kimi device login: ${page}\nIf the browser did not open, paste the URL above and enter code: ${code}\nCode expires in 1800s.\nWaiting for authorization to complete…\n`);

  it("reads Moonshot's page and the code from the CLI's sentences", () => {
    expect(deviceSignInPrompt("kimi", printed())).toEqual({ authorizationUrl: COMPLETE, userCode: CODE });
    expect(deviceSignInPrompt("kimi", printed(PAGE))).toEqual({ authorizationUrl: PAGE, userCode: CODE });
    expect(deviceSignInPrompt("kimi", printed("https://www.kimi.ai/code/authorize_device?user_code=" + CODE)))
      .toEqual({ authorizationUrl: `https://www.kimi.ai/code/authorize_device?user_code=${CODE}`, userCode: CODE });
  });

  it("waits for whole lines, and for both of them", () => {
    expect(deviceSignInPrompt("kimi", `Opening browser for Kimi device login: ${COMPLETE}\nIf the browser did not open, paste the URL above and enter code: 4F19-U3`)).toBeNull();
    expect(deviceSignInPrompt("kimi", `Opening browser for Kimi device login: ${COMPLETE}\n`)).toBeNull();
    expect(deviceSignInPrompt("kimi", `Opening browser for Kimi device login: ${COMPLETE}\nIf the browser did not open, paste the URL above and enter code: ${CODE}\n`))
      .toEqual({ authorizationUrl: COMPLETE, userCode: CODE });
  });

  it("accepts a link that carries the code only with that same code", () => {
    expect(deviceSignInPrompt("kimi", printed(`${PAGE}?user_code=ZZZZ-ZZZZ`))).toBeNull();
    expect(deviceSignInLink("kimi", COMPLETE, CODE)).toBe(COMPLETE);
    expect(deviceSignInLink("kimi", COMPLETE, "ZZZZ-ZZZZ")).toBeNull();
  });

  it.each([
    "http://www.kimi.com/code/authorize_device",
    "https://kimi.com.evil.test/code/authorize_device",
    "https://evilkimi.com/code/authorize_device",
    "https://user@www.kimi.com/code/authorize_device",
    "https://www.kimi.com:8443/code/authorize_device",
    "https://www.kimi.com/code/authorize_device#token",
    "https://www.kimi.com/code/authorize_device?token=secret-token",
    "https://www.kimi.com/other/path",
    "https://accounts.x.ai/device",
  ])("never turns another page into a sign-in link: %s", (page) => {
    expect(deviceSignInPrompt("kimi", printed(page))).toBeNull();
    expect(deviceSignInLink("kimi", page, CODE)).toBeNull();
  });

  it("knows a code from other output", () => {
    expect(isDeviceSignInCode("kimi", CODE)).toBe(true);
    for (const line of ["Waiting for authorization to complete…", "secret-token", "4f19-u3xi", "AB", ""]) expect(isDeviceSignInCode("kimi", line)).toBe(false);
  });
});

describe("Kimi signed-in detection", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "nordus-kimi-creds-")); });
  afterEach(async () => { await removeTempDir(home); });

  it("reads the credentials file in the child's own data root", () => {
    expect(kimiSignedIn({ HOME: home })).toBe(false);
    const root = join(home, ".kimi-code", "credentials");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "kimi-code.json"), "");
    expect(kimiSignedIn({ HOME: home })).toBe(false);
    writeFileSync(join(root, "kimi-code.json"), "not json");
    expect(kimiSignedIn({ HOME: home })).toBe(false);
    writeFileSync(join(root, "kimi-code.json"), "{}");
    expect(kimiSignedIn({ HOME: home })).toBe(false);
    writeFileSync(join(root, "kimi-code.json"), "{\"fixture\":1}");
    expect(kimiSignedIn({ HOME: home })).toBe(true);
    expect(kimiSignedIn({ HOME: join(home, "elsewhere") })).toBe(false);
    expect(kimiSignedIn({ HOME: join(home, "elsewhere"), KIMI_CODE_HOME: join(home, ".kimi-code") })).toBe(true);
  });

  it("reads the global channel's environment-named credentials file (kimi-code 2.3.1)", () => {
    const root = join(home, ".kimi-code", "credentials");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "other.json"), "{\"fixture\":1}");
    expect(kimiSignedIn({ HOME: home })).toBe(false);
    writeFileSync(join(root, "kimi-code-env-0e4f99c69cc27850.json"), "{}");
    expect(kimiSignedIn({ HOME: home })).toBe(false);
    writeFileSync(join(root, "kimi-code-env-0e4f99c69cc27850.json"), "{\"fixture\":1}");
    expect(kimiSignedIn({ HOME: home })).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("Kimi sign-in with a device code", () => {
  let home: string;
  let instances: ProviderInstance[];
  const kimi = async (mode: string, environment: Record<string, string> = {}) => {
    const instance = await KimiAgentDriver.create({
      instanceId: "kimi", displayName: "Kimi", enabled: true,
      config: KimiAgentDriver.decodeConfig({ cli: FAKE_KIMI }),
      // A stray Moonshot key must not reach the subscription login (transformEnv).
      environment: { HOME: home, USERPROFILE: home, DISPLAY: ":99", NORDUS_DEVICE_AUTH_FIXTURE: "1", FAKE_KIMI_MODE: mode, MOONSHOT_API_KEY: "sk-fixture-must-not-leak", ...environment },
    });
    instances.push(instance);
    return instance;
  };
  const calls = () => readFileSync(join(home, "fake-kimi-calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const pid = () => Number(readFileSync(join(home, "fake-kimi-login.pid"), "utf8"));
  const alive = (target: number) => { try { process.kill(target, 0); return true; } catch { return false; } };

  beforeEach(() => {
    chmodSync(FAKE_KIMI, 0o755);
    home = mkdtempSync(join(tmpdir(), "nordus-kimi-device-"));
    instances = [];
  });
  afterEach(async () => {
    await Promise.all(instances.map((instance) => instance.dispose()));
    await removeTempDir(home);
  });

  it("shows Moonshot's page and code, then confirms the credentials file the driver's own check reads", async () => {
    const instance = await kimi("success");
    expect((await instance.snapshot()).authenticated).toBe(false);
    const start = await instance.startAuthentication!();
    expect(start).toMatchObject({ phase: "waiting", authorizationUrl: COMPLETE, userCode: CODE, flowId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    await expect.poll(() => instance.getAuthentication!(start.flowId!), { timeout: 5_000 })
      .toEqual({ phase: "succeeded", flowId: start.flowId, authorizationUrl: null, expiresAt: null });
    expect(existsSync(join(home, ".kimi-code", "credentials", "kimi-code.json"))).toBe(true);
    expect((await instance.snapshot()).authenticated).toBe(true);
    const logins = calls().filter((call) => call.args[0] === "login");
    expect(logins).toEqual([{ args: ["login"], home, kimiHome: join(home, ".kimi-code"), moonshotKey: null, browser: process.platform === "linux" ? "true" : null, display: process.platform === "linux" ? "" : ":99" }]);
  });

  it("signs in to the instance's own KIMI_CODE_HOME, and reads it there", async () => {
    const kimiHome = join(home, "work-kimi");
    const instance = await kimi("success", { KIMI_CODE_HOME: kimiHome });
    const start = await instance.startAuthentication!();
    await expect.poll(async () => (await instance.getAuthentication!(start.flowId!)).phase, { timeout: 5_000 }).toBe("succeeded");
    expect(existsSync(join(kimiHome, "credentials", "kimi-code.json"))).toBe(true);
    expect(existsSync(join(home, ".kimi-code"))).toBe(false);
    expect((await instance.snapshot()).authenticated).toBe(true);
  });

  it("never replaces an existing login's file: a cancelled sign-in leaves it alone", async () => {
    const file = join(home, ".kimi-code", "credentials", "kimi-code.json");
    mkdirSync(join(home, ".kimi-code", "credentials"), { recursive: true });
    writeFileSync(file, "{\"existing\":true}");
    const instance = await kimi("waiting");
    expect(await instance.startAuthentication!()).toMatchObject({ phase: "waiting", userCode: CODE });
    await instance.cancelAuthentication!();
    expect(readFileSync(file, "utf8")).toBe("{\"existing\":true}");
  });

  it("cancels: the login process stops and the code is gone", async () => {
    const instance = await kimi("ignore-term");
    const start = await instance.startAuthentication!();
    expect(alive(pid())).toBe(true);
    await instance.cancelAuthentication!();
    expect(alive(pid())).toBe(false);
    const status = await instance.getAuthentication!(start.flowId!);
    expect(status).toMatchObject({ phase: "cancelled", message: "Kimi sign-in cancelled.", authorizationUrl: null });
    expect(status.userCode).toBeUndefined();
    expect(existsSync(join(home, ".kimi-code", "credentials", "kimi-code.json"))).toBe(false);
    expect((await instance.snapshot()).authenticated).toBe(false);
  });

  it("times out an unattended code and stops its process", async () => {
    const controller = new DeviceAuthController(KIMI_DEVICE_SIGN_IN, {
      cli: FAKE_KIMI, lifetimeMs: 1_500, terminateTimeoutMs: 50,
      environment: () => ({ ...process.env, HOME: home, NORDUS_DEVICE_AUTH_FIXTURE: "1", FAKE_KIMI_MODE: "waiting" }),
    });
    try {
      const start = await controller.start();
      await expect.poll(async () => (await controller.get(start.flowId!)).phase, { timeout: 5_000 }).toBe("expired");
      expect((await controller.get(start.flowId!)).message).toBe("The Kimi sign-in code expired. Start sign-in again.");
      await controller.cancel();
      expect(alive(pid())).toBe(false);
    } finally { await controller.dispose(); }
  });

  it.each(["evil", "slow"])("does not show a page on another host or half the output (%s), and gives up waiting", async (mode) => {
    const controller = new DeviceAuthController(KIMI_DEVICE_SIGN_IN, {
      cli: FAKE_KIMI, startupTimeoutMs: 1_000, terminateTimeoutMs: 50,
      environment: () => ({ ...process.env, HOME: home, NORDUS_DEVICE_AUTH_FIXTURE: "1", FAKE_KIMI_MODE: mode }),
    });
    try {
      await expect(controller.start()).rejects.toThrow("Kimi did not provide a sign-in code in time");
      await controller.cancel();
      expect(alive(pid())).toBe(false);
    } finally { await controller.dispose(); }
  });

  it.each([
    ["expired", "The Kimi sign-in code expired. Start sign-in again for a new code."],
    ["denied", "Kimi sign-in was declined in the browser. Start sign-in again to try once more."],
    ["crash", "Kimi sign-in did not finish. Check the server's connection, then try again."],
    ["no-credential", "Kimi finished sign-in but did not confirm a Kimi account. Refresh Settings and try again."],
  ])("ends a %s sign-in with one plain message and none of the CLI's words", async (mode, message) => {
    const instance = await kimi(mode);
    const start = await instance.startAuthentication!();
    await expect.poll(async () => (await instance.getAuthentication!(start.flowId!)).phase, { timeout: 5_000 }).toBe("failed");
    const status = await instance.getAuthentication!(start.flowId!);
    expect(status.message).toBe(message);
    expect(JSON.stringify(status)).not.toContain("secret-token");
    expect((await instance.snapshot()).authenticated).toBe(false);
  });

  it("says plainly when Kimi is missing", async () => {
    const missing = await KimiAgentDriver.create({
      instanceId: "kimi-missing", displayName: "Kimi", enabled: true,
      config: KimiAgentDriver.decodeConfig({ cli: join(home, "no-such-kimi") }),
      environment: { HOME: home, NORDUS_DEVICE_AUTH_FIXTURE: "1" },
    });
    instances.push(missing);
    await expect(missing.startAuthentication!()).rejects.toThrow("Kimi is not installed on this server.");
  });

  it("returns the same live code on a second click, and one sign-in per Kimi home", async () => {
    const one = await kimi("waiting");
    const first = await one.startAuthentication!();
    expect(await one.startAuthentication!()).toEqual(first);
    const sibling = await kimi("waiting");
    await expect(sibling.startAuthentication!()).rejects.toThrow("A Kimi sign-in is already running for this server account.");
    await one.cancelAuthentication!();
    await sibling.cancelAuthentication!().catch(() => {});
  });

  it("approves through the reusable fixture only once its local marker exists", async () => {
    const instance = await kimi("approve");
    const start = await instance.startAuthentication!();
    expect((await instance.getAuthentication!(start.flowId!)).phase).toBe("waiting");
    writeFileSync(join(home, ".nordus-fake-kimi-approved"), "approve fixture only\n");
    await expect.poll(async () => (await instance.getAuthentication!(start.flowId!)).phase, { timeout: 5_000 }).toBe("succeeded");
  });
});
