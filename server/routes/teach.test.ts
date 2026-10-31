import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TeachRecording, TeachStatus } from "../../shared/teach.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { TeachError } from "../teach/recorder.ts";
import { createTeachRoutes, type TeachRouteDeps } from "./teach.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function serve(over: { browser?: "ok" | "off" | "no-engine"; recording?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "teach-route-"));
  dirs.push(dir);
  writeFileSync(join(dir, "1.jpg"), "JPEGBYTES");
  const finished: TeachRecording[] = [];
  const started: Array<{ botId: string; threadId: string; owner: string }> = [];
  let recording = over.recording ?? false;
  const rec: TeachRouteDeps["recorder"] = {
    status: () => ({ recording, steps: [] }) satisfies TeachStatus,
    start: async (input) => {
      if (recording) throw new TeachError(409, "Já estou gravando uma tarefa neste robô.");
      recording = true; started.push(input);
      return { recording: true, threadId: input.threadId, steps: [], state: "starting" };
    },
    stop: async (_b, _o) => {
      if (!recording) return null;
      recording = false;
      return { recording: { id: "r", botId: "pepper", threadId: "t1", startedAt: 0, endedAt: 1, steps: [] } };
    },
    cancel: () => { recording = false; },
    shotPath: (_b, n) => (n === 1 ? join(dir, "1.jpg") : null),
  };
  const routes = [createTeachRoutes({
    recorder: rec,
    botExists: (id) => id === "pepper",
    threadBelongsToBot: (_b, t) => t === "t1",
    browserState: () => over.browser ?? "ok",
    finish: (r) => { finished.push(r); },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots`;
  const post = (path: string, body: unknown = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { base, post, finished, started };
}

describe("rotas de ensinar uma tarefa", () => {
  it("sao so de administrador", () => {
    for (const [method, path] of [["GET", "/api/bots/b/teach"], ["POST", "/api/bots/b/teach/start"], ["POST", "/api/bots/b/teach/stop"], ["POST", "/api/bots/b/teach/cancel"], ["GET", "/api/bots/b/teach/shot/1"]] as const) {
      expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
    }
  });

  it("start, status, stop e cancel", async () => {
    const { base, post, finished, started } = await serve();
    expect(await (await fetch(`${base}/pepper/teach`)).json()).toEqual({ recording: false, steps: [] });
    const start = await post("/pepper/teach/start", { threadId: "t1" });
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({ recording: true, state: "starting", threadId: "t1" });
    expect(started[0]).toEqual({ botId: "pepper", threadId: "t1", owner: "local-owner" });
    expect((await post("/pepper/teach/start", { threadId: "t1" })).status).toBe(409);
    const stop = await post("/pepper/teach/stop");
    expect(stop.status).toBe(202);
    expect(await stop.json()).toEqual({ ok: true });
    expect(finished).toHaveLength(1);
    expect((await post("/pepper/teach/stop")).status).toBe(409);
    expect((await post("/pepper/teach/cancel")).status).toBe(200);
  });

  it("recusa conversa errada, robo inexistente, navegador desligado e sem motor", async () => {
    expect((await (await serve()).post("/pepper/teach/start", { threadId: "outra" })).status).toBe(400);
    expect((await (await serve()).post("/pepper/teach/start", {})).status).toBe(400);
    expect((await (await serve()).post("/nenhum/teach/start", { threadId: "t1" })).status).toBe(404);
    const off = await (await serve({ browser: "off" })).post("/pepper/teach/start", { threadId: "t1" });
    expect(off.status).toBe(409);
    expect(await off.json()).toEqual({ error: "Ligue o navegador deste robô primeiro." });
    expect((await (await serve({ browser: "no-engine" })).post("/pepper/teach/start", { threadId: "t1" })).status).toBe(503);
  });

  it("miniatura do passo", async () => {
    const { base } = await serve();
    const ok = await fetch(`${base}/pepper/teach/shot/1`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect(await ok.text()).toBe("JPEGBYTES");
    expect((await fetch(`${base}/pepper/teach/shot/2`)).status).toBe(404);
  });

  it("deixa passar o que nao e dele", async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/pepper/skills`)).status).toBe(404);
    expect((await fetch(`${base}/pepper/teach`, { method: "DELETE" })).status).toBe(404);
  });
});
