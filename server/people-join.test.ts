import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startControlPlaneStub, type ControlPlaneStub } from "./testing/control-plane-stub.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
let port: number;
const HOST = "acme.agentada.test";
const ADA = "ada@example.test";

let home: string;
let child: ChildProcess;
let stub: ControlPlaneStub;
let stderr = "";

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

interface CallInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  from?: string;
}

function send(path: string, init: CallInit, headers: Record<string, string>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        signal: AbortSignal.timeout(5_000),
        method: init.method ?? (payload ? "POST" : "GET"),
        headers: { ...headers, ...(payload ? { "content-type": "application/json" } : {}), ...init.headers },
      },
      (res) => {
        let raw = "";
        res.on("error", reject);
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** The box itself: a loopback Host and Origin, nothing forwarded, the way `nordus` on the server talks. */
const owner = (path: string, init: CallInit = {}) => send(path, init, { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` });

const remote = (path: string, init: CallInit = {}) =>
  send(path, init, { host: HOST, "x-forwarded-for": init.from ?? "203.0.113.7", "x-forwarded-proto": "https", origin: `https://${HOST}` });

const cookieOf = (reply: Reply): string => {
  const raw = reply.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (first ?? "").split(";")[0];
};

async function signIn(email: string, label: string): Promise<{ reply: Reply; cookie: string }> {
  const started = await remote("/api/auth/email/start", { body: { email } });
  if (started.status !== 200) return { reply: started, cookie: "" };
  const reply = await remote("/api/auth/email/verify", { body: { email, code: stub.otp, label } });
  return { reply, cookie: cookieOf(reply) };
}

const as = (cookie: string) => (path: string, init: CallInit = {}) => remote(path, { ...init, headers: { cookie, ...init.headers } });

beforeAll(async () => {
  port = await freePortBlock([0, 1]);
  stub = await startControlPlaneStub();
  home = mkdtempSync(join(tmpdir(), "nordus-people-join-"));
  const staticDir = join(home, "static");
  mkdirSync(join(home, ".nordus"), { recursive: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Served UI</title>");
  // No sign-in list on disk and none in the environment: nobody is welcome yet.
  writeFileSync(join(home, ".nordus", "config.json"), JSON.stringify({ instances: { fixture: { driver: "people-join-test-shadow" } } }));
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      NORDUS_PORT: String(port),
      NORDUS_WEBHOOK_PORT: String(port + 1),
      NORDUS_STATIC_DIR: staticDir,
      NORDUS_PUBLIC_URL: `https://${HOST}`,
      NORDUS_ENVIRONMENT_LABEL: "acme",
      NORDUS_BROWSER_CONNECTION: join(home, "browser-test-connection.json"),
      NORDUS_CONTROL_PLANE_URL: stub.url,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`fixture exited:\n${stderr}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${stderr}`);
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (stub) await stub.close();
  if (home) await removeTempDir(home);
});

const CAT = "cat@acme.test";
const DAN = "dan@acme.test";
const EVA = "eva@acme.test";

describe("inviting people by link and approving each one", () => {
  let admin: (path: string, init?: CallInit) => Promise<Reply>;
  let token = "";

  it("sets up the first admin; an unlisted email is refused without a link", async () => {
    expect((await owner("/api/config", { method: "PUT", body: { signIn: { admins: [ADA], members: [] } } })).status).toBe(200);
    const adaSignIn = await signIn(ADA, "Ada");
    admin = as(adaSignIn.cookie);
    const refused = await remote("/api/auth/email/start", { body: { email: CAT } });
    expect(refused.status).toBe(403);
    const withToken = await remote("/api/auth/email/start", { body: { email: CAT, joinToken: "nope" } });
    expect(withToken.status).toBe(403);
    expect((await admin("/api/people/join")).body).toEqual({ link: null, requests: [] });
  });

  it("lets an admin create a link, and an unlisted email queue behind it without a session", async () => {
    const made = await admin("/api/people/join/link", { method: "POST" });
    expect(made.status).toBe(200);
    token = made.body.link.token;
    expect(token.length).toBeGreaterThan(20);

    const started = await remote("/api/auth/email/start", { body: { email: CAT, joinToken: token } });
    expect(started.status).toBe(200);
    const verified = await remote("/api/auth/email/verify", { body: { email: CAT, code: stub.otp, label: "Cat", joinToken: token } });
    expect(verified.status).toBe(202);
    expect(verified.body).toEqual({ pending: true, email: CAT });
    expect(verified.headers["set-cookie"]).toBeUndefined();

    const state = (await admin("/api/people/join")).body;
    expect(state.link.token).toBe(token);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({ email: CAT });
    expect((await signIn(CAT, "Cat before approval")).reply.status).toBe(403);
  });

  it("approves as a member: the person can now sign in plainly", async () => {
    const id = (await admin("/api/people/join")).body.requests[0].id;
    expect((await admin(`/api/people/join/requests/${id}/approve`, { method: "POST", body: {} })).body).toEqual({ ok: true });
    expect((await admin("/api/people/join")).body.requests).toEqual([]);
    expect((await admin("/api/config")).body.signIn).toEqual({ admins: [ADA], members: [CAT] });
    const cat = await signIn(CAT, "Cat");
    expect(cat.reply.status).toBe(200);
    expect(cat.reply.body.session.scopes).toEqual(["client"]);

    const member = as(cat.cookie);
    expect((await member("/api/people/join")).status).toBe(403);
    expect((await member("/api/people/join/link", { method: "POST" })).status).toBe(403);
    expect((await member("/api/people/join/link", { method: "DELETE" })).status).toBe(403);
    expect((await member("/api/people/join/requests/x/approve", { method: "POST", body: {} })).status).toBe(403);
    expect((await member("/api/people/join/requests/x/reject", { method: "POST" })).status).toBe(403);
  });

  it("rejects a request, and an approved admin role grants admin", async () => {
    await remote("/api/auth/email/start", { body: { email: DAN, joinToken: token } });
    await remote("/api/auth/email/verify", { body: { email: DAN, code: stub.otp, joinToken: token } });
    const id = (await admin("/api/people/join")).body.requests[0].id;
    expect((await admin(`/api/people/join/requests/${id}/reject`, { method: "POST" })).body).toEqual({ ok: true });
    expect((await admin("/api/people/join")).body.requests).toEqual([]);
    expect((await admin(`/api/people/join/requests/${id}/reject`, { method: "POST" })).status).toBe(404);
    expect((await admin("/api/people/join/requests/%E0%A4%A/reject", { method: "POST" })).status).toBe(400);
    expect((await signIn(DAN, "Dan")).reply.status).toBe(403);

    await remote("/api/auth/email/start", { body: { email: DAN, joinToken: token } });
    await remote("/api/auth/email/verify", { body: { email: DAN, code: stub.otp, joinToken: token } });
    const again = (await admin("/api/people/join")).body.requests[0].id;
    expect((await admin(`/api/people/join/requests/${again}/approve`, { method: "POST", body: { role: "admin" } })).status).toBe(200);
    expect((await signIn(DAN, "Dan")).reply.body.session.scopes).toEqual(["admin", "client"]);
  });

  it("approves as a guest: the person signs in as a guest and can only take part where they are put", async () => {
    await remote("/api/auth/email/start", { body: { email: EVA, joinToken: token } });
    await remote("/api/auth/email/verify", { body: { email: EVA, code: stub.otp, joinToken: token } });
    const id = (await admin("/api/people/join")).body.requests[0].id;
    expect((await admin(`/api/people/join/requests/${id}/approve`, { method: "POST", body: { role: "guest" } })).status).toBe(200);
    expect((await admin("/api/config")).body.signIn.guests).toEqual([EVA]);
    const eva = await signIn(EVA, "Eva");
    expect(eva.reply.status).toBe(200);
    expect(eva.reply.body.session.scopes).toEqual(["client"]);
    const guest = as(eva.cookie);
    expect((await guest("/api/auth/session")).body.guest).toBe(true);
    expect((await guest("/api/routines")).status).toBe(403);
    expect((await guest("/api/groups", { method: "POST", body: { memberIds: [], name: "Minha sala" } })).status).toBe(403);
    expect((await guest("/api/people/join")).status).toBe(403);
    expect((await guest("/api/people/join/link", { method: "POST" })).status).toBe(403);
    expect((await admin(`/api/people/join/requests/x/approve`, { method: "POST", body: { role: "owner" } })).status).toBe(400);
  });

  it("stops honoring the token once the link is revoked", async () => {
    expect((await admin("/api/people/join/link", { method: "DELETE" })).body).toEqual({ link: null });
    const late = await remote("/api/auth/email/start", { body: { email: "eve@acme.test", joinToken: token } });
    expect(late.status).toBe(403);
    expect((await admin("/api/people/join")).body.link).toBeNull();
    expect((await owner("/api/people/join")).status).toBe(200);
  });
});
