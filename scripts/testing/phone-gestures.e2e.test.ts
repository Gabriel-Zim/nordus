// The phone's two gestures on every pushed screen: a drag from the left edge goes back, a pull from the top
// refreshes. Real touch events through the Chrome DevTools protocol, production UI, disposable fixture server.
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
const _LANDSCAPE = { width: 874, height: 402, insets: { top: 0, bottom: 21, left: 47, right: 47 } };

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
    await runControlNordus(["new-channel", "--name", "Sala Teste", "--members", `${pepper.bot.id},${atlas.bot.id}`, "--url", url]);
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
    const _escape = async () => {
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
    const touches = async (points: [number, number][]) => {
      const [first, ...rest] = points;
      await request("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: first![0], y: first![1] }] });
      for (const [x, y] of rest) {
        await request("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      await request("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const edgeSwipe = () => touches([[6, 420], [20, 421], [60, 422], [120, 423], [200, 424], [280, 425], [330, 425]]);
    const pull = (x = 200, from = 260) => touches([[x, from], [x, from + 20], [x, from + 80], [x, from + 160], [x, from + 240], [x, from + 300]]);
    const results: Record<string, unknown> = {};
    const gone = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}) === null`);
    const spun = () => evaluate("document.querySelector('.nb-ptr[data-spinning]') !== null || window.__nbRefreshed === true");
    const watchRefresh = () => evaluate(`(() => {
      window.__nbRefreshed = false;
      const seen = new MutationObserver(() => { if (document.querySelector('.nb-ptr[data-spinning]')) window.__nbRefreshed = true; });
      seen.observe(document.body, { subtree: true, attributes: true, childList: true, attributeFilter: ['data-spinning'] });
      return true;
    })()`);

    await request("Page.enable");
    await request("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('nordus-analytics-opt-out','1');localStorage.setItem('nordus-email-gate','skipped');localStorage.setItem('nordus-advanced-mode','0');" });
    await request("Runtime.enable");
    await request("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await request("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    await request("Emulation.setSafeAreaInsetsOverride", { insets: INSETS });
    await request("Page.navigate", { url });
    await expect.poll(() => evaluate("document.querySelector('aside[data-sidebar] [data-glass-bar]') !== null"), { timeout: 20_000 }).toBe(true);
    await settle();

    // The list refreshes.
    await watchRefresh();
    await pull(200, 260);
    await expect.poll(spun, { timeout: 5_000 }).toBe(true);
    results.listRefresh = true;
    await settle();

    // The conversation: refresh at the top of its history, then back to the list by the edge.
    await expect.poll(() => clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["Pepper"]), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => evaluate("document.querySelector('[data-mobile-stack][data-screen=\\'chat\\']') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await evaluate("document.querySelector('[data-stack-main] main .glass-scroller').scrollTop = 0");
    await watchRefresh();
    await pull(200, 200);
    await expect.poll(spun, { timeout: 5_000 }).toBe(true);
    results.chatRefresh = true;
    await settle();
    // Halfway through the swipe: the list shows underneath, with its rows, and the ‹ travels with the conversation.
    const backBefore = await evaluate("document.querySelector('[data-stack-back]').getBoundingClientRect().left");
    await request("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 6, y: 420 }] });
    for (const x of [20, 60, 110, 160, 200]) {
      await request("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: 421 }] });
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    const midway = await evaluate(`(() => {
      const list = document.querySelector('aside[data-sidebar]');
      const box = list.getBoundingClientRect();
      const style = getComputedStyle(list);
      const row = [...list.querySelectorAll('button, [role=button]')].find(el => el.textContent.includes('Sala Teste'));
      const rowBox = row?.getBoundingClientRect();
      const hit = rowBox ? document.elementFromPoint(Math.max(1, rowBox.left + 20), rowBox.top + rowBox.height / 2) : null;
      return { listLeft: Math.round(box.left), listRight: Math.round(box.right), opacity: style.opacity, visibility: style.visibility,
        rowShown: Boolean(row && hit && list.contains(hit)), back: document.querySelector('[data-stack-back]').getBoundingClientRect().left };
    })()`);
    const image = await request("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${logPath}.gesture-midway.png`, Buffer.from(image.data, "base64"));
    await request("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 330, y: 421 }] });
    await request("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    results.midway = midway as never;
    expect(midway.rowShown).toBe(true);
    expect(midway.opacity).toBe("1");
    expect(midway.visibility).toBe("visible");
    expect(midway.back).toBeGreaterThan(backBefore + 100);
    await expect.poll(() => evaluate("document.querySelector('[data-mobile-stack]').dataset.screen"), { timeout: 5_000 }).toBe("list");
    results.chatBack = true;
    await settle();
    // Nothing of the drag stays inline: the next push starts clean.
    expect(await evaluate("[...document.querySelectorAll('[data-stack-main], aside[data-sidebar], [data-stack-shade]')].map(el => ['transform', 'transition', 'will-change', 'opacity', 'animation'].map(p => el.style.getPropertyValue(p)).join('')).join('')")).toBe("");

    // The bot's profile: refresh, then back to the conversation by the edge.
    await clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["Pepper"]);
    await settle();
    await evaluate("(document.querySelector('[data-chathead-pill] button') ?? document.querySelector('button[data-chathead-pill]')).click()");
    await expect.poll(() => evaluate("document.querySelector('[data-stack-layer]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await watchRefresh();
    await pull(200, 420);
    await expect.poll(spun, { timeout: 5_000 }).toBe(true);
    results.profileRefresh = true;
    await settle();
    await edgeSwipe();
    await expect.poll(() => gone("[data-stack-layer]"), { timeout: 5_000 }).toBe(true);
    expect(await evaluate("document.querySelector('[data-mobile-stack]').dataset.screen")).toBe("chat");
    results.profileBack = true;
    await settle();

    // The room's profile: back by the edge, and from its gallery back to the profile first.
    await click("[data-stack-back]");
    await settle();
    await expect.poll(() => clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["Sala Teste"]), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => evaluate("document.querySelector('[data-room-pill]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await click("[data-room-pill]");
    await expect.poll(() => evaluate("document.querySelector('[data-room-info]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await click('[data-room-info] [data-room-nav="gallery"], [data-room-info] [data-room-nav]');
    await settle();
    if (await evaluate("document.querySelector('[data-room-info] [data-layer-subback]') !== null")) {
      await edgeSwipe();
      await expect.poll(() => gone("[data-room-info] [data-layer-subback]"), { timeout: 5_000 }).toBe(true);
      results.roomSubBack = true;
      await settle();
    }
    await edgeSwipe();
    await expect.poll(() => gone("[data-room-info]"), { timeout: 5_000 }).toBe(true);
    results.roomBack = true;
    await settle();

    // The alerts over the list: refresh, back by the edge.
    await click("[data-stack-back]");
    await settle();
    await click("aside[data-sidebar] [data-header-notifications]");
    await expect.poll(() => evaluate("document.querySelector('[data-notifications-panel]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await watchRefresh();
    await pull(200, 300);
    await expect.poll(spun, { timeout: 5_000 }).toBe(true);
    results.alertsRefresh = true;
    await settle();
    await edgeSwipe();
    await expect.poll(() => gone("[data-notifications-panel]"), { timeout: 5_000 }).toBe(true);
    results.alertsBack = true;

    // The ‹ goes back exactly one screen: list → room → details → ‹ (room) → ‹ (list), and the same with a bot.
    const screen = () => evaluate("document.querySelector('[data-mobile-stack]').dataset.screen");
    const backOne = async (owner: string) => evaluate(`(() => {
      const button = [...document.querySelectorAll('${owner} button[data-ios-glass-button]')].find(el => el.getBoundingClientRect().width > 0);
      button?.click();
      return Boolean(button);
    })()`);
    await settle();
    if (await screen() !== "list") await click("[data-stack-back]");
    await settle();
    await expect.poll(() => clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["Sala Teste"]), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => evaluate("document.querySelector('[data-room-pill]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await click("[data-room-pill]");
    await expect.poll(() => evaluate("document.querySelector('[data-room-info]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    expect(await backOne("[data-room-info]")).toBe(true);
    await expect.poll(() => gone("[data-room-info]"), { timeout: 5_000 }).toBe(true);
    expect(await screen()).toBe("chat");
    expect(await evaluate("document.querySelector('[data-room-pill]') !== null")).toBe(true);
    await click("[data-stack-back]");
    await expect.poll(screen, { timeout: 5_000 }).toBe("list");
    results.roomTapsOneScreen = true;
    await settle();
    await clickText('aside[data-sidebar] button, aside[data-sidebar] [role="button"]', ["Pepper"]);
    await expect.poll(screen, { timeout: 5_000 }).toBe("chat");
    await settle();
    await evaluate("(document.querySelector('[data-chathead-pill] button') ?? document.querySelector('button[data-chathead-pill]')).click()");
    await expect.poll(() => evaluate("document.querySelector('[data-stack-layer]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    expect(await backOne("[data-stack-layer]")).toBe(true);
    await expect.poll(() => gone("[data-stack-layer]"), { timeout: 5_000 }).toBe(true);
    expect(await screen()).toBe("chat");
    await click("[data-stack-back]");
    await expect.poll(screen, { timeout: 5_000 }).toBe("list");
    results.botTapsOneScreen = true;

    writeFileSync(`${logPath}.gestures.json`, JSON.stringify(results, null, 2));
  } finally {
    cdp?.close();
    if (chrome) await waitForExit(chrome, { signal: "SIGTERM" });
    await fixture?.close();
  }
}, 660_000);
