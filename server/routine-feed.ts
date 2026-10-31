// Nordus: as rotinas como um calendário iCal só de leitura, para o Avery assinar no Google Agenda.
// A URL leva um token secreto; sem token criado não há feed. O feed mostra só nome da rotina, robô e horário:
// a instrução da rotina nunca sai daqui, porque quem assina (o Google) busca o arquivo de fora.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { nextOccurrence, type RoutineSchedule } from "./routine-schedules.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const ROUTINE_FEED_PREFIX = "/api/routines/feed/";
export const ROUTINE_FEED_DAYS = 35;
const MAX_EVENTS = 500;
const PER_ROUTINE = 120;
/** A rotina de minuto em minuto vira um bloco por dia, não centenas de eventos. */
const BLOCK_BELOW_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const FILE = "routine-feed.json";

export interface FeedRoutine {
  id: string;
  name: string;
  botId: string;
  enabled: boolean;
  schedule: RoutineSchedule;
  durationMinutes?: number;
}

export interface FeedEvent { uid: string; start: number; end: number; summary: string }

/** Horários de uma rotina na janela [from, to), na mesma conta que o agendador faz. */
export function routineOccurrences(schedule: RoutineSchedule, from: number, to: number, limit = PER_ROUTINE * 300): number[] {
  const out: number[] = [];
  let cursor = from - 1;
  while (out.length < limit) {
    let next: number | null;
    try { next = nextOccurrence(schedule, cursor); } catch { break; }
    if (next === null || next >= to || next <= cursor) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

function intervalMs(schedule: RoutineSchedule): number | null {
  return schedule.type === "interval" ? schedule.everyMinutes * 60_000 : null;
}

/** Eventos de uma rotina: um por horário, ou blocos contínuos (até um dia) quando ela roda a cada poucos minutos. */
export function routineEvents(routine: FeedRoutine, botName: string, from: number, to: number): FeedEvent[] {
  if (!routine.enabled) return [];
  const summary = botName ? `${routine.name} · ${botName}` : routine.name;
  const times = routineOccurrences(routine.schedule, from, to);
  const step = intervalMs(routine.schedule);
  if (step !== null && step < BLOCK_BELOW_MS) {
    const blocks: FeedEvent[] = [];
    let start = -1;
    let last = -1;
    const close = () => {
      if (start < 0) return;
      blocks.push({ uid: `${routine.id}-${start}@nordus`, start, end: last + step, summary: `${summary} (a cada ${step / 60_000} min)` });
    };
    for (const at of times) {
      if (start >= 0 && at - last === step && at + step - start <= DAY_MS) { last = at; continue; }
      close();
      start = at;
      last = at;
    }
    close();
    return blocks.slice(0, PER_ROUTINE);
  }
  const minutes = Math.max(5, Math.min(24 * 60, Math.round(routine.durationMinutes ?? 15) || 15));
  return times.slice(0, PER_ROUTINE).map((start) => ({ uid: `${routine.id}-${start}@nordus`, start, end: start + minutes * 60_000, summary }));
}

function stamp(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545: barra, ponto e vírgula, vírgula e quebra de linha escapados. */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n|\r/g, "\\n");
}

/** Linhas de no máximo 75 octetos, continuação começando com espaço, sem partir um caractere UTF-8. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char);
    const max = parts.length === 0 ? 75 : 74;
    if (size + bytes > max) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function routineFeedIcs(input: {
  routines: readonly FeedRoutine[];
  botName: (botId: string) => string;
  now: number;
  days?: number;
}): string {
  const from = input.now;
  const to = input.now + (input.days ?? ROUTINE_FEED_DAYS) * DAY_MS;
  const events = input.routines
    .flatMap((routine) => routineEvents(routine, input.botName(routine.botId), from, to))
    .sort((a, b) => a.start - b.start || a.uid.localeCompare(b.uid))
    .slice(0, MAX_EVENTS);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nordus AI//Rotinas//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Rotinas do Nordus",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const now = stamp(input.now);
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsText(event.uid)}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(event.start)}`,
      `DTEND:${stamp(event.end)}`,
      `SUMMARY:${icsText(event.summary)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** O token mora num arquivo do servidor, legível só pelo dono do processo. */
export function createRoutineFeedTokens(dataDir: string) {
  const file = path.join(dataDir, FILE);
  const read = (): string | null => {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { token?: unknown };
      return typeof parsed.token === "string" && /^[A-Za-z0-9_-]{32,}$/.test(parsed.token) ? parsed.token : null;
    } catch {
      return null;
    }
  };
  return {
    current: read,
    rotate(now = Date.now()): string {
      const token = randomBytes(32).toString("base64url");
      mkdirSync(dataDir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ token, createdAt: now }), { mode: 0o600 });
      renameSync(temp, file);
      return token;
    },
    clear(): void {
      rmSync(file, { force: true });
    },
    matches(presented: string): boolean {
      const token = read();
      if (!token) return false;
      const digest = (value: string) => createHash("sha256").update(value).digest();
      return timingSafeEqual(digest(token), digest(presented));
    },
  };
}

export type RoutineFeedTokens = ReturnType<typeof createRoutineFeedTokens>;

export function routineFeedUrl(origin: string | null, token: string): string {
  return `${(origin ?? "").replace(/\/+$/, "")}${ROUTINE_FEED_PREFIX}${token}.ics`;
}

export function createRoutineFeed(options: {
  dataDir: string;
  routines: () => readonly FeedRoutine[];
  botName: (botId: string) => string;
  origin: (req: IncomingMessage) => string | null;
  now?: () => number;
  tokens?: RoutineFeedTokens;
}) {
  const tokens = options.tokens ?? createRoutineFeedTokens(options.dataDir);
  const now = options.now ?? Date.now;

  /** Antes do portão de login: quem tem a URL lê o calendário, e só isso. */
  const handlePublic = (_req: IncomingMessage, res: ServerResponse, urlPath: string, method: string): boolean => {
    if (!urlPath.startsWith(ROUTINE_FEED_PREFIX)) return false;
    const rest = urlPath.slice(ROUTINE_FEED_PREFIX.length);
    const match = /^([A-Za-z0-9_-]{32,128})\.ics$/.exec(rest);
    if (!match) return false;
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return true;
    }
    if (!tokens.matches(match[1]!)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end("not found");
      return true;
    }
    const body = routineFeedIcs({ routines: options.routines(), botName: options.botName, now: now() });
    res.writeHead(200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": "inline; filename=\"rotinas-nordus.ics\"",
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    });
    res.end(method === "HEAD" ? undefined : body);
    return true;
  };

  /** Depois do portão: só quem administra cria, troca ou desliga o link. */
  const routes: RouteHandler = async ({ req, res, path: urlPath, method, auth, json }) => {
    if (urlPath !== "/api/routines/feed") return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Só quem administra o Nordus pode ver o link do calendário." });
    if (method === "GET") {
      const token = tokens.current();
      return json(res, 200, { url: token ? routineFeedUrl(options.origin(req), token) : null });
    }
    if (method === "POST") return json(res, 200, { url: routineFeedUrl(options.origin(req), tokens.rotate(now())) });
    if (method === "DELETE") {
      tokens.clear();
      return json(res, 200, { url: null });
    }
    return json(res, 405, { error: "method not allowed" });
  };

  return { handlePublic, routes, tokens };
}
