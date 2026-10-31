// What GET /api/doctor and the problem report send. The TECNICO robot and its watcher read the same shape.

export type DoctorStatus = "ok" | "warn" | "fail";

export type DoctorGroup = "engines" | "network" | "disk" | "tools" | "databases";

export interface DoctorCheck {
  /** Stable across runs: `engine:<instance>`, `network:<provider>`, `disk`, `tools:<name>`, `database:<file>`. */
  id: string;
  group: DoctorGroup;
  /** Short name in plain Portuguese, e.g. "Claude" or "Espaço em disco". */
  label: string;
  status: DoctorStatus;
  /** What is going on, in plain Portuguese. */
  detail: string;
  /** What to do about it, in plain Portuguese; present only when status is not ok. */
  fix?: string;
  /** Technical facts for whoever investigates, secrets already hidden. Shown folded under "detalhes". */
  technical?: string;
}

export interface DoctorReport {
  version: string;
  startedAt: string;
  durationMs: number;
  /** The worst status among the checks. */
  status: DoctorStatus;
  counts: Record<DoctorStatus, number>;
  checks: DoctorCheck[];
}

export interface ProblemReportPreview {
  /** The package exactly as it would be sent, secrets already hidden; the person may edit it. */
  text: string;
  target: ProblemReportTarget;
}

export interface ProblemReportTarget {
  botId: string;
  name: string;
  /** True when there is no TECNICO robot and the Chief of Staff receives it. */
  fallback: boolean;
}

export interface ProblemReportSent {
  target: ProblemReportTarget;
  threadId: string;
}

export const PROBLEM_REPORT_EXCERPT_CHOICES = [0, 5, 10, 20] as const;
export type ProblemReportExcerpt = (typeof PROBLEM_REPORT_EXCERPT_CHOICES)[number];

const RANK: Record<DoctorStatus, number> = { ok: 0, warn: 1, fail: 2 };

export function worstStatus(statuses: Iterable<DoctorStatus>): DoctorStatus {
  let worst: DoctorStatus = "ok";
  for (const status of statuses) if (RANK[status] > RANK[worst]) worst = status;
  return worst;
}
