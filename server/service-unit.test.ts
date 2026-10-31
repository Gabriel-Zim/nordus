import { describe, expect, it } from "vitest";

import {
  checkSentinelInstall, launchdPlist, sentinelCommand, sentinelLaunchdPlist, sentinelServicePlan, sentinelSystemdService, sentinelSystemdTimer,
  sentinelUnitCommand, serviceCommand, servicePlan, shippedSentinelCli, systemdUnit, unstableInstallWarning, type ServiceSpec,
} from "./service-unit.ts";

const spec: ServiceSpec = {
  node: "/usr/bin/node",
  script: "/usr/lib/node_modules/nordus/cli.js",
  serveArgs: ["--port", "8799", "--data-dir", "/home/nordus/.nordus", "--domain", "nordus.example.com", "--no-pair"],
  dataDir: "/home/nordus/.nordus",
  user: "nordus",
  home: "/home/nordus",
  bindsLowPorts: true,
  label: "agentada",
};

describe("service units", () => {
  it("runs the same serve command, with strip-types only for a checkout", () => {
    expect(serviceCommand(spec)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/nordus/cli.js", "serve", ...spec.serveArgs]);
    expect(serviceCommand({ ...spec, script: "/srv/Nordus/server/nordus.ts" })[1]).toBe("--experimental-strip-types");
  });

  it("renders a systemd unit that restarts, runs as the user, and grants low ports only for --domain", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain("Description=Nordus (agentada)");
    expect(unit).toContain("User=nordus");
    expect(unit).toContain("Environment=NORDUS_DATA_DIR=/home/nordus/.nordus");
    expect(unit).toContain("ExecStart=/usr/bin/node /usr/lib/node_modules/nordus/cli.js serve --port 8799 --data-dir /home/nordus/.nordus --domain nordus.example.com --no-pair");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("AmbientCapabilities=CAP_NET_BIND_SERVICE");
    expect(unit).toContain("WantedBy=multi-user.target");
    const local = systemdUnit({ ...spec, bindsLowPorts: false, serveArgs: ["--port", "8799", "--data-dir", "/home/nordus/.nordus"] });
    expect(local).not.toContain("CAP_NET_BIND_SERVICE");
    expect(systemdUnit({ ...spec, dataDir: "/home/nordus/My Data", serveArgs: ["--data-dir", "/home/nordus/My Data"] })).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/nordus/cli.js serve --data-dir "/home/nordus/My Data"');
  });

  it("renders a launchd agent that keeps the server alive and logs under the data dir", () => {
    const plist = launchdPlist({ ...spec, home: "/Users/nordus", dataDir: "/Users/nordus/.nordus" });
    expect(plist).toContain("<string>ai.nordus.serve</string>");
    expect(plist).toContain("<string>/usr/bin/node</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>nordus.example.com</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("/Users/nordus/.nordus/logs/service.log");
    expect(launchdPlist({ ...spec, serveArgs: ["--label", "a & b <c>"] })).toContain("<string>a &amp; b &lt;c&gt;</string>");
  });

  it("refuses to point a service at an npx cache, and knows where each platform's file goes", () => {
    expect(unstableInstallWarning("/home/nordus/.npm/_npx/abc123/node_modules/nordus/cli.js")).toMatch(/npm install -g nordus/);
    expect(unstableInstallWarning("/usr/lib/node_modules/nordus/cli.js")).toBeNull();
    const linux = servicePlan("linux", "/home/nordus/.nordus");
    expect(linux?.installed).toBe("/etc/systemd/system/nordus.service");
    expect(linux?.activate.join("\n")).toContain("systemctl enable --now nordus");
    const mac = servicePlan("darwin", "/Users/nordus/.nordus", "/Users/nordus");
    expect(mac?.installed).toBe("/Users/nordus/Library/LaunchAgents/ai.nordus.serve.plist");
    expect(mac?.activate.join("\n")).toContain("launchctl bootstrap gui/$(id -u)");
    expect(servicePlan("win32", "C:\\x")).toBeNull();
  });

  it("renders Sentinel as a launchd agent on an interval, under its own label, logging outside the data dir", () => {
    const out = "/Users/nordus/Library/Application Support/nordus-sentinel";
    const sentinel = { node: "/usr/bin/node", script: "/usr/lib/node_modules/nordus/cli.js", dataDir: "/Users/nordus/.nordus", home: "/Users/nordus", out };
    expect(sentinelCommand(sentinel)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/nordus/cli.js", "sentinel", "--once", "--data-dir", "/Users/nordus/.nordus", "--out", out]);
    expect(sentinelCommand({ ...sentinel, script: "/srv/Nordus/server/nordus.ts" })[1]).toBe("--experimental-strip-types");
    const plist = sentinelLaunchdPlist(sentinel);
    expect(plist).toContain("<string>ai.nordus.sentinel</string>");
    expect(plist).toContain("<key>StartInterval</key>\n\t<integer>120</integer>");
    expect(plist).toContain("<string>sentinel</string>");
    expect(plist).not.toContain("KeepAlive");
    expect(plist).toContain(`<string>${out}/sentinel.log</string>`);
    expect(plist).not.toContain(".nordus/logs");
    const mac = sentinelServicePlan("darwin", out, "/Users/nordus");
    expect(mac?.files).toEqual([{ name: "ai.nordus.sentinel.plist", installed: "/Users/nordus/Library/LaunchAgents/ai.nordus.sentinel.plist" }]);
    // a path with a space is one argument in the printed commands
    expect(mac?.activate[0]).toBe("mkdir -p /Users/nordus/Library/LaunchAgents && cp '/Users/nordus/Library/Application Support/nordus-sentinel/ai.nordus.sentinel.plist' /Users/nordus/Library/LaunchAgents/ai.nordus.sentinel.plist");
    expect(mac?.deactivate[0]).toBe("launchctl bootout gui/$(id -u)/ai.nordus.sentinel");
  });

  it("renders Sentinel as a systemd user timer, with no root", () => {
    const sentinel = { node: "/usr/bin/node", script: "/usr/lib/node_modules/nordus/cli.js", dataDir: "/home/nordus/My Data", home: "/home/nordus", out: "/home/nordus/.local/state/nordus-sentinel" };
    const unit = sentinelSystemdService(sentinel);
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/nordus/cli.js sentinel --once --data-dir "/home/nordus/My Data" --out /home/nordus/.local/state/nordus-sentinel');
    expect(unit).not.toContain("User=");
    expect(sentinelSystemdTimer()).toContain("OnUnitActiveSec=120s");
    expect(sentinelSystemdTimer()).toContain("WantedBy=timers.target");
    const linux = sentinelServicePlan("linux", sentinel.out, "/home/nordus");
    expect(linux?.files.map((file) => file.installed)).toEqual(["/home/nordus/.config/systemd/user/nordus-sentinel.service", "/home/nordus/.config/systemd/user/nordus-sentinel.timer"]);
    expect(linux?.activate[0]).toContain("cp /home/nordus/.local/state/nordus-sentinel/nordus-sentinel.service");
    expect(linux?.activate.join("\n")).toContain("systemctl --user enable --now nordus-sentinel.timer");
    expect(linux?.activate.join("\n")).not.toContain("sudo");
    expect(sentinelServicePlan("win32", "C:\\x")).toBeNull();
  });

  it("finds the CLI the installed desktop app ships, and runs it as Node", () => {
    const app = "/Applications/Nordus.app/Contents";
    const present = new Set([`${app}/MacOS/Nordus`, `${app}/Resources/server/nordus.js`]);
    expect(shippedSentinelCli("darwin", "/Users/nordus", (path) => present.has(path))).toEqual({ node: `${app}/MacOS/Nordus`, script: `${app}/Resources/server/nordus.js` });
    const user = "/Users/nordus/Applications/Nordus.app/Contents";
    expect(shippedSentinelCli("darwin", "/Users/nordus", (path) => path.startsWith(user))?.script).toBe(`${user}/Resources/server/nordus.js`);
    expect(shippedSentinelCli("linux", "/home/nordus", (path) => path.startsWith("/opt/Nordus/"))).toEqual({ node: "/opt/Nordus/nordus", script: "/opt/Nordus/resources/server/nordus.js" });
    // an app with its script missing, or one released before Sentinel, is no CLI for it
    expect(shippedSentinelCli("darwin", "/Users/nordus", (path) => path.endsWith("MacOS/Nordus"))).toBeNull();
    expect(shippedSentinelCli("darwin", "/Users/nordus", (path) => present.has(path), () => false)).toBeNull();
    expect(shippedSentinelCli("win32", "C:\\Users\\nordus", () => true)).toBeNull();

    const spec = { node: `${app}/MacOS/Nordus`, script: `${app}/Resources/server/nordus.js`, dataDir: "/Users/nordus/.nordus", home: "/Users/nordus", out: "/tmp/s", electronRunAsNode: true };
    expect(sentinelLaunchdPlist(spec)).toContain("<key>ELECTRON_RUN_AS_NODE</key>\n\t\t<string>1</string>");
    expect(sentinelSystemdService(spec)).toContain("Environment=ELECTRON_RUN_AS_NODE=1");
    expect(sentinelLaunchdPlist({ ...spec, electronRunAsNode: false })).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("keeps every path one quoted value in the systemd unit, and refuses one no unit can hold", () => {
    const spec = { node: "/usr/bin/node", script: "/srv/nordus/cli.js", dataDir: "/home/nordus/100% $HOME\\", home: "/home/my nordus", out: "/home/my nordus/.local/state/nordus-sentinel" };
    const unit = sentinelSystemdService(spec);
    expect(unit).toContain('Environment="HOME=/home/my nordus"');
    // % is no specifier, $ no variable, and the trailing backslash no continuation
    expect(unit).toContain('"/home/nordus/100%% $$HOME\\\\"');
    expect(sentinelUnitCommand(unit)).toEqual({ node: "/usr/bin/node", script: "/srv/nordus/cli.js" });
    expect(sentinelUnitCommand(sentinelSystemdService({ ...spec, script: "/srv/100% $x/cli.js" }))?.script).toBe("/srv/100% $x/cli.js");
    for (const bad of ["/home/nordus\n[Service]\nExecStartPre=/bin/true", "/home/nordus\r", "/home/\0nordus"]) {
      expect(() => sentinelSystemdService({ ...spec, home: bad })).toThrow(/line break or NUL/);
      expect(() => sentinelLaunchdPlist({ ...spec, dataDir: bad })).toThrow(/line break or NUL/);
    }
  });

  it("reads back what an installed unit runs, and calls it stale when either path is gone", () => {
    const spec = { node: "/opt/node & co/bin/node", script: "/srv/nordus/cli.js", dataDir: "/home/nordus/My Data", home: "/home/nordus", out: "/home/nordus/.local/state/nordus-sentinel" };
    expect(sentinelUnitCommand(sentinelLaunchdPlist(spec))).toEqual({ node: "/opt/node & co/bin/node", script: "/srv/nordus/cli.js" });
    expect(sentinelUnitCommand(sentinelSystemdService(spec))).toEqual({ node: "/opt/node & co/bin/node", script: "/srv/nordus/cli.js" });
    expect(sentinelUnitCommand("[Service]\nType=oneshot\n")).toBeNull();

    const unit = "/home/nordus/.config/systemd/user/nordus-sentinel.service";
    const timer = "/home/nordus/.config/systemd/user/nordus-sentinel.timer";
    const files = new Map([[unit, sentinelSystemdService(spec)]]);
    const fs = (present: string[]) => ({ exists: (path: string) => files.has(path) || present.includes(path), read: (path: string) => files.get(path)! });
    expect(checkSentinelInstall("linux", "/home/nordus", fs([spec.node, spec.script, timer]))).toMatchObject({ status: "ok", unit });
    expect(checkSentinelInstall("linux", "/home/nordus", fs([spec.node, timer]))).toMatchObject({ status: "stale", missing: ["/srv/nordus/cli.js"] });
    // the service without its timer never runs
    expect(checkSentinelInstall("linux", "/home/nordus", fs([spec.node, spec.script]))).toMatchObject({ status: "stale", missing: [timer] });
    expect(checkSentinelInstall("darwin", "/Users/nordus", fs([]))).toEqual({ status: "not_installed", unit: "/Users/nordus/Library/LaunchAgents/ai.nordus.sentinel.plist" });
    files.set(unit, "garbage");
    expect(checkSentinelInstall("linux", "/home/nordus", fs([]))).toEqual({ status: "unreadable", unit });
    expect(checkSentinelInstall("win32", "C:\\Users\\nordus", fs([]))).toEqual({ status: "unsupported" });
  });
});
