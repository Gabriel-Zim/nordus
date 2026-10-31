import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { removeTempDir } from "../../testing/cleanup.ts";
import { writeLauncher } from "../chrome/wrapper.ts";
import { firstDisplayFor, nativeDir, nativeLauncherScript, nativeScreenOf, nativeTools, posixCksum } from "./display.ts";

const posix = process.platform !== "win32";
const folders: string[] = [];
afterAll(async () => { for (const folder of folders) await removeTempDir(folder); });
const temp = () => { const folder = mkdtempSync(join(tmpdir(), "nordus-native-display-")); folders.push(folder); return folder; };

describe("which display a profile gets", () => {
  it.skipIf(!posix)("computes the same number as the launcher's own cksum", () => {
    for (const text of ["", "a", "/home/nordus/.nordus-lab/agent-browser-profiles/3d7cf82b0e659d09d5f17a340308ba98", "café ☕ profile"]) {
      const system = Number(execFileSync("cksum", { input: text, encoding: "utf8" }).split(" ")[0]);
      expect(posixCksum(text)).toBe(system);
    }
  });

  it("starts at display 100 or above and spreads profiles over 800 numbers", () => {
    const numbers = new Set(["a", "b", "c", "d", "e", "f"].map((name) => firstDisplayFor(`/profiles/${name}`)));
    expect(numbers.size).toBeGreaterThan(1);
    for (const number of numbers) { expect(number).toBeGreaterThanOrEqual(100); expect(number).toBeLessThan(900); }
  });
});

describe("the tools", () => {
  it("are found only on a Linux server that runs a windowed browser and has both, and NORDUS_BROWSER_NATIVE=0 turns them off", () => {
    const bin = temp();
    for (const name of ["Xvfb", "x11vnc"]) { writeFileSync(join(bin, name), "#!/bin/sh\n"); chmodSync(join(bin, name), 0o755); }
    const env = { PATH: bin, NORDUS_BROWSER_HEADED: "1" };
    expect(nativeTools(env, "linux")).toEqual({ xvfb: join(bin, "Xvfb"), x11vnc: join(bin, "x11vnc") });
    expect(nativeTools({ PATH: bin }, "linux")).toBeNull();
    expect(nativeTools(env, "darwin")).toBeNull();
    expect(nativeTools({ ...env, NORDUS_BROWSER_NATIVE: "0" }, "linux")).toBeNull();
    expect(nativeTools({ ...env, PATH: temp() }, "linux")).toBeNull();
  });
});

describe("finding a profile's window", () => {
  it("answers only for the profile that owns the display, once its socket and size exist", async () => {
    const data = temp();
    const dir = nativeDir(data);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "X120.owner"), "/profiles/mine");
    writeFileSync(join(dir, "X121.owner"), "/profiles/other");
    expect(nativeScreenOf(data, "/profiles/mine")).toBeNull();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(join(dir, "X120.sock"), resolve));
    try {
      expect(nativeScreenOf(data, "/profiles/mine")).toBeNull();
      writeFileSync(join(dir, "X120.size"), "1440x900");
      expect(nativeScreenOf(data, "/profiles/mine")).toEqual({ display: 120, socket: join(dir, "X120.sock"), width: 1440, height: 900 });
      expect(nativeScreenOf(data, "/profiles/other")).toBeNull();
      expect(nativeScreenOf(data, "/profiles/nobody")).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe.skipIf(!posix)("the launcher's display step", () => {
  /** A Chrome that writes what it was given, a pgrep that says every display and VNC server already runs, so nothing starts. */
  function run(data: string, args: string[]) {
    const bin = temp();
    const out = join(temp(), "argv");
    writeFileSync(join(bin, "pgrep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const chrome = join(bin, "chrome");
    writeFileSync(chrome, `#!/bin/sh\nprintf '%s\\0' "$@" > "${out}"\nprintf '%s' "$DISPLAY" > "${out}.display"\n`, { mode: 0o755 });
    const launcher = join(bin, "launcher.sh");
    writeLauncher(launcher, {
      chrome, userAgent: "UA", screen: { width: 1440, height: 900 },
      native: { xvfb: "/nonexistent/Xvfb", x11vnc: "/nonexistent/x11vnc", dir: nativeDir(data), width: 1440, height: 900 },
    }, "linux");
    execFileSync(launcher, args, { env: { PATH: `${bin}:/usr/bin:/bin`, DISPLAY: ":99" } });
    return { argv: readFileSync(out, "utf8").split("\0").slice(0, -1), display: readFileSync(`${out}.display`, "utf8") };
  }

  it("gives a profile's Chrome a display of its own and a window that fills it", () => {
    const data = temp();
    const first = run(data, ["--remote-debugging-port=0", "--user-data-dir=/profiles/mine"]);
    expect(first.display).toBe(`:${firstDisplayFor("/profiles/mine")}`);
    expect(first.argv).toContain("--window-position=0,0");
    expect(first.argv).toContain("--window-size=1440,900");
    expect(readFileSync(join(nativeDir(data), `X${firstDisplayFor("/profiles/mine")}.owner`), "utf8")).toBe("/profiles/mine");
    expect(readFileSync(join(nativeDir(data), `X${firstDisplayFor("/profiles/mine")}.size`), "utf8")).toBe("1440x900");
    expect(run(data, ["--user-data-dir=/profiles/mine"]).display).toBe(first.display);
  });

  it("never lets two profiles share a display, even when their numbers collide", () => {
    const data = temp();
    const taken = firstDisplayFor("/profiles/mine");
    mkdirSync(nativeDir(data), { recursive: true });
    writeFileSync(join(nativeDir(data), `X${taken}.owner`), "/profiles/somebody-else");
    const next = run(data, ["--user-data-dir=/profiles/mine"]);
    expect(next.display).not.toBe(`:${taken}`);
    expect(next.display).toBe(`:${taken + 1}`);
  });

  it("leaves a Chrome with no profile on the display it was given", () => {
    const data = temp();
    const plain = run(data, ["--version"]);
    expect(plain.display).toBe(":99");
    expect(plain.argv).toEqual(["--version", "--disable-blink-features=AutomationControlled", "--user-agent=UA", "--screen-info={1440x900}", "--password-store=basic"]);
    expect(existsSync(nativeDir(data))).toBe(false);
  });

  it("starts the display and the VNC server on a Unix socket only the server's user can reach", () => {
    const script = nativeLauncherScript({ xvfb: "/usr/bin/Xvfb", x11vnc: "/usr/bin/x11vnc", dir: "/data/browser/native", width: 1440, height: 900 }).join("\n");
    expect(script).toContain("'/usr/bin/Xvfb' \":$N\" -screen 0 1440x900x24 -nolisten tcp");
    expect(script).toContain("-rfbport 0 -unixsock \"$NDIR/X$N.sock\"");
    expect(script).toContain("chmod 700");
  });
});
