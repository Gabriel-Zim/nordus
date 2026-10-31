// Nordus: o raio-x diário das saídas de internet dos robôs. Para cada saída confere que ela está no ar, qual IP, cidade e
// ASN o mundo vê (ipinfo.io) e que uma página abre (generate_204). Não mede detecção. Se alguma coisa piorou (saída caiu,
// IP mudou desde o último raio-x, página não abriu), grava uma linha datada em browser-exits-incidents.log no dataDir e
// avisa o log do servidor. Nada vai para conversas. Sem usuário nem senha: só nomes como "PROXY_1" e o IP de saída.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { duplexPair } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { join } from "node:path";

import type { Exit } from "./proxy-pool.ts";

const FETCH_MS = 20_000;
export const INCIDENTS_FILE = "browser-exits-incidents.log";
const IPS_FILE = "browser-exits-ip.json";

export interface FetchedPage { status: number; body: string }
export type FetchVia = (exit: Exit, url: string) => Promise<FetchedPage>;

/** Uma requisição GET (HTTP/1.0, sem resposta em pedaços) passando por `exit`; `https` usa TLS por dentro da saída. */
export const fetchViaExit: FetchVia = async (exit, rawUrl) => {
  const url = new URL(rawUrl);
  const secure = url.protocol === "https:";
  const port = Number(url.port) || (secure ? 443 : 80);
  const opened = await exit.upstream.open({ host: url.hostname, port });
  if (!("join" in opened)) throw new Error("a saída não abriu a conexão");
  const [near, far] = duplexPair();
  opened.join(far);
  const stream = secure ? tlsConnect({ socket: near, servername: url.hostname }) : near;
  return await new Promise<FetchedPage>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => finish(new Error("tempo esgotado")), FETCH_MS);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      stream.destroy();
      far.destroy();
      if (error) return reject(error);
      const raw = Buffer.concat(chunks).toString("utf8");
      const split = raw.indexOf("\r\n\r\n");
      const head = split < 0 ? raw : raw.slice(0, split);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/u.exec(head)?.[1]);
      if (!status) return reject(new Error("resposta inválida"));
      resolve({ status, body: split < 0 ? "" : raw.slice(split + 4) });
    };
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("end", () => finish());
    stream.once("close", () => finish());
    stream.once("error", (error) => finish(error));
    stream.write(`GET ${url.pathname}${url.search} HTTP/1.0\r\nHost: ${url.host}\r\nUser-Agent: nordus-raio-x\r\nAccept: application/json, */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`);
  });
};

export interface ExitCheck {
  name: string;
  kind: "proxy" | "home";
  up: boolean;
  ip?: string;
  city?: string;
  asn?: string;
  /** O IP do raio-x anterior, quando mudou. */
  previousIp?: string;
  page?: number;
  worse: boolean;
  reasons: string[];
}

function readIps(dir: string | undefined): Record<string, string> {
  if (!dir) return {};
  try { return JSON.parse(readFileSync(join(dir, IPS_FILE), "utf8")) as Record<string, string>; } catch { return {}; }
}

function writeIps(dir: string | undefined, ips: Record<string, string>): void {
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const temp = join(dir, `${IPS_FILE}.${process.pid}.tmp`);
    writeFileSync(temp, JSON.stringify(ips), { mode: 0o600 });
    renameSync(temp, join(dir, IPS_FILE));
  } catch { /* o raio-x segue sem guardar o IP */ }
}

export interface ExitHealthOptions {
  exits: readonly Exit[];
  dataDir?: string;
  fetchVia?: FetchVia;
  now?: () => Date;
  /** O log do servidor. */
  log?: (line: string) => void;
  ipinfoUrl?: string;
  pageUrl?: string;
}

/** O raio-x de agora; devolve uma verificação por saída e anota as que pioraram. */
export async function runExitHealth(options: ExitHealthOptions): Promise<ExitCheck[]> {
  const fetchVia = options.fetchVia ?? fetchViaExit;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.warn(line));
  const ips = readIps(options.dataDir);
  const checks: ExitCheck[] = [];
  for (const exit of options.exits) {
    const reasons: string[] = [];
    const check: ExitCheck = { name: exit.name, kind: exit.kind, up: false, worse: false, reasons };
    check.up = (await exit.probe().catch(() => "offline")) === "online";
    if (!check.up) reasons.push("saída fora do ar");
    else {
      try {
        const info = await fetchVia(exit, options.ipinfoUrl ?? "https://ipinfo.io/json");
        const data = JSON.parse(info.body) as { ip?: unknown; city?: unknown; org?: unknown };
        if (info.status !== 200 || typeof data.ip !== "string") throw new Error(`status ${info.status}`);
        check.ip = data.ip;
        if (typeof data.city === "string") check.city = data.city;
        if (typeof data.org === "string") check.asn = data.org;
        const before = ips[exit.name];
        if (before && before !== data.ip) { check.previousIp = before; reasons.push(`IP mudou (${before} para ${data.ip})`); }
        ips[exit.name] = data.ip;
      } catch (error) {
        reasons.push(`não deu para ler o IP (${error instanceof Error ? error.message : "erro"})`);
      }
      try {
        const page = await fetchVia(exit, options.pageUrl ?? "https://www.google.com/generate_204");
        check.page = page.status;
        if (page.status !== 204) reasons.push(`a página respondeu ${page.status} em vez de 204`);
      } catch (error) {
        reasons.push(`a página não abriu (${error instanceof Error ? error.message : "erro"})`);
      }
    }
    check.worse = reasons.length > 0;
    checks.push(check);
  }
  writeIps(options.dataDir, ips);
  for (const check of checks.filter((entry) => entry.worse)) {
    const line = `${now().toISOString()} ${check.name} piorou: ${check.reasons.join("; ")}`;
    log(`[raio-x das saídas] ${line}`);
    if (options.dataDir) {
      try { mkdirSync(options.dataDir, { recursive: true }); appendFileSync(join(options.dataDir, INCIDENTS_FILE), `${line}\n`); } catch { /* fica só no log */ }
    }
  }
  return checks;
}

/** Quanto falta até a próxima `hour`:00 no fuso `timeZone`. */
export function msUntilDaily(hour: number, timeZone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const seconds = value("hour") * 3600 + value("minute") * 60 + value("second");
  const wait = (hour * 3600 - seconds + 86_400) % 86_400;
  return (wait === 0 ? 86_400 : wait) * 1000;
}

/** Roda `task` todo dia às 06:00 de São Paulo, até chamar o que a função devolve. */
export function scheduleDailyRaioX(task: () => Promise<unknown>, options: { hour?: number; timeZone?: string; now?: () => Date } = {}): () => void {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    timer = setTimeout(() => { void task().catch(() => undefined).finally(arm); }, msUntilDaily(options.hour ?? 6, options.timeZone ?? "America/Sao_Paulo", options.now?.()));
    timer.unref();
  };
  arm();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
