// Disposable real-renderer check of the conversational first run: the full app in one Electron window against a
// fake-engine server with a temporary home. No provider login, user workspace or network beyond loopback.
// Run with Node: node --experimental-strip-types scripts/verify-onboarding-chat.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const flag = "--nordus-onboarding-chat-fixture";

if (!process.versions.electron) {
  const { launchVerificationServer } = await import("./control-nordus.ts");
  const { fixtureApi, mountPreview } = await import("./testing/preview-fixture.ts");
  const output = mkdtempSync(join(tmpdir(), "nordus-onboarding-chat-evidence-"));
  const fixture = await launchVerificationServer();
  let preview;
  let code = 1;
  try {
    await fixtureApi(fixture.info.url)("PATCH", "/api/config", { language: "pt-br" });
    preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__threads.html", title: "Isolated Nordus Chat", logLevel: "warn" });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(createRequire(import.meta.url)("electron"), [fileURLToPath(import.meta.url), flag, `${preview.previewUrl}?onboarding=1`, output], { env, stdio: "inherit" });
    const watchdog = setTimeout(() => child.kill(), 240_000);
    code = await new Promise((resolve) => {
      child.on("error", (error) => { console.error(error); resolve(1); });
      child.on("exit", (value) => resolve(value ?? 1));
    });
    clearTimeout(watchdog);
  } finally {
    await preview?.close();
    await fixture.close();
  }
  console.log(`Onboarding chat evidence: ${output}`);
  if (code !== 0 || JSON.parse(readFileSync(join(output, "receipt.json"), "utf8")).passed !== true) {
    console.error("Onboarding chat fixture failed");
    process.exit(1);
  }
} else {
  const [url, output] = process.argv.slice(process.argv.indexOf(flag) + 1);
  const { app, BrowserWindow } = await import("electron");
  app.setPath("userData", join(output, "profile"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");

  let passed = true;
  const check = (name, ok, detail) => {
    if (!ok) passed = false;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  };

  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1280, height: 820, show: false, backgroundColor: "#070707", webPreferences: { backgroundThrottling: false } });
    const run = (js) => win.webContents.executeJavaScript(js);
    const text = () => run("document.body.innerText").catch(() => "");
    const waitFor = async (needle, ms = 60_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await delay(200)) if ((await text()).includes(needle)) return true;
      return false;
    };
    const press = (label) => run(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.trim().includes(${JSON.stringify(label)}) && !el.disabled); if (!b) return false; b.click(); return true; })()`);
    const shot = async (name) => {
      await delay(500);
      writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    const config = () => run("fetch('/api/config').then((r) => r.json())");
    try {
      await win.loadURL(url);
      check("the first question is the company name", await waitFor("Como se chama a sua empresa"));
      const first = await text();
      check("the rail names every step and counts what is left", ["Workspace", "Contexto", "Trazer seus agentes", "Agentes e IA", "Ferramentas"].every((label) => first.includes(label)) && first.includes("Faltam 5 etapas"));
      await shot("1-company");

      check("Continuar saves the name and asks what the company does", (await press("Continuar")) && (await waitFor("o que vocês fazem")));
      check("a suggestion fills the answer", await run("(() => { const chip = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Prestamos serviços')); if (!chip) return false; chip.click(); return true; })()"));
      await shot("2-about");
      check("Continuar writes it and moves on to bringing agents", (await press("Continuar")) && (await waitFor("Você já usa")));
      check("the company name is on the workspace", typeof (await config()).profile?.company === "string");
      await shot("3-import");

      const reloaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      win.webContents.reload();
      await reloaded;
      check("a reload resumes on the open step with the earlier answers in the rail", (await waitFor("Você já usa")) && (await text()).includes("Escrito"));

      check("Pular esta etapa moves to the agents", await press("Pular esta etapa"));
      check("a team is proposed", await waitFor("Montei um time"));
      const button = await run("(() => { const b = [...document.querySelectorAll('button')].find((el) => /Criar \\d+ agentes|Criar 1 agente/.test(el.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { bottom: r.bottom, viewport: window.innerHeight }; })()");
      check("the create button is in view without scrolling", Boolean(button) && button.bottom <= button.viewport - 1, button);
      await shot("4-agents");
      check("Criar builds the checked agents", await run("(() => { const b = [...document.querySelectorAll('button')].find((el) => /Criar \\d+ agentes|Criar 1 agente/.test(el.textContent)); if (!b) return false; b.click(); return true; })()"));
      check("the tools step follows", await waitFor("Quais apps seus agentes vão usar"));
      await shot("5-tools");
      check("Pular esta etapa reaches the summary", (await press("Pular esta etapa")) && (await waitFor("Pronto! Tudo certo para começar")));
      const summary = await text();
      check("the summary lists what was set up", summary.includes("Workspace:") && summary.includes("Instruções do time salvas") && /\d agentes?:/.test(summary));
      await shot("6-done");

      const bots = await run("fetch('/api/bots').then((r) => r.json())");
      check("the agents exist on the server", ((bots.bots ?? bots).length ?? 0) >= 2, (bots.bots ?? bots).map((bot) => bot.name));
      check("the progress is kept in the browser until the end", typeof (await run("localStorage.getItem('nordus.onboarding.chat.v1')")) === "string");
      check("the last button finishes the welcome", await press("Começar"));
      await delay(1500);
      const after = await config();
      check("the welcome is recorded and the progress forgotten", Boolean(after.onboarding?.completedAt) && (await run("localStorage.getItem('nordus.onboarding.chat.v1')")) === null, after.onboarding);
      await shot("7-after");
    } catch (error) {
      passed = false;
      console.log(`ERROR ${error?.stack ?? error}`);
    }
    writeFileSync(join(output, "receipt.json"), JSON.stringify({ passed }));
    console.log(passed ? "ALL PASSED" : "FAILED");
    app.exit(passed ? 0 : 1);
  });
}
