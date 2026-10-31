#!/usr/bin/env node
/**
 * Prova do login do Google no app EMPACOTADO, com o handler real do servidor
 * e um Google falso.
 *
 * O servidor de teste usa `handleLoginRoutes` de verdade: /auth/google monta a
 * URL do Google com PKCE, /auth/callback valida state e nonce, e
 * /auth/app/token troca o codigo pela sessao conferindo o verificador. O unico
 * dublê e a resposta do token endpoint do Google.
 *
 * O app roda com NORDUS_E2E_AUTH_STUB=1: o processo principal nao abre o
 * navegador de verdade, so registra a URL. O script percorre essa URL, simula o
 * consentimento e entrega o deep link com `open -a`, como o sistema faria.
 *
 * Uso (nesta pasta):
 *   node scripts/e2e-app-google-desktop.ts
 *   NORDUS_E2E_APP="/caminho/Nordus Novo.app" node scripts/e2e-app-google-desktop.ts
 */

import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { createAppCodes, createGoogleLogin } from "../server/google-login.ts";
import { handleLoginRoutes, type LoginRouteDeps } from "../server/google-login-http.ts";
import { SessionRegistry } from "../server/sessions.ts";

const APP =
  process.env.NORDUS_E2E_APP ??
  "/Users/example/nordus-ai/nordus-rn/desktop/release/mac-arm64/Nordus Novo.app";
const PRINTS = "/Users/example/nordus-ai/nordus-rn/docs/prints";
const CLIENT = { clientId: "e2e-client.apps.googleusercontent.com", clientSecret: "e2e-secret" };
const EMAIL = "pessoa@exemplo.com";

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function waitFor<T>(
  read: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`tempo esgotado esperando ${label}`);
}

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.cgnvbmF0dXJl`;
}

function sse(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ kind: "hello", cursor: "0" })}\n\n`);
  const beat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  res.on("close", () => clearInterval(beat));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Porta livre para o debug do Chromium. */
async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function cookiePair(raw: string): string {
  return raw.split(";")[0] ?? "";
}

async function main() {
  const appStat = statSync(APP);
  assert.ok(appStat.isDirectory(), `app nao encontrado: ${APP}`);
  const dataDir = mkdtempSync(path.join(tmpdir(), "nordus-google-e2e-"));
  const userData = mkdtempSync(path.join(tmpdir(), "nordus-google-user-"));

  const google = {
    challenge: "",
    nonce: "",
    exchanges: 0,
  };
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = new URLSearchParams(String(init?.body));
    const verifier = body.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (body.get("code") !== "codigo-do-google" || challenge !== google.challenge) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    google.exchanges += 1;
    const now = Math.floor(Date.now() / 1000);
    return new Response(
      JSON.stringify({
        id_token: idToken({
          iss: "https://accounts.google.com",
          aud: CLIENT.clientId,
          sub: "google-sub-e2e",
          email: EMAIL,
          email_verified: true,
          nonce: google.nonce,
          exp: now + 600,
          iat: now,
          name: "Pessoa do teste",
        }),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const login = createGoogleLogin({
    credentials: () => CLIENT,
    allow: () => ["admin", "client"],
    fetchImpl,
  });
  assert.equal(login.enabled(), true);
  const deps: LoginRouteDeps = {
    login,
    sessions: new SessionRegistry({ file: path.join(dataDir, "sessions.json") }),
    sessionCookie: "nordus_session",
    appCodes: createAppCodes(),
    environment: () => ({
      environmentId: "env-google-e2e",
      label: "Mac do Google simulado",
      platform: "darwin",
      version: "1.1.0",
    }),
  };

  const seen = { bots: 0, events: 0, token: "" };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (await handleLoginRoutes(req, res, url.pathname, req.method ?? "GET", url, deps)) return;

    if (url.pathname === "/api/bots" && req.method === "GET") {
      const auth = String(req.headers.authorization ?? "");
      assert.match(auth, /^Bearer nordus_sess_/, "a lista foi pedida sem a sessao do Google");
      seen.bots += 1;
      seen.token = auth.slice("Bearer ".length);
      return json(res, 200, {
        bots: [
          {
            id: "bot-google",
            threadId: "thread-google",
            name: "Atlas",
            title: "Pesquisa",
            description: "Entrou com o Google simulado",
            notifications: true,
            color: "orange",
            unread: false,
            modelSelection: { instanceId: "fake", model: "fake-sonnet" },
            createdAt: Date.now(),
            messages: [
              {
                id: "msg-google",
                role: "bot",
                kind: "text",
                at: Date.now(),
                text: "Sessao criada pelo Google simulado.",
              },
            ],
          },
        ],
        groups: [],
      });
    }
    if (url.pathname === "/api/events") {
      seen.events += 1;
      return sse(res);
    }
    json(res, 404, { error: "rota de teste" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  console.log(`servidor do Google simulado: ${base}`);

  let child: ChildProcess | null = null;
  let pageRef: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.connectOverCDP>>['newPage']>> | null = null;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  const logs = { stderr: "", stdout: "" };
  let failure: unknown = null;
  try {
    const debugPort = await freePort();
    const env = { ...process.env, NORDUS_E2E_AUTH_STUB: "1", NORDUS_USER_DATA_DIR: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(
      path.join(APP, "Contents", "MacOS", "Nordus Novo"),
      [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stderr?.on("data", (chunk) => {
      logs.stderr += String(chunk);
    });
    child.stdout?.on("data", (chunk) => {
      logs.stdout += String(chunk);
    });

    const target = await waitFor(
      async () => {
        const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
          .then((response) => (response.ok ? response.json() : []))
          .catch(() => []);
        return Array.isArray(pages)
          ? pages.find((item: { type?: string; url?: string }) =>
              item.type === "page" && String(item.url ?? "").startsWith("app://nordus/"),
            ) ?? null
          : null;
      },
      30_000,
      "a janela do app empacotado",
    );
    assert.ok(target);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith("app://nordus/"));
    assert.ok(page, "o CDP nao devolveu a janela do Nordus");
    pageRef = page;
    page.on("console", (message) => console.log(`[renderer] ${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => console.log(`[renderer] erro: ${error.message}`));
    await page.waitForSelector('[data-testid="welcome-google"]', { timeout: 20_000 });
    console.log("boas-vindas: OK");
    await page.screenshot({ path: path.join(PRINTS, "entrada-boas-vindas-desktop.png") });

    // O servidor do teste nao e o padrao: entra por "Usar meu proprio servidor".
    await page.click('[data-testid="welcome-own-server"]');
    await page.fill('[data-testid="server-address"]', base);
    await page.click('[data-testid="server-connect"]');
    await page.waitForSelector('[data-testid="signin-google"]', { timeout: 20_000 });
    await page.screenshot({ path: path.join(PRINTS, "entrada-login-desktop.png") });
    await page.click('[data-testid="signin-google"]');
    console.log("servidor escolhido e clique no Google: OK");
    const authUrl = await waitFor(
      () => /\[nordus\] auth url (\S+)/.exec(logs.stderr)?.[1],
      20_000,
      "a URL de login no log do processo principal",
    );
    const started = new URL(authUrl);
    assert.equal(`${started.protocol}//${started.host}`, base, "o login saiu para outro servidor");
    assert.equal(started.searchParams.get("cliente"), "rn");
    assert.match(started.searchParams.get("desafio") ?? "", /^[A-Za-z0-9_-]{43}$/);
    console.log(`app pediu o login com cliente=rn e desafio PKCE: OK`);

    const begin = await fetch(authUrl, { redirect: "manual" });
    assert.equal(begin.status, 302, `inicio do login deveria redirecionar, veio ${begin.status}`);
    const consent = new URL(begin.headers.get("location") ?? "");
    assert.equal(consent.hostname, "accounts.google.com");
    const state = consent.searchParams.get("state") ?? "";
    const nonce = consent.searchParams.get("nonce") ?? "";
    assert.ok(state && nonce, "a URL do Google veio sem state/nonce");
    google.challenge = consent.searchParams.get("code_challenge") ?? "";
    google.nonce = nonce;
    const cookie = cookiePair(begin.headers.getSetCookie()[0] ?? "");
    assert.ok(cookie.includes("="), "o servidor nao mandou o cookie de binding");
    console.log("handler real montou a ida ao Google com state, nonce e S256: OK");

    const callback = await fetch(
      `${base}/auth/google/callback?code=codigo-do-google&state=${encodeURIComponent(state)}`,
      { redirect: "manual", headers: { cookie } },
    );
    assert.equal(callback.status, 302, `callback deveria redirecionar, veio ${callback.status}`);
    const deepLink = callback.headers.get("location") ?? "";
    const parsed = new URL(deepLink);
    assert.equal(parsed.protocol, "ai.nordus.rn:");
    assert.equal(parsed.host, "auth");
    assert.match(parsed.searchParams.get("code") ?? "", /^[A-Za-z0-9_-]{43}$/);
    console.log(`servidor emitiu o deep link ai.nordus.rn://auth?code=...: OK`);

    // O LaunchServices entrega o link ao app aberto pelo evento `open-url`.
    execFileSync("open", ["-a", APP, deepLink], { stdio: "inherit" });
    await page.waitForSelector('[data-testid^="list-row-"]', { timeout: 30_000 });
    const row = await page.textContent('[data-testid^="list-row-"]');
    assert.match(row ?? "", /Atlas/);
    assert.match(row ?? "", /Sessao criada pelo Google simulado/);
    assert.equal(google.exchanges, 1, "o token endpoint do Google falso foi chamado 0 ou 2 vezes");
    assert.ok(seen.bots >= 1, "a lista nao foi pedida ao servidor");
    assert.ok(seen.events >= 1, "o app nao abriu o stream do servidor");
    const token = await page.evaluate(() => localStorage.getItem("nordus.session.token"));
    assert.equal(token, seen.token, "o token guardado nao e o que o servidor entregou");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("nordus.session.meta") ?? "null"),
    );
    assert.equal(stored?.baseUrl, base);
    console.log(`lista abriu com a sessao do Google: ${seen.bots} /api/bots, ${seen.events} /api/events`);
    await page.screenshot({ path: path.join(PRINTS, "entrada-google-lista.png") });
    console.log(`print entrada-google-lista.png: ${statSync(path.join(PRINTS, "entrada-google-lista.png")).size} bytes`);
  } catch (error) {
    failure = error;
  } finally {
    await browser?.close().catch(() => undefined);
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // O app pode soltar o diretorio depois do kill; o sistema limpa o resto.
    }
  }

  if (failure) {
    console.error("[e2e-google] FALHOU");
    if (pageRef) {
      await pageRef.screenshot({ path: path.join(PRINTS, "entrada-google-falha.png") }).catch(() => undefined);
      console.error((await pageRef.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 1_500));
    }
    console.error(logs.stderr.slice(-4_000));
    throw failure;
  }
  console.log("[e2e-google] OK");
}

await main();
