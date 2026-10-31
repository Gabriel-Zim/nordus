// Phone layout from edge to edge, as in the Nordus iPhone app: content runs under the clock and the home indicator,
// while the controls stay inside the safe area. Production UI build, disposable profile and fixture server.
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

(enabled ? it : it.skip)("runs the phone screens from edge to edge with controls inside the safe areas", async () => {
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
    const shot = async (name: string) => {
      const image = await request("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${logPath}.phone-${name}.png`, Buffer.from(image.data, "base64"));
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 700));
    await request("Page.enable");
    await request("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('nordus-analytics-opt-out','1');localStorage.setItem('nordus-email-gate','skipped');" });
    await request("Runtime.enable");
    await request("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await request("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true });
    await request("Emulation.setSafeAreaInsetsOverride", { insets: INSETS });
    await request("Page.navigate", { url });
    const composer = '[data-stack-main] main textarea';
    const backButton = "[data-stack-back]";
    const openPepper = `(() => {
      if (document.querySelector('[data-mobile-stack][data-screen="chat"]') && document.querySelector('${composer}')) return true;
      const row = [...document.querySelectorAll('aside[data-sidebar] button, aside[data-sidebar] [role="button"], aside[data-sidebar] a')].find(el => el.textContent.includes('Pepper'));
      row?.click();
      return false;
    })()`;
    try {
      await expect.poll(() => evaluate(openPepper), { timeout: 30_000, interval: 1_000 }).toBe(true);
    } catch (error) {
      await shot("falha");
      writeFileSync(`${logPath}.phone-falha.txt`, String(await evaluate("location.href + '\\n' + document.body.innerText.slice(0, 3000)")));
      console.log(`Phone failure evidence: ${logPath}.phone-falha.png`);
      throw error;
    }
    for (let i = 1; i <= 6; i += 1) {
      await evaluate(`document.querySelector('${composer}').focus()`);
      await request("Input.insertText", { text: `Mensagem ${i}: uma linha mais longa para a conversa encher a tela e rolar por baixo do relógio.` });
      await request("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await request("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await expect.poll(() => evaluate(`document.body.textContent.includes('Mensagem ${i}:')`), { timeout: 15_000 }).toBe(true);
    }
    await evaluate("document.activeElement?.blur()");
    await settle();

    const chat = await evaluate(`(() => {
      const rect = (el) => el ? el.getBoundingClientRect() : { top: NaN, bottom: NaN };
      const root = getComputedStyle(document.getElementById('root'));
      const scroller = rect(document.querySelector('[data-stack-main] main .glass-scroller'));
      const back = rect(document.querySelector('${backButton}'));
      const pill = rect(document.querySelector('[data-chathead-pill]'));
      const input = rect(document.querySelector('${composer}'));
      return { rootTop: parseFloat(root.paddingTop), rootBottom: parseFloat(root.paddingBottom),
        scrollerTop: scroller.top, scrollerBottom: scroller.bottom, backTop: back.top, pillTop: pill.top, inputBottom: input.bottom };
    })()`);
    expect(chat.rootTop).toBe(0);
    expect(chat.rootBottom).toBe(0);
    expect(chat.scrollerTop).toBe(0);
    expect(chat.scrollerBottom).toBe(HEIGHT);
    expect(chat.backTop).toBeGreaterThanOrEqual(INSETS.top);
    expect(chat.pillTop).toBeGreaterThanOrEqual(INSETS.top);
    expect(chat.inputBottom).toBeLessThanOrEqual(HEIGHT - INSETS.bottom);
    await evaluate("document.querySelector('[data-stack-main] main .glass-scroller').scrollTop = 0");
    await settle();
    await shot("chat-top");
    await evaluate("(s => s.scrollTop = s.scrollHeight)(document.querySelector('[data-stack-main] main .glass-scroller'))");
    await settle();
    await shot("chat");

    await evaluate("(document.querySelector('[data-chathead-pill] button') ?? document.querySelector('button[data-chathead-pill]')).click()");
    await expect.poll(() => evaluate("document.querySelector('[data-stack-layer]') !== null"), { timeout: 15_000 }).toBe(true);
    await settle();
    const pushed = await evaluate(`(() => {
      const layer = document.querySelector('[data-stack-layer]').getBoundingClientRect();
      const main = document.querySelector('[data-stack-main]').getBoundingClientRect();
      return { layerLeft: layer.left, layerTop: layer.top, layerBottom: layer.bottom, mainLeft: main.left };
    })()`);
    await shot("profile");
    expect(pushed.layerLeft).toBe(0);
    expect(pushed.layerTop).toBe(0);
    expect(pushed.layerBottom).toBe(HEIGHT);
    await request("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await request("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await expect.poll(() => evaluate("document.querySelector('[data-stack-layer]') === null"), { timeout: 10_000 }).toBe(true);
    await evaluate(`document.querySelector('${composer}').focus()`);
    await request("Input.insertText", { text: "Um texto mais longo para a pílula de vidro crescer para cima e o botão de voz virar enviar." });
    await settle();
    const typing = await evaluate(`(() => {
      const send = document.querySelector('[data-composer-send]');
      const pill = document.querySelector('[data-composer-row]').getBoundingClientRect();
      return { send: send !== null, voice: document.querySelector('[data-call-button="composer"]') !== null, pillHeight: pill.height, pillBottom: pill.bottom };
    })()`);
    await shot("typing");
    expect(typing.send).toBe(true);
    expect(typing.voice).toBe(false);
    expect(typing.pillHeight).toBeGreaterThan(44);
    expect(typing.pillBottom).toBeLessThanOrEqual(HEIGHT - INSETS.bottom);
    await evaluate(`(t => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); t.blur(); })(document.querySelector('${composer}'))`);
    await settle();
    await evaluate(`document.querySelector('${backButton}').click()`);
    await settle();
    const list = await evaluate(`(() => {
      const aside = document.querySelector('aside[data-sidebar]');
      const scroller = aside.querySelector('.glass-scroller').getBoundingClientRect();
      const controls = [...aside.querySelectorAll('[data-glass-bar] button, [data-glass-bar] input')].map(el => el.getBoundingClientRect()).filter(r => r.height > 0);
      return { scrollerTop: scroller.top, scrollerBottom: scroller.bottom,
        controlsTop: Math.min(...controls.map(r => r.top)), controlsBottom: Math.max(...controls.map(r => r.bottom)) };
    })()`);
    expect(list.scrollerTop).toBe(0);
    expect(list.scrollerBottom).toBe(HEIGHT);
    expect(list.controlsTop).toBeGreaterThanOrEqual(INSETS.top);
    expect(list.controlsBottom).toBeLessThanOrEqual(HEIGHT - INSETS.bottom);
    await shot("list");

    const bell = await evaluate(`(() => { const b = document.querySelector('aside[data-sidebar] [data-header-notifications]'); if (!b) return false; b.click(); return true; })()`);
    if (bell) {
      await settle();
      const alerts = await evaluate(`(() => {
        const panel = document.querySelector('[data-notifications-panel]').getBoundingClientRect();
        const head = [...document.querySelectorAll('[data-notifications-head] button')].map(el => el.getBoundingClientRect()).filter(r => r.height > 0);
        return { panelTop: panel.top, panelBottom: panel.bottom, headTop: Math.min(...head.map(r => r.top)) };
      })()`);
      expect(alerts.panelTop).toBe(0);
      expect(alerts.panelBottom).toBe(HEIGHT);
      expect(alerts.headTop).toBeGreaterThanOrEqual(INSETS.top);
      await shot("notifications");
    }
    // The sequence that left the bot's profile shifted left: room profile, close, list, bot, profile.
    const openRow = (name: string) => evaluate(`(() => {
      const row = [...document.querySelectorAll('aside[data-sidebar] button, aside[data-sidebar] [role="button"], aside[data-sidebar] a')].find(el => el.textContent.includes('${name}'));
      row?.click();
      return Boolean(row);
    })()`);
    if (await evaluate("document.querySelector('[data-notifications-panel]') !== null")) {
      await request("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await request("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await settle();
    }
    await expect.poll(() => openRow("Sala Teste"), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => evaluate("document.querySelector('[data-room-pill]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await evaluate("document.querySelector('[data-room-pill]').click()");
    await expect.poll(() => evaluate("document.querySelector('[data-room-info]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await evaluate("document.querySelector('[data-room-info] [data-layer-close]').click()");
    await settle();
    await evaluate(`document.querySelector('${backButton}').click()`);
    await settle();
    await expect.poll(() => openRow("Pepper"), { timeout: 10_000 }).toBe(true);
    await settle();
    await evaluate("(document.querySelector('[data-chathead-pill] button') ?? document.querySelector('button[data-chathead-pill]')).click()");
    await expect.poll(() => evaluate("document.querySelector('[data-stack-layer]') !== null"), { timeout: 10_000 }).toBe(true);
    await settle();
    await settle();
    const reopened = await evaluate(`(() => {
      const scrolled = [...document.querySelectorAll('#root, #root *')].filter(el => el.scrollLeft !== 0).map(el => el.tagName + [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => '[' + a.name + ']').join(''));
      const layer = document.querySelector('[data-stack-layer]').getBoundingClientRect();
      return { scrolled, layerLeft: Math.round(layer.left), layerRight: Math.round(layer.right) };
    })()`);
    await shot("profile-again");
    expect(reopened.scrolled).toEqual([]);
    expect(reopened.layerLeft).toBe(0);
    expect(reopened.layerRight).toBe(WIDTH);
    writeFileSync(`${logPath}.phone.json`, JSON.stringify({ chat, pushed, typing, list, bell, reopened }, null, 2));
    console.log(`Phone evidence: ${logPath}.phone-*.png`);
  } finally {
    cdp?.close();
    if (chrome) await waitForExit(chrome, { signal: "SIGTERM" });
    await fixture?.close();
  }
}, 660_000);
