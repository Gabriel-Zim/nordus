import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DoneAction } from "../../shared/outbound.ts";
import { CUT_TWICE, INTERRUPTED_OUTWARD } from "../runtime/tree.ts";
import { createInterruptedWorkRoutes, type InterruptedWorkDeps } from "./interrupted-work.ts";
import type { RouteContext } from "./table.ts";

const NOW = 1_800_000_000_000;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const video: DoneAction = { tool: "mcp__zorg__gerar_video", effect: "spend", uncertain: false };

function setup(overrides: Partial<InterruptedWorkDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "interrupted-"));
  dirs.push(dir);
  const resumed: Array<{ botId: string; threadId: string; done: readonly DoneAction[] }> = [];
  const seen: string[] = [];
  const deps: InterruptedWorkDeps = {
    cutTurns: () => [
      { id: "n-video", botId: "ada", threadId: "t-ada", detail: `${INTERRUPTED_OUTWARD} generated a video (mcp__zorg__gerar_video); not resumed, so nothing is done twice.`, at: NOW - 60_000, room: false },
      { id: "n-read", botId: "ben", threadId: "t-ben", detail: CUT_TWICE, at: NOW - 120_000, room: false },
      { id: "n-room", botId: "ben", threadId: "t-room", detail: "Stopped: no activity for 20 minutes", at: NOW - 5_000, room: true },
      { id: "n-client", botId: "cliente", threadId: "t-cliente", detail: CUT_TWICE, at: NOW - 30_000, room: false },
      { id: "n-old", botId: "ada", threadId: "t-old", detail: CUT_TWICE, at: NOW - 8 * 24 * 60 * 60_000, room: false },
    ],
    doneFor: (id) => (id === "n-video" ? [video] : []),
    succeededAfter: () => false,
    routineRuns: () => [{ id: "r1", botId: "ada", threadId: "t-ada", routineName: "Bom dia", status: "missed", error: "Não executada: o Nordus estava desligado no horário e esta rotina só roda na hora certa.", at: NOW - 10_000 }],
    markRoutineSeen: (id) => { seen.push(id); },
    botName: (id) => ({ ada: "Ada", ben: "Ben", cliente: "Cliente" } as Record<string, string>)[id],
    threadTitle: (_bot, threadId) => `#${threadId}`,
    canSee: ({ auth }, botId) => botId !== "cliente" || (auth as unknown as { kind: string }).kind === "loopback",
    personAtControls: ({ auth }) => ["session", "desktop"].includes((auth as unknown as { kind: string }).kind),
    resume: async (botId, threadId, done) => { resumed.push({ botId, threadId, done }); return null; },
    dismissedFile: join(dir, "dismissed.json"),
    now: () => NOW,
    ...overrides,
  };
  const route = createInterruptedWorkRoutes(deps);
  const call = async (method: string, path: string, body?: unknown, kind = "session") => {
    let status = 0;
    let value: any;
    const ctx = {
      req: {}, res: {}, url: new URL(`http://x${path}`), path, method, auth: { kind },
      json: (_res: unknown, code: number, payload: unknown) => { status = code; value = payload; },
      readBody: async () => body ?? {},
    } as unknown as RouteContext;
    await route(ctx);
    return { status, value };
  };
  const ids = async (kind?: string) => (await call("GET", "/api/interrupted-work", undefined, kind)).value.items.map((item: { id: string }) => item.id);
  return { call, ids, resumed, seen };
}

describe("Parou no meio", () => {
  it("lists cut turns with what they did and missed routines, newest first, hiding what the viewer may not see and what is a week old", async () => {
    const { call, ids } = setup();
    const { status, value } = await call("GET", "/api/interrupted-work");
    expect(status).toBe(200);
    expect(await ids()).toEqual(["routine:r1", "turn:n-video", "turn:n-read"]);
    expect(value.items[1]).toMatchObject({
      botName: "Ada", threadTitle: "#t-ada", done: ["gerou um vídeo"], mustConfirm: true, canResume: true,
      cause: "O Nordus reiniciou depois que o robô já tinha feito algo, então ele não continuou sozinho.",
    });
    expect(value.items[1]).not.toHaveProperty("doneActions");
    expect(value.items[2]).toMatchObject({ done: [], mustConfirm: false, cause: "O Nordus reiniciou duas vezes durante esta tarefa, então ela não foi retomada de novo." });
    expect(value.items[0]).toMatchObject({ kind: "routine", canResume: false, cause: "Não executada: o Nordus estava desligado no horário e esta rotina só roda na hora certa." });
    expect(await ids("loopback")).toContain("turn:n-client");
  });

  it("dismissing or resuming a turn that already acted needs the confirmation; then it leaves the list", async () => {
    const { call, ids, resumed } = setup();
    expect((await call("POST", "/api/interrupted-work/turn:n-video/dismiss", {})).status).toBe(409);
    expect((await call("POST", "/api/interrupted-work/turn:n-video/resume", {})).status).toBe(409);
    expect(resumed).toEqual([]);
    expect((await call("POST", "/api/interrupted-work/turn:n-video/resume", { acknowledged: true })).status).toBe(200);
    expect(resumed).toEqual([{ botId: "ada", threadId: "t-ada", done: [video] }]);
    expect(await ids()).not.toContain("turn:n-video");
  });

  it("a turn that did nothing outward is dismissed without confirmation, a routine is marked seen, and a hidden one cannot be touched", async () => {
    const { call, ids, seen } = setup();
    expect((await call("POST", "/api/interrupted-work/turn:n-read/dismiss", {})).status).toBe(200);
    expect(await ids()).not.toContain("turn:n-read");
    expect((await call("POST", "/api/interrupted-work/routine:r1/dismiss", {})).status).toBe(200);
    expect(seen).toEqual(["r1"]);
    expect((await call("POST", "/api/interrupted-work/turn:n-client/dismiss", {})).status).toBe(404);
  });

  it("only a signed-in person can wave through a turn that already acted; a bot's local call is refused even with the confirmation", async () => {
    const { call, resumed } = setup();
    expect((await call("POST", "/api/interrupted-work/turn:n-video/resume", { acknowledged: true }, "loopback")).status).toBe(403);
    expect((await call("POST", "/api/interrupted-work/turn:n-video/dismiss", { acknowledged: true }, "loopback")).status).toBe(403);
    expect(resumed).toEqual([]);
    expect((await call("POST", "/api/interrupted-work/turn:n-read/dismiss", {}, "loopback")).status).toBe(200);
    expect((await call("POST", "/api/interrupted-work/turn:n-video/dismiss", { acknowledged: true }, "desktop")).status).toBe(200);
  });

  it("a turn kept waiting by a message still queued says so, not that the bot already acted", async () => {
    const { call } = setup({ cutTurns: () => [{ id: "n-queue", botId: "ada", threadId: "t-ada", detail: `${INTERRUPTED_OUTWARD} completed an outward action (queued follow-up waiting); not resumed, so nothing is done twice.`, at: NOW - 1_000, room: false }], routineRuns: () => [] });
    expect((await call("GET", "/api/interrupted-work")).value.items[0].cause).toBe("O Nordus reiniciou com uma mensagem sua ainda na fila desta conversa, então o robô não continuou sozinho.");
  });

  it("a failed routine shows a plain cause, never the engine's English error, and an old missed run gets the plain sentence too", async () => {
    const { ids, call } = setup({ routineRuns: () => [
      { id: "r-failed", botId: "ada", routineName: "Relatório", status: "failed", error: "claude exited 3 before result", at: NOW - 1_000 },
      { id: "r-old", botId: "ada", routineName: "Bom dia", status: "missed", error: "This computer was offline for more than 12 hours after the scheduled time", at: NOW - 2_000 },
    ] });
    expect(await ids()).toEqual(["routine:r-failed", "routine:r-old", "turn:n-video", "turn:n-read"]);
    const causes = (await call("GET", "/api/interrupted-work")).value.items.slice(0, 2).map((item: { cause: string }) => item.cause);
    expect(causes).toEqual(["A rotina falhou. Abra a conversa para ver o que aconteceu.", "A rotina não foi executada no horário."]);
  });

  it("dismissals are written whole and forget what the list no longer shows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "interrupted-"));
    dirs.push(dir);
    const file = join(dir, "dismissed.json");
    writeFileSync(file, JSON.stringify({ "turn:gone": NOW - 30 * 24 * 60 * 60_000 }));
    const { call } = setup({ dismissedFile: file });
    expect((await call("POST", "/api/interrupted-work/turn:n-read/dismiss", {})).status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ "turn:n-read": NOW });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("a turn that finished later is not listed", async () => {
    const { ids } = setup({ succeededAfter: (threadId) => threadId === "t-ben" });
    expect(await ids()).not.toContain("turn:n-read");
  });
});
