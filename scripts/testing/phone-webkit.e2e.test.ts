// The phone conversation in both engines the iPhone app can meet: WebKit (the app's WKWebView) and Chromium.
// Production UI build, disposable fixture server. Screenshots go to NORDUS_PHONE_PROOF_DIR, or next to the fixture log.
// The test setup swaps HOME, so point PLAYWRIGHT_BROWSERS_PATH at the browsers `playwright install` downloaded.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus, type VerificationServer } from "../control-nordus.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const enabled = process.env.NORDUS_UI_E2E === "1";
const build = process.env.NORDUS_WEB_APP_BUILD || join(root, "dist");
const WIDTH = 390;
const HEIGHT = 844;
const SCROLLER = "[data-stack-main] main .glass-scroller";
const COMPOSER = "[data-stack-main] main textarea";

(enabled ? it : it.skip)("keeps the phone conversation steady in WebKit and Chromium", async () => {
  if (!existsSync(join(build, "index.html"))) throw new Error("Run pnpm build before NORDUS_UI_E2E=1 phone qualification");
  const { chromium, webkit } = await import("playwright");
  let fixture: VerificationServer | undefined;
  try {
    fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], undefined, build);
    const { url, logPath } = fixture.info;
    const proofDir = process.env.NORDUS_PHONE_PROOF_DIR || `${logPath}.phone-engines`;
    mkdirSync(proofDir, { recursive: true });
    const pepper = await runControlNordus(["new-bot", "--name", "Pepper", "--url", url]) as { bot: { id: string } };
    const send = (text: string) => runControlNordus(["send", "--bot", pepper.bot.id, "--text", text, "--url", url]);
    let sent = 0;

    for (const [engine, type] of [["webkit", webkit], ["chromium", chromium]] as const) {
      const browser = await type.launch();
      try {
        const context = await browser.newContext({
          viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        });
        await context.addInitScript(() => {
          localStorage.setItem("nordus-analytics-opt-out", "1");
          localStorage.setItem("nordus-email-gate", "skipped");
        });
        const page = await context.newPage();
        const shot = (name: string) => page.screenshot({ path: join(proofDir, `${engine}-${name}.png`) });
        const shows = (n: number) => page.evaluate((m) => Boolean(document.body.textContent?.includes(`Mensagem ${m}:`)), n);
        const distance = () => page.evaluate((s) => {
          const el = document.querySelector(s)!;
          return el.scrollHeight - el.scrollTop - el.clientHeight;
        }, SCROLLER);
        const scrollTop = () => page.evaluate((s) => document.querySelector(s)!.scrollTop, SCROLLER);

        await page.goto(url);
        await expect.poll(() => page.evaluate((composer) => {
          if (document.querySelector('[data-mobile-stack][data-screen="chat"]') && document.querySelector(composer)) return true;
          const row = [...document.querySelectorAll<HTMLElement>('aside[data-sidebar] button, aside[data-sidebar] [role="button"], aside[data-sidebar] a')]
            .find((el) => el.textContent?.includes("Pepper"));
          row?.click();
          return false;
        }, COMPOSER), { timeout: 30_000, interval: 1_000 }).toBe(true);

        for (let i = 0; i < 10; i += 1) {
          sent += 1;
          await send(`Mensagem ${sent}: uma linha mais longa para a conversa encher a tela do celular e rolar.`);
        }
        await expect.poll(() => shows(sent), { timeout: 20_000 }).toBe(true);
        await expect.poll(distance, { timeout: 5_000 }).toBeLessThan(2);
        await shot("1-segue-o-fim");

        // The reader scrolls up: a new message must not pull the screen down under them.
        // Mobile WebKit has neither a wheel nor a scriptable finger, so the reader leaves the end with Page Up.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press("PageUp");
        await page.evaluate((selector) => { document.querySelector(selector)!.scrollTop -= 500; }, SCROLLER);
        await expect.poll(distance, { timeout: 5_000 }).toBeGreaterThan(100);
        await page.waitForTimeout(300);
        const reading = await scrollTop();
        sent += 1;
        await send(`Mensagem ${sent}: chegou enquanto você lia acima.`);
        await expect.poll(() => shows(sent), { timeout: 20_000 }).toBe(true);
        await page.waitForTimeout(400);
        expect(Math.abs((await scrollTop()) - reading)).toBeLessThanOrEqual(1);
        await shot("2-lendo-acima");

        await page.locator("[data-composer-dock] button:has(svg.lucide-arrow-down)").first().click();
        await expect.poll(distance, { timeout: 5_000 }).toBeLessThan(2);

        // Three lines grow the box; the newest row stays in view above it.
        const before = (await page.locator(COMPOSER).boundingBox())!;
        await page.locator(COMPOSER).fill("Primeira linha\nSegunda linha\nTerceira linha");
        await page.waitForTimeout(400);
        const after = (await page.locator(COMPOSER).boundingBox())!;
        expect(after.height).toBeGreaterThan(before.height);
        expect(after.y + after.height).toBeLessThanOrEqual(HEIGHT);
        await expect.poll(distance, { timeout: 5_000 }).toBeLessThan(2);
        await shot("3-digitando");
        await context.close();
      } finally {
        await browser.close();
      }
    }
    console.log(`Phone engine evidence: ${proofDir}`);
  } finally {
    await fixture?.close();
  }
}, 300_000);
