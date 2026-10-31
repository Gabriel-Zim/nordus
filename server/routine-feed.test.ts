import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRoutineFeed, createRoutineFeedTokens, foldLine, icsText, routineEvents, routineFeedIcs, routineOccurrences, type FeedRoutine } from "./routine-feed.ts";
import { PASS } from "./routes/table.ts";
import type { RoutineSchedule } from "./routine-schedules.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 0, 5, 0, 0, 0);

let dir = "";
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "routine-feed-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const routine = (schedule: RoutineSchedule, extra: Partial<FeedRoutine> = {}): FeedRoutine => ({ id: "r1", name: "Resumo", botId: "b1", enabled: true, schedule, ...extra });

function fakeRes() {
  const out = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) { out.status = status; out.headers = headers ?? {}; return res; },
    end(body?: string) { out.body = body ?? ""; return res; },
  };
  return { res: res as unknown as ServerResponse, out };
}
const req = (host = "agenda.example") => ({ headers: { host } }) as unknown as IncomingMessage;

describe("ocorrências", () => {
  it("lista os horários diários da janela", () => {
    const times = routineOccurrences({ type: "interval", everyMinutes: 1440, anchorAt: NOW }, NOW, NOW + 3 * DAY);
    expect(times).toEqual([NOW, NOW + DAY, NOW + 2 * DAY]);
  });
  it("rotina desligada não gera evento", () => {
    expect(routineEvents(routine({ type: "once", at: NOW + HOUR }, { enabled: false }), "Bot", NOW, NOW + DAY)).toEqual([]);
  });
  it("uma vez vira um evento com a duração da rotina", () => {
    const [event] = routineEvents(routine({ type: "once", at: NOW + HOUR }, { durationMinutes: 30 }), "Bot", NOW, NOW + DAY);
    expect(event).toMatchObject({ start: NOW + HOUR, end: NOW + HOUR + 30 * 60_000, summary: "Resumo · Bot" });
  });
  it("intervalo curto vira blocos de no máximo um dia", () => {
    const events = routineEvents(routine({ type: "interval", everyMinutes: 10, anchorAt: NOW }), "Bot", NOW, NOW + 2 * DAY);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(3);
    for (const event of events) {
      expect(event.end - event.start).toBeLessThanOrEqual(DAY + 10 * 60_000);
      expect(event.summary).toContain("a cada 10 min");
    }
  });
});

describe("ICS", () => {
  it("escapa barra, ponto e vírgula, vírgula e quebra de linha", () => {
    expect(icsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
  it("dobra linhas em 75 octetos sem partir caractere", () => {
    const folded = foldLine(`SUMMARY:${"ã".repeat(80)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const [index, line] of lines.entries()) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
      if (index > 0) expect(line.startsWith(" ")).toBe(true);
    }
    expect(lines.map((line, index) => (index ? line.slice(1) : line)).join("")).toBe(`SUMMARY:${"ã".repeat(80)}`);
  });
  it("monta o calendário e nunca inclui a instrução da rotina", () => {
    const secret = { ...routine({ type: "once", at: NOW + HOUR }), prompt: "SEGREDO-DA-INSTRUCAO" } as FeedRoutine;
    const ics = routineFeedIcs({ routines: [secret], botName: () => "Bot", now: NOW });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("SUMMARY:Resumo · Bot");
    expect(ics).not.toContain("SEGREDO");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("token", () => {
  it("rotate, matches e clear", () => {
    const tokens = createRoutineFeedTokens(dir);
    expect(tokens.current()).toBeNull();
    expect(tokens.matches("x".repeat(43))).toBe(false);
    const first = tokens.rotate();
    expect(tokens.matches(first)).toBe(true);
    expect(tokens.matches(`${first}x`)).toBe(false);
    const second = tokens.rotate();
    expect(second).not.toBe(first);
    expect(tokens.matches(first)).toBe(false);
    expect(tokens.matches(second)).toBe(true);
    tokens.clear();
    expect(tokens.matches(second)).toBe(false);
  });
  it("o arquivo fica 0600", () => {
    createRoutineFeedTokens(dir).rotate();
    expect(statSync(path.join(dir, "routine-feed.json")).mode & 0o777).toBe(0o600);
  });
});

describe("rotas", () => {
  const feed = () => createRoutineFeed({ dataDir: dir, routines: () => [{ ...routine({ type: "once", at: NOW + HOUR }), prompt: "SEGREDO" } as FeedRoutine], botName: () => "Bot", origin: () => "https://n.example", now: () => NOW });

  it("ignora caminhos que não são do feed", () => {
    const { res } = fakeRes();
    expect(feed().handlePublic(req(), res, "/api/routines", "GET")).toBe(false);
  });
  it("404 com token errado, 200 text/calendar com o certo, 405 em POST", () => {
    const f = feed();
    const token = f.tokens.rotate();
    const wrong = fakeRes();
    expect(f.handlePublic(req(), wrong.res, `/api/routines/feed/${"a".repeat(43)}.ics`, "GET")).toBe(true);
    expect(wrong.out.status).toBe(404);
    const ok = fakeRes();
    f.handlePublic(req(), ok.res, `/api/routines/feed/${token}.ics`, "GET");
    expect(ok.out.status).toBe(200);
    expect(ok.out.headers["content-type"]).toContain("text/calendar");
    expect(ok.out.body).toContain("BEGIN:VCALENDAR");
    expect(ok.out.body).not.toContain("SEGREDO");
    const post = fakeRes();
    f.handlePublic(req(), post.res, `/api/routines/feed/${token}.ics`, "POST");
    expect(post.out.status).toBe(405);
  });
  it("sem token criado não há feed", () => {
    const f = feed();
    const out = fakeRes();
    f.handlePublic(req(), out.res, `/api/routines/feed/${"a".repeat(43)}.ics`, "GET");
    expect(out.out.status).toBe(404);
  });
  it("rota admin: 403 sem escopo admin, GET/POST/DELETE com admin", async () => {
    const f = feed();
    const calls: Array<{ status: number; value: any }> = [];
    const json = ((_res: unknown, status: number, value: unknown) => { calls.push({ status, value }); }) as never;
    const ctx = (method: string, scopes: string[], pathName = "/api/routines/feed") => ({ req: req(), res: fakeRes().res, url: new URL(`http://x${pathName}`), path: pathName, method, auth: { kind: "loopback", scopes } as never, json, readBody: (async () => ({})) as never });
    expect(await f.routes(ctx("GET", ["admin"], "/api/other"))).toBe(PASS);
    await f.routes(ctx("GET", ["read"]));
    expect(calls.at(-1)!.status).toBe(403);
    await f.routes(ctx("GET", ["admin"]));
    expect(calls.at(-1)!.value.url).toBeNull();
    await f.routes(ctx("POST", ["admin"]));
    const url = calls.at(-1)!.value.url as string;
    expect(url).toMatch(/^https:\/\/n\.example\/api\/routines\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    await f.routes(ctx("GET", ["admin"]));
    expect(calls.at(-1)!.value.url).toBe(url);
    await f.routes(ctx("DELETE", ["admin"]));
    expect(calls.at(-1)!.value.url).toBeNull();
  });
});
