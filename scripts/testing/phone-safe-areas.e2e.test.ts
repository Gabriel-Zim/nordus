// Every overlay on a phone keeps its controls out of the safe areas: nothing tappable under the clock, the island,
// the home indicator or a landscape notch. Production UI build, disposable profile and fixture server.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus, type VerificationServer } from "../control-nordus.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { ensureUiBrowser } from "./control-nordus-ui.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const enabled = process.env.NORDUS_UI_E2E === "1";
const build = process.env.NORDUS_WEB_APP_BUILD || join(root, "dist");
const WIDTH = 402;
const HEIGHT = 874;
const INSETS = { top: 62, bottom: 34, left: 0, right: 0 };
const LANDSCAPE = { width: 874, height: 402, insets: { top: 0, bottom: 21, left: 47, right: 47 } };

async function connect(url: string) {
  const socket = new WebSocket(url);
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let next = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Fixture Chrome connection failed")), { once: true });
  });
  return {
    close: () => socket.close(),
    request(method: string, params: unknown = {}, sessionId?: string): Promise<any> {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture Chrome ${method} timed out`)); }, 30_000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

(enabled ? it : it.skip)("keeps every control of every overlay inside the safe areas", async () => {
  if (!existsSync(join(build, "index.html"))) throw new Error("Run pnpm build before NORDUS_UI_E2E=1 phone qualification");
  let fixture: VerificationServer | undefined;
  let chrome: ChildProcess | undefined;
  let cdp: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    const tools = await ensureUiBrowser();
    if (!tools.chrome) throw new Error("This recipe needs the pinned Chrome for Testing");
    fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], undefined, build);
    const { url, dataDir, logPath } = fixture.info;
    const pepper = await runControlNordus(["new-bot", "--name", "Pepper", "--url", url]) as { bot: { id: string } };
    const atlas = await runControlNordus(["new-bot", "--name", "Atlas", "--url", url]) as { bot: { id: string } };
    await runControlNordus(["new-channel", "--name", "@AVERYMERCER.AI HQ", "--members", `${pepper.bot.id},${atlas.bot.id}`, "--url", url]);
    const profile = join(dataDir, "chrome");
    mkdirSync(profile, { recursive: true });
    chrome = spawn(tools.chrome, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--password-store=basic", "--use-mock-keychain", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
      env: { PATH: process.env.PATH, HOME: dataDir, USERPROFILE: dataDir },
      stdio: "ignore",
    });
    const portFile = join(profile, "DevToolsActivePort");
    await expect.poll(() => existsSync(portFile), { timeout: 20_000 }).toBe(true);
    const [port, endpoint] = readFileSync(portFile, "utf8").trim().split("\n");
    cdp = await connect(`ws://127.0.0.1:${port}${endpoint}`);
    const target = await cdp.request("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.request("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const request = (method: string, params: unknown = {}) => cdp!.request(method, params, attached.sessionId as string);
    const evaluate = async (expression: string) => {
      const value = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
      return value.result.value;
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 700));
    const escape = async () => {
      await request("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await request("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await settle();
    };
    const click = (selector: string) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.click(); return Boolean(el); })()`);
    const clickText = (selector: string, words: string[]) => evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => ${JSON.stringify(words)}.some(word => node.textContent.includes(word)));
      el?.click();
      return Boolean(el);
    })()`);
    const offenders: { screen: string; control: string; box: number[] }[] = [];
    // Every control a finger can reach on top of the page must sit between the bands.
    const check = async (screen: string, view: { width: number; height: number; insets: typeof INSETS }) => {
      const found = await evaluate(`(() => {
        const v = ${JSON.stringify(view)};
        const out = [];
        for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=menuitem], [role=option], [role=tab], [role=switch]')) {
          // What shows of the control: its box clipped by every scrolling or clipping ancestor.
          const box = el.getBoundingClientRect();
          const r = { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: 0, height: 0 };
          for (let up = el.parentElement; up; up = up.parentElement) {
            const style = getComputedStyle(up);
            if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
            const clip = up.getBoundingClientRect();
            r.left = Math.max(r.left, clip.left); r.top = Math.max(r.top, clip.top);
            r.right = Math.min(r.right, clip.right); r.bottom = Math.min(r.bottom, clip.bottom);
          }
          r.width = r.right - r.left; r.height = r.bottom - r.top;
          if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= v.height || r.right <= 0 || r.left >= v.width) continue;
          if (el.closest('[inert], [aria-hidden=true]')) continue;
          const x = Math.min(v.width - 1, Math.max(0, r.left + r.width / 2));
          const y = Math.min(v.height - 1, Math.max(0, r.top + r.height / 2));
          const hit = document.elementFromPoint(x, y);
          if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue;
          const crosses = r.top < v.insets.top || r.bottom > v.height - v.insets.bottom || r.left < v.insets.left || r.right > v.width - v.insets.right;
          if (crosses) out.push({ control: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), box: [r.left, r.top, r.right, r.bottom].map(Math.round) });
        }
        return out;
      })()`) as { control: string; box: number[] }[];
      offenders.push(...found.map(item => ({ screen, ...item })));
      const image = await request("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${logPath}.safe-${screen}.png`, Buffer.from(image.data, "base64"));
    };
    const portrait = { width: WIDTH, height: HEIGHT, insets: INSETS };

    await request("Page.enable");
    await request("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('nordus-analytics-opt-out','1');localStorage.setItem('nordus-email-gate','skipped');localStorage.setItem('nordus-advanced-mode','0');" });
    await request("Runtime.enable");
    await request("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await request("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    await request("Emulation.setSafeAreaInsetsOverride", { insets: INSETS });
    await request("Page.navigate", { url });
    await expect.poll(() => evaluate("document.querySelector('aside[data-sidebar] [data-glass-bar]') !== null"), { timeout: 20_000 }).toBe(true);
    await settle();
    await check("list", portrait);

    await click("[data-profile-avatar]");
    await settle();
    await check("profile-menu", portrait);
    if (await clickText('[role=menuitem]', ["Configurações", "Settings"])) {
      await settle();
      await check("settings", portrait);
      await escape();
    } else await escape();

    if (await click('aside[data-sidebar] [data-glass-bar="bottom"] button[aria-pressed]')) {
      await settle();
      await check("apps", portrait);
      await escape();
    }

    await expect.poll(() => clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["Pepper"]), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => evaluate("document.querySelector('[data-stack-main] main textarea') !== null"), { timeout: 15_000 }).toBe(true);
    await settle();
    await check("chat", portrait);

    if (await click("[data-composer-plus]")) {
      await settle();
      await check("composer-plus", portrait);
      await escape();
    }
    if (await click('[data-testid="chat-more"]')) {
      await settle();
      await check("chat-more", portrait);
      await escape();
    }

    await evaluate("(document.querySelector('[data-chathead-pill] button') ?? document.querySelector('button[data-chathead-pill]')).click()");
    await expect.poll(() => evaluate("document.querySelector('[data-stack-layer]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await check("bot-profile", portrait);
    expect(await click("[data-simple-avatar]")).toBe(true);
    await expect.poll(() => evaluate("document.querySelector('[data-avatar-sheet]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await check("avatar-editor", portrait);
    await escape();
    if (await click('[data-stack-layer] button[aria-haspopup="listbox"]')) {
      await settle();
      await check("model-select", portrait);
      await escape();
    }
    await escape();

    await click("[data-stack-back]");
    await settle();
    await expect.poll(() => clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["@AVERYMERCER.AI HQ"]), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => evaluate("document.querySelector('[data-room-pill]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await check("room", portrait);
    // The room's capsule: the whole name, no search or bell beside it, clear of ‹ and ⋯.
    const capsule = () => evaluate(`(() => {
      const name = document.querySelector('[data-room-pill] [data-fit-name]');
      const pill = document.querySelector('[data-room-pill]').getBoundingClientRect();
      const back = document.querySelector('[data-stack-back]').getBoundingClientRect();
      const more = document.querySelector('[data-room-more]').getBoundingClientRect();
      const shown = (sel) => { const el = document.querySelector('[data-roomhead-controls] ' + sel); return Boolean(el && el.getBoundingClientRect().width > 0); };
      return { whole: name.scrollWidth <= name.clientWidth + 1, font: getComputedStyle(name).fontSize,
        clear: pill.left >= back.right && pill.right <= more.left, find: shown('[data-room-find]'), bell: shown('[data-header-notifications]') };
    })()`);
    const roomHead = await capsule();
    expect(roomHead).toMatchObject({ whole: true, clear: true, find: false, bell: false });
    await click("[data-room-pill]");
    await settle();
    await check("room-profile", portrait);
    await click("[data-room-info] [data-layer-close]");
    await settle();
    await click("[data-stack-back]");
    await settle();
    if (await click("aside[data-sidebar] [data-header-notifications]")) {
      await settle();
      await check("notifications", portrait);
      await escape();
    }

    // iPhone on its side: the island and the corners take 47 pt on each side, the home indicator 21 pt below.
    await request("Emulation.setDeviceMetricsOverride", { width: LANDSCAPE.width, height: LANDSCAPE.height, deviceScaleFactor: 2, mobile: true });
    await request("Emulation.setSafeAreaInsetsOverride", { insets: LANDSCAPE.insets });
    await settle();
    await check("landscape", LANDSCAPE);

    // iPhone SE: no island, a 20 pt status bar and no home indicator.
    const se = { width: 375, height: 667, insets: { top: 20, bottom: 0, left: 0, right: 0 } };
    await request("Emulation.setDeviceMetricsOverride", { width: se.width, height: se.height, deviceScaleFactor: 2, mobile: true });
    await request("Emulation.setSafeAreaInsetsOverride", { insets: se.insets });
    await settle();
    if (await click("[data-notifications-panel] button[data-ios-glass-button]")) await settle();
    await check("se-list", se);
    if (await clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["@AVERYMERCER.AI HQ"])) {
      await settle();
      await expect.poll(() => evaluate("document.querySelector('[data-mobile-stack]').dataset.screen"), { timeout: 5_000 }).toBe("chat");
      await check("se-room", se);
      const seHead = await capsule();
      expect(seHead.clear).toBe(true);
      expect(seHead.find || seHead.bell).toBe(false);
      await click("[data-stack-back]");
      await settle();
    }
    if (await clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["Pepper"])) {
      await settle();
      await check("se-chat", se);
    }

    writeFileSync(`${logPath}.safe.json`, JSON.stringify(offenders, null, 2));
    expect(offenders).toEqual([]);
  } finally {
    cdp?.close();
    if (chrome) await waitForExit(chrome, { signal: "SIGTERM" });
    await fixture?.close();
  }
}, 660_000);
