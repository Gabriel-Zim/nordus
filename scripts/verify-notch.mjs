// Disposable real-Electron check of the notch window. No server, workspace, credentials or network.
// Quiet, nothing appears on screen:  node scripts/verify-notch.mjs
// On screen, to watch and tap:       node scripts/verify-notch.mjs --show
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const flag = "--nordus-notch-fixture";
const show = process.argv.includes("--show");

if (!process.versions.electron) {
  if (process.platform !== "darwin") {
    console.log("Skipped: the notch is macOS only.");
    process.exit(0);
  }
  const output = mkdtempSync(join(tmpdir(), "nordus-notch-evidence-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)("electron"), [fileURLToPath(import.meta.url), flag, output, ...(show ? ["--show"] : [])], { env, stdio: "inherit" });
  const watchdog = setTimeout(() => child.kill(), show ? 120_000 : 60_000);
  const code = await new Promise((resolve) => {
    child.on("error", (error) => { console.error(error); resolve(1); });
    child.on("exit", (value) => resolve(value ?? 1));
  });
  clearTimeout(watchdog);
  console.log(`Notch evidence: ${output}`);
  if (code !== 0 || JSON.parse(readFileSync(join(output, "receipt.json"), "utf8")).passed !== true) {
    console.error("Notch fixture failed");
    process.exit(1);
  }
} else {
  const output = process.argv[process.argv.indexOf(flag) + 1];
  const { app, BrowserWindow, ipcMain, screen } = await import("electron");
  const localOrigin = createRequire(import.meta.url)("../electron/local-origin.cjs");
  const { createNotch } = await import("../electron/notch.mjs");
  const profile = join(output, "profile");
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
  app.setActivationPolicy("accessory");
  writeFileSync(join(profile, "notch.json"), JSON.stringify({ enabled: true }));

  const labels = { done: "Pronto", approve: "Aprovar", decline: "Recusar", open: "Abrir no app", several: "{count} agentes" };
  const agent = (name, status = "Gerando imagem") => ({ id: name.toLowerCase(), name, color: "#377fe6", status, botId: `bot-${name}`, threadId: `thread-${name}` });
  const approval = (name, extra = {}) => ({ id: `thread-${name}:request-${name}`, name, color: "#d94b52", header: `${name} pede sua aprovação`, text: "Quero publicar a página do artigo no site.", decidable: true, botId: `bot-${name}`, threadId: `thread-${name}`, ...extra });

  let passed = true;
  const check = (name, ok, detail) => {
    if (!ok) passed = false;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  };
  const hold = (ms) => delay(show ? ms : 0);

  void app.whenReady().then(async () => {
    try {
      const origin = "http://127.0.0.1:1";
      localOrigin.setLocalOrigin(origin);
      const handlers = new Map();
      const bridge = {
        handle: (channel, fn) => { handlers.set(channel, fn); ipcMain.handle(channel, fn); },
        on: (channel, fn) => ipcMain.on(channel, fn),
        removeHandler: (channel) => ipcMain.removeHandler(channel),
        removeListener: (channel, fn) => ipcMain.removeListener(channel, fn),
      };
      const instances = [];
      class Window extends BrowserWindow {
        constructor(options) { super(options); instances.push(this); }
        showInactive() { if (show) super.showInactive(); }
      }
      const decisions = [];
      const links = [];
      const notch = createNotch({
        ipcMain: bridge, screen, BrowserWindow: Window, localOnly: localOrigin.localOnly, userData: profile,
        sendDecision: (payload) => { decisions.push(payload); return true; },
        openLink: (link) => links.push(link),
        log: (line) => console.log(`LOG ${line}`),
      });
      notch.start();

      const localEvent = { sender: Object.assign(new EventEmitter(), {}), senderFrame: { url: `${origin}/` } };
      const publish = (feed) => handlers.get("notch:feed")(localEvent, { labels, ...feed });
      const state = handlers.get("notch:state")(localEvent);
      const display = state.display === "notch" ? screen.getAllDisplays().find((entry) => entry.internal) : screen.getPrimaryDisplay();
      console.log(`Display ${display.bounds.width}x${display.bounds.height}, menu bar ${display.workArea.y - display.bounds.y}, state ${JSON.stringify(state)}`);

      check("a good snapshot is accepted", publish({ agents: [agent("Maya")], approvals: [] }) === true);
      await delay(1200);
      const win = instances.find((entry) => !entry.isDestroyed());
      check("the notch window exists once an agent has been working a moment", Boolean(win));
      if (!win) throw new Error("no notch window");
      const dom = (code) => win.webContents.executeJavaScript(code);
      const read = (id) => dom(`document.getElementById(${JSON.stringify(id)}).textContent`);
      const snap = async (name) => writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());

      check("it cannot take focus", win.isFocusable() === false);
      check("it is always on top and on every Space", win.isAlwaysOnTop() === true && win.isVisibleOnAllWorkspaces() === true);
      check("it is not resizable or movable", win.isResizable() === false && win.isMovable() === false);
      const compact = win.getBounds();
      console.log(`Bounds working ${JSON.stringify(compact)}`);
      const top = state.display === "notch" ? display.bounds.y : display.workArea.y + 6;
      const anchor = state.display === "notch" ? compact.x + 58 + 106 : compact.x + compact.width / 2;
      check("it sits at the top of the display", compact.y === top, compact);
      check("its middle is the middle of the display, where the notch is", Math.abs(anchor - (display.bounds.x + display.bounds.width / 2)) <= 1, compact);
      check("the page shows the avatar and the status", (await read("text")) === "Gerando imagem" && (await dom("document.querySelector('.avatar')?.textContent")) === "M");
      check("the page has no Node and only its three functions", (await dom("typeof require + typeof process")) === "undefinedundefined" && JSON.stringify(await dom("Object.keys(window.notchWindow).sort()")) === JSON.stringify(["decide", "onView", "open"]));
      check("inline script is refused by the page policy", (await dom(`new Promise((resolve) => { const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.head.append(s); setTimeout(() => resolve(window.__x === 1), 50); })`)) === false);
      await snap("working");
      await hold(3000);

      publish({ agents: [agent("Maya")], approvals: [approval("Maya")] });
      await delay(150);
      const early = await dom("(() => { const b = document.getElementById('approve'); b.click(); return b.disabled; })()");
      await dom("window.notchWindow.decide('thread-Maya:request-Maya', 'approve')");
      await delay(100);
      check("a tap in the first moments is not an answer, from the page or from the window", early === true && decisions.length === 0, { early, decisions });
      await delay(350);
      const expanded = win.getBounds();
      check("an approval grows the window downward from the same top", expanded.y === compact.y && expanded.height > compact.height, expanded);
      check("the plain sentence and both buttons are shown", (await read("sentence")) === "Quero publicar a página do artigo no site." && (await dom(`(() => { const h = (id) => document.getElementById(id).hidden; return [!h('approve'), !h('decline'), h('open')].join(); })()`)) === "true,true,true");
      await snap("approval");
      if (show) {
        console.log("Tap Aprovar or Recusar on the notch (waiting 15 s).");
        for (let waited = 0; waited < 15_000 && decisions.length === 0; waited += 250) await delay(250);
      }
      if (decisions.length === 0) {
        await delay(800);
        await dom("document.getElementById('approve').click()");
      }
      await delay(300);
      check("a tap reaches the app as one decision from the notch window", decisions.length === 1 && decisions[0].id === "thread-Maya:request-Maya" && ["approve", "decline"].includes(decisions[0].decision), decisions);
      await dom("document.getElementById('decline').click()");
      await dom("document.getElementById('approve').click()");
      await delay(200);
      check("the buttons are locked after a tap", decisions.length === 1, decisions);

      publish({ agents: [agent("Maya")], approvals: [approval("Maya", { id: "thread-Maya:request-2", decidable: false })] });
      await delay(500);
      check("a request that must be decided in the app only offers to open it", (await dom(`(() => { const h = (id) => document.getElementById(id).hidden; return [h('approve'), h('decline'), !h('open')].join(); })()`)) === "true,true,true");
      await snap("critical");
      await hold(2500);
      await delay(800);
      await dom("document.getElementById('open').click()");
      await delay(300);
      check("opening asks for that conversation", links.at(-1) === "nordus://thread/thread-Maya?bot=bot-Maya", links);

      publish({ agents: [agent("Maya"), agent("Caio"), agent("Rita")], approvals: [] });
      await delay(700);
      check("several agents show a count and stacked avatars", (await read("text")) === "3 agentes" && (await dom("document.querySelectorAll('.avatar').length")) === 3);
      await snap("several");
      await hold(3000);

      publish({ agents: [], approvals: [] });
      await delay(400);
      check("the end says Pronto", (await read("text")) === "Pronto");
      await snap("done");
      await delay(2600);
      check("Pronto goes away by itself", win.isVisible() === false);

      const off = handlers.get("notch:set-enabled")(localEvent, false);
      check("turning it off is remembered and removes the window", off.enabled === false && JSON.parse(readFileSync(join(profile, "notch.json"), "utf8")).enabled === false && BrowserWindow.getAllWindows().length === 0, off);
      notch.close();
    } catch (error) {
      passed = false;
      console.log(`ERROR ${error?.stack ?? error}`);
    }
    writeFileSync(join(output, "receipt.json"), JSON.stringify({ passed }));
    console.log(passed ? "ALL PASSED" : "FAILED");
    app.exit(passed ? 0 : 1);
  });
}
