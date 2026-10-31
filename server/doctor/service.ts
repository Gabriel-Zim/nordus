import { worstStatus, type DoctorCheck, type DoctorGroup, type DoctorReport, type DoctorStatus } from "../../shared/doctor.ts";
import { technical } from "./checks.ts";

export const DOCTOR_TOTAL_MS = 20_000;
/** A report younger than this is served as is unless a refresh is asked for. */
export const DOCTOR_FRESH_MS = 60_000;
/** A refresh this soon after the last run gets that run: each run probes every provider and engine. */
export const DOCTOR_REFRESH_FLOOR_MS = 30_000;

export interface DoctorSource {
  group: DoctorGroup;
  /** Shown when the whole source fails or misses the deadline. */
  label: string;
  run(signal: AbortSignal): Promise<DoctorCheck[]>;
}

export interface DoctorServiceOptions {
  version(): string;
  sources: readonly DoctorSource[];
  totalMs?: number;
  freshMs?: number;
  now?: () => number;
}

/** One run at a time: callers during a run share it, and the last report is kept for the next caller. */
export function createDoctorService(options: DoctorServiceOptions) {
  const now = options.now ?? Date.now;
  const totalMs = options.totalMs ?? DOCTOR_TOTAL_MS;
  const freshMs = options.freshMs ?? DOCTOR_FRESH_MS;
  let last: { at: number; report: DoctorReport } | null = null;
  let running: Promise<DoctorReport> | null = null;

  async function runOnce(): Promise<DoctorReport> {
    const started = now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve("deadline"); }, totalMs);
    });
    try {
      const parts = await Promise.all(options.sources.map(async (source): Promise<DoctorCheck[]> => {
        try {
          const out = await Promise.race([source.run(controller.signal), deadline]);
          if (out === "deadline") return [unfinished(source, `não terminou em ${Math.round(totalMs / 1000)} segundos`)];
          return out;
        } catch (error) {
          return [unfinished(source, error instanceof Error ? error.message : String(error))];
        }
      }));
      const checks = parts.flat();
      const counts: Record<DoctorStatus, number> = { ok: 0, warn: 0, fail: 0 };
      for (const check of checks) counts[check.status] += 1;
      return {
        version: options.version(),
        startedAt: new Date(started).toISOString(),
        durationMs: now() - started,
        status: worstStatus(checks.map((check) => check.status)),
        counts,
        checks,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function report(opts: { refresh?: boolean } = {}): Promise<DoctorReport> {
    if (running) return running;
    const age = last ? now() - last.at : Infinity;
    if (last && age < (opts.refresh ? DOCTOR_REFRESH_FLOOR_MS : freshMs)) return Promise.resolve(last.report);
    running = runOnce().then((fresh) => {
      last = { at: now(), report: fresh };
      return fresh;
    }).finally(() => { running = null; });
    return running;
  }

  return { report, latest: (): DoctorReport | null => last?.report ?? null };
}

export type DoctorService = ReturnType<typeof createDoctorService>;

function unfinished(source: DoctorSource, why: string): DoctorCheck {
  return {
    id: `${source.group}:incompleto`,
    group: source.group,
    label: source.label,
    status: "warn",
    detail: "Esta verificação não pôde ser concluída agora.",
    fix: "Clique em Verificar de novo daqui a um minuto. Se continuar assim, relate o problema ao TECNICO.",
    technical: technical(why),
  };
}
