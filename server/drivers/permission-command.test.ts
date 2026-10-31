import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bindSafetyFloor } from "../safety-floor-gate.ts";
import { acpPermissionCommand, acpShellRequest, permissionCommand } from "./permission-command.ts";

const CWD = "/home/user/work";

describe("acpPermissionCommand", () => {
  it("reads Antigravity's CommandLine/Cwd", () => {
    expect(acpPermissionCommand({
      CommandLine: "ls -la /home/user/workspace/notes/",
      Cwd: "/home/user/.nordus/task-workspaces/fc432790/4b7437fe",
      WaitMsBeforeAsync: 5000,
    }, undefined)).toEqual({
      command: "ls -la /home/user/workspace/notes/",
      cwd: "/home/user/.nordus/task-workspaces/fc432790/4b7437fe",
    });
  });

  it("still reads the lower-case spelling every other agent sends", () => {
    expect(acpPermissionCommand({ command: "npm test", cwd: CWD }, undefined))
      .toEqual({ command: "npm test", cwd: CWD });
  });

  it("falls back to the launch directory when the frame names none", () => {
    expect(acpPermissionCommand({ CommandLine: "ls" }, CWD)).toEqual({ command: "ls", cwd: CWD });
    expect(acpPermissionCommand({ CommandLine: "ls" }, undefined)).toBeUndefined();
  });

  it("refuses two different spellings of the same field", () => {
    expect(acpPermissionCommand({ command: "ls", CommandLine: "rm -rf /", cwd: CWD }, undefined)).toBeUndefined();
    expect(acpPermissionCommand({ CommandLine: "ls", cwd: CWD, Cwd: "/elsewhere" }, undefined)).toBeUndefined();
    expect(acpPermissionCommand({ command: "ls", CommandLine: "ls", cwd: CWD }, undefined))
      .toEqual({ command: "ls", cwd: CWD });
  });

  it("refuses a relative or unusable directory rather than guessing", () => {
    expect(acpPermissionCommand({ CommandLine: "ls", Cwd: "relative/path" }, CWD)).toBeUndefined();
    expect(acpPermissionCommand({ CommandLine: "ls", Cwd: 42 }, CWD)).toBeUndefined();
    expect(acpPermissionCommand({ CommandLine: "", Cwd: CWD }, undefined)).toBeUndefined();
    expect(acpPermissionCommand(null, CWD)).toBeUndefined();
    expect(acpPermissionCommand(["ls"], CWD)).toBeUndefined();
  });
});

describe("permissionCommand", () => {
  it("keeps every byte of the command, including whitespace", () => {
    expect(permissionCommand("  ls   -la  \n", CWD)).toEqual({ command: "  ls   -la  \n", cwd: CWD });
  });

  it("refuses anything that is not a command and an absolute directory", () => {
    expect(permissionCommand("ls", "relative")).toBeUndefined();
    expect(permissionCommand("", CWD)).toBeUndefined();
    expect(permissionCommand("   ", CWD)).toBeUndefined();
    expect(permissionCommand("ls\0", CWD)).toBeUndefined();
    expect(permissionCommand("ls", `${CWD}\0`)).toBeUndefined();
    expect(permissionCommand(undefined, CWD)).toBeUndefined();
  });
});

describe.each([["off", false], ["on", true]] as const)("an ACP shell request, safety floor %s", (_, floorOn) => {
  beforeEach(() => {
    delete process.env.NORDUS_SAFETY_FLOOR;
    bindSafetyFloor(() => ({ safetyFloor: { enabled: floorOn } }), undefined, "linux");
  });
  afterEach(() => bindSafetyFloor(() => ({})));

  it("is the engine's own shell, whole, only when every spelling of its command agrees", () => {
    expect(acpShellRequest(true, { command: "ls" }, CWD)).toMatchObject({ commandLine: "ls", nativeShell: true });
    expect(acpShellRequest(true, { CommandLine: "ls", Cwd: CWD }, CWD)).toMatchObject({ commandLine: "ls", nativeShell: true });
    expect(acpShellRequest(true, { command: "ls", CommandLine: "ls" }, CWD)).not.toHaveProperty("commandsDisagree");
    expect(acpShellRequest(false, { command: "ls" }, CWD)).not.toHaveProperty("nativeShell");
  });

  it("marks spellings that disagree, whatever each one is, and never as the engine's own shell", () => {
    for (const input of [
      { CommandLine: "rm -rf /tmp/x", command: "ls /tmp" },
      { command: "echo '", CommandLine: "git push origin main" },
      { command: "ls /tmp", CommandLine: "cat notes.txt" },
    ]) {
      expect(acpShellRequest(true, input, CWD)).toMatchObject({ commandsDisagree: true });
      expect(acpShellRequest(true, input, CWD)).not.toHaveProperty("nativeShell");
      expect(acpShellRequest(false, input, CWD)).toMatchObject({ commandsDisagree: true });
    }
  });

  it("gives the floor the worst spelling, never the spellings read together", () => {
    const worst = (input: object) => acpShellRequest(true, input, CWD).commandLine;
    expect(worst({ command: "ls /tmp", CommandLine: "sudo rm -rf /" })).toBe(floorOn ? "sudo rm -rf /" : "ls /tmp");
    expect(worst({ command: "sudo rm -rf /", CommandLine: "echo '" })).toBe("sudo rm -rf /");
    expect(worst({ command: "ls /tmp", CommandLine: "echo '" })).toBe(floorOn ? "echo '" : "ls /tmp");
    expect(worst({ command: "echo '", CommandLine: "rm -rf build #'" })).toBe("echo '");
  });
});
