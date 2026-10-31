// The person types a password, then a code, into the sign-in card; both reach the stand-in page and nothing else.
// A happy-dom page behind a stand-in agent-browser: nothing reaches a real browser, the user's data or port 8799.
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { FakeLoginPage } from "./testing/fake-login-page.ts";
import { freePortBlock } from "./testing/ports.ts";

// Obvious fakes only.
const PASSWORD = "fake-E2E-Passw0rd!";
const CODE = "482913";
const SIGN_IN = "https://accounts.example.com/signin";
const PASSWORD_PAGE = `<form action="/s" method="post"><input name="email" type="hidden" value="alice@example.com"><input id="password" name="password" type="password" autocomplete="current-password"><button type="submit">Next</button></form>`;
const CODE_PAGE = `<form action="/c" method="post"><input id="code" name="code" type="text" autocomplete="one-time-code"><button type="submit">Verify</button></form>`;
const HOME = { url: "https://accounts.example.com/home", html: "<title>Home</title><h1>Signed in</h1>" };

/** The bridge plays the running browser: the stand-in engine forwards each command, relay command and MCP call here. */
async function browserFixture(url: string) {
  const page = new FakeLoginPage(url, PASSWORD_PAGE);
  const port = await freePortBlock([0], 20_040, 40);
  const engineArgs: string[][] = [];
  // The proxy each browser command carries (a version probe starts no browser): a bot's browser goes through its egress gate.
  const proxies = new Set<string>();
  const bridge = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const reply = (data: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    try {
      if (req.url === "/api/command") {
        const command = JSON.parse(raw) as { action?: string; subaction?: string; text?: string; key?: string; selector?: string };
        if (command.action === "keyboard" && command.subaction === "insertText" && typeof command.text === "string") await page.insertText(command.text);
        else if (command.action === "press" && typeof command.key === "string") await page.press(command.key);
        else if (command.action === "click" && typeof command.selector === "string") await page.click(command.selector);
        else return reply({ success: false });
        return reply({ success: true, data: {} });
      }
      if (req.url === "/mcp") {
        const call = JSON.parse(raw) as { name: string; arguments?: { script?: string } };
        if (call.name === "agent_browser_get_url") return reply({ content: [{ type: "text", text: page.window.location.href }] });
        if (call.name === "agent_browser_eval") return reply({ content: [{ type: "text", text: JSON.stringify(page.window.eval(call.arguments?.script ?? "")) }] });
        return reply({ isError: true, content: [{ type: "text", text: `unknown tool ${call.name}` }] });
      }
      const { args, proxy } = JSON.parse(raw) as { args: string[]; proxy?: string };
      engineArgs.push(args);
      if (args[0] !== "--version") proxies.add(proxy ?? "none");
      const data = await page.engine(args);
      return reply({ success: true, data: data && "port" in data ? { ...data, port } : data });
    } catch (error) {
      return reply({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((ready) => bridge.listen(port, "127.0.0.1", ready));

  const tools = mkdtempSync(join(tmpdir(), "nordus-card-secret-e2e-"));
  const binaryPath = join(tools, "agent-browser");
  // The stand-in agent-browser: always running, `close` and `set` do nothing, `mcp` answers get_url and eval from the
  // page, and every other command goes to the bridge.
  writeFileSync(binaryPath, `#!${process.execPath}
const args = process.argv.slice(2).filter((arg) => arg !== "--json" && arg !== "--no-webmcp");
const say = (value) => { process.stdout.write(JSON.stringify(value)); process.exit(0); };
const bridge = (path, body) => fetch("http://127.0.0.1:${port}" + path, { method: "POST", body: JSON.stringify(body) }).then((response) => response.text());
if (args[0] === "session" && args[1] === "list") say({ success: true, data: { sessions: [process.env.AGENT_BROWSER_SESSION] } });
else if (args[0] === "close" || args[0] === "set") process.exit(0);
else if (args[0] === "mcp") {
  const tool = (name) => ({ name, description: name, inputSchema: { type: "object", properties: { script: { type: "string" } } } });
  const answer = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
  require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    if (message.method === "initialize") answer(message.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} } });
    else if (message.method === "tools/list") answer(message.id, { tools: [tool("agent_browser_get_url"), tool("agent_browser_eval")] });
    else bridge("/mcp", message.params).then((text) => answer(message.id, JSON.parse(text)));
  });
}
else bridge("/engine", { args, proxy: process.env.AGENT_BROWSER_PROXY }).then((text) => { process.stdout.write(text); process.exit(0); }, () => process.exit(1));
`, { mode: 0o755 });

  const fixture = await launchVerificationServer({}, undefined, undefined, { binaryPath, executablePath: join(tools, "chrome") }, undefined, { scripted: true });
  const base = fixture.info.url;
  const planPath = join(fixture.info.dataDir, "room-plan.json");
  const evidence = () => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method, headers: { "content-type": "application/json", origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as any };
  };
  const answered = (turn: number, tool: string) => evidence()[turn].evidence.filter((entry: any) => entry.step?.tool === tool).map((entry: any) => entry.response.result);
  return {
    page, base, planPath, engineArgs, proxies, fixture, evidence, api, answered,
    close: async () => {
      page.close();
      await fixture.close();
      await new Promise((done) => bridge.close(done));
      await removeTempDir(tools);
    },
  };
}

it.skipIf(process.platform === "win32")("types a password and then a code from the sign-in card into the page, on its own site only, and the bot never sees either", async () => {
  const browser = await browserFixture(SIGN_IN);
  const { page, api, evidence } = browser;
  page.answer = (fields) => fields.password
    ? { navigate: { url: `${SIGN_IN}/challenge`, html: CODE_PAGE } }
    : fields.code ? { navigate: HOME } : null;
  page.window.document.body.innerHTML = PASSWORD_PAGE;
  try {
    expect((await api("PATCH", "/api/config", { features: { browser: true } })).status).toBe(200);
    const bot = (await api("POST", "/api/bots", { name: "Signer" })).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { computer: "browser", browserProfile: "guest" })).status).toBe(200);
    writeFileSync(browser.planPath, JSON.stringify({ [bot.id]: { turns: [
      { steps: [{ tool: "request_sign_in", arguments: { site: SIGN_IN, reason: "Google asked for the password." } }], reply: "I asked for the password." },
      { steps: [{ tool: "request_sign_in", arguments: { site: SIGN_IN, reason: "Now it asks for a code." } }], reply: "Now the code." },
      { reply: `You are signed in. The code was ${CODE} and the password ${PASSWORD}.` },
    ] } }));
    const messages = async () => (await api("GET", `/api/threads/${bot.threadId}/messages`)).body.messages as any[];
    const cards = async () => (await messages()).filter((message) => message.kind === "signin");
    const endpoint = (id: string) => `/api/bots/${bot.id}/sign-in-cards/${id}/type-secret`;

    await runControlNordus(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Sign in.", "--url", browser.base]);
    await expect.poll(async () => (await cards()).length, { timeout: 20_000 }).toBe(1);
    const first = (await cards())[0];
    expect(await api("GET", `${endpoint(first.id)}?threadId=${bot.threadId}`)).toMatchObject({ status: 200, body: { host: "accounts.example.com", field: "password" } });
    expect(page.typed).toEqual([]);

    const sent = await api("POST", endpoint(first.id), { threadId: bot.threadId, value: PASSWORD });
    expect(sent).toMatchObject({ status: 200, body: { done: true, sent: true, kind: "password" } });
    expect(sent.text).not.toContain(PASSWORD);
    expect(page.sent).toEqual([{ email: "alice@example.com", password: PASSWORD }]);
    expect(page.typed).toEqual([PASSWORD]);
    expect(page.pressed).toEqual(["Enter"]);

    // The site asks for a code next: the bot asks again, a new card appears, and it types the same way.
    await expect.poll(async () => (await cards()).length, { timeout: 20_000 }).toBe(2);
    expect((await cards())[0].signIn).toMatchObject({ done: true, sent: true });
    const second = (await cards()).find((card) => card.id !== first.id);
    expect(await api("GET", `${endpoint(second.id)}?threadId=${bot.threadId}`)).toMatchObject({ status: 200, body: { host: "accounts.example.com", field: "code" } });
    expect(await api("POST", endpoint(second.id), { threadId: bot.threadId, value: CODE })).toMatchObject({ status: 200, body: { sent: true, kind: "code" } });
    expect(page.sent.at(-1)).toEqual({ code: CODE });
    expect(page.window.location.href).toBe(HOME.url);

    await expect.poll(async () => (await messages()).some((message) => String(message.text).startsWith("You are signed in.")), { timeout: 20_000 }).toBe(true);
    const everything = JSON.stringify({ evidence: evidence(), messages: await messages(), engine: browser.engineArgs });
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(CODE);
    // A careless bot repeats both in its last reply; the transcript keeps neither.
    expect((await messages()).find((message) => String(message.text).startsWith("You are signed in."))?.text).toBe("You are signed in. The code was •••••• and the password ••••••.");
  } finally {
    await browser.close();
  }
}, 120_000);

it.skipIf(process.platform === "win32")("types nothing when the page is another site or another tab is open on the same site", async () => {
  const browser = await browserFixture(SIGN_IN);
  const { page, api, evidence } = browser;
  page.window.document.body.innerHTML = PASSWORD_PAGE;
  try {
    expect((await api("PATCH", "/api/config", { features: { browser: true } })).status).toBe(200);
    const bot = (await api("POST", "/api/bots", { name: "Signer" })).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { computer: "browser", browserProfile: "guest" })).status).toBe(200);
    writeFileSync(browser.planPath, JSON.stringify({ [bot.id]: { turns: [
      { steps: [{ tool: "request_sign_in", arguments: { site: SIGN_IN, reason: "The password, please." } }], reply: "I asked." },
    ] } }));
    await runControlNordus(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Sign in.", "--url", browser.base]);
    await expect.poll(() => evidence().length, { timeout: 20_000 }).toBe(1);
    const messages = async () => (await api("GET", `/api/threads/${bot.threadId}/messages`)).body.messages as any[];
    await expect.poll(async () => (await messages()).some((message) => message.kind === "signin"), { timeout: 15_000 }).toBe(true);
    const card = (await messages()).find((message) => message.kind === "signin");
    const path = `/api/bots/${bot.id}/sign-in-cards/${card.id}/type-secret`;

    page.otherTabs = ["https://accounts.example.com/other"];
    const twoTabs = await api("POST", path, { threadId: bot.threadId, value: PASSWORD });
    expect(twoTabs.status).toBe(409);
    expect(twoTabs.text).not.toContain(PASSWORD);
    page.otherTabs = [];

    page.navigate("https://evil.example.net/signin", PASSWORD_PAGE);
    expect((await api("POST", path, { threadId: bot.threadId, value: PASSWORD })).status).toBe(409);
    expect(page.typed).toEqual([]);
    expect(page.sent).toEqual([]);
    expect((await messages()).find((message) => message.id === card.id)?.signIn).not.toMatchObject({ done: true });
  } finally {
    await browser.close();
  }
}, 120_000);
