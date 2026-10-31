// Adapted from OpenClaw (https://github.com/openclaw/openclaw, commit facbe21d,
// extensions/memory-core/src/memory/temporal-decay.ts). Copyright (c) 2026 OpenClaw Foundation.
// Used under the MIT License; the full text is in third_party/openclaw/LICENSE.
// Changes: the timestamp comes with each result (an "at" in ms, or none for evergreen notes such as MEMORY.md and
// rules) instead of being read from file paths and mtimes, so this runs synchronously over recall results.

export const DEFAULT_HALF_LIFE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function applyTemporalDecayToScore(params: { score: number; ageInDays: number; halfLifeDays: number }): number {
  const { halfLifeDays } = params;
  const clampedAge = Math.max(0, params.ageInDays);
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0 || !Number.isFinite(clampedAge)) return params.score;
  return params.score * Math.exp(-(Math.LN2 / halfLifeDays) * clampedAge);
}

/** Older results weigh less; one without a date (evergreen) keeps its score. */
export function applyTemporalDecay<T extends { score: number; at?: number }>(
  results: readonly T[],
  options: { halfLifeDays?: number; nowMs?: number } = {},
): T[] {
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const nowMs = options.nowMs ?? Date.now();
  return results.map((entry) => {
    if (entry.at === undefined || !Number.isFinite(entry.at)) return entry;
    return { ...entry, score: applyTemporalDecayToScore({ score: entry.score, ageInDays: (nowMs - entry.at) / DAY_MS, halfLifeDays }) };
  });
}
