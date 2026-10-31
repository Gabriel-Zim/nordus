// Adapted from OpenClaw (https://github.com/openclaw/openclaw, commit facbe21d,
// extensions/memory-core/src/memory/mmr.ts). Copyright (c) 2026 OpenClaw Foundation.
// Used under the MIT License; the full text is in third_party/openclaw/LICENSE.
// Changes: config type and lowercasing helper inlined; default lambda kept at 0.7.
import { jaccardSimilarity, tokenize } from "./tokenize.ts";

// Carbonell & Goldstein (1998): maximize λ * relevance - (1-λ) * similarity.

type MMRItem = { score: number; snippet: string };

export const DEFAULT_MMR_LAMBDA = 0.7;

type PreparedMMRItem<T extends MMRItem> = {
  item: T;
  score: number;
  tokens: Set<string>;
  emptyTokenText: string | undefined;
  relevance: number;
  maxSimilarity: number;
};

export function applyMMR<T extends MMRItem>(items: readonly T[], lambda = DEFAULT_MMR_LAMBDA): T[] {
  if (items.length <= 1) return [...items];
  const clampedLambda = Math.max(0, Math.min(1, lambda));
  if (clampedLambda === 1) return items.toSorted((a, b) => b.score - a.score);
  const prepared: PreparedMMRItem<T>[] = items.map((item) => {
    const tokens = tokenize(item.snippet);
    return {
      item,
      score: item.score,
      tokens,
      emptyTokenText: tokens.size === 0 ? item.snippet.toLowerCase() : undefined,
      relevance: 0,
      maxSimilarity: 0,
    };
  });
  const maxScore = Math.max(...prepared.map((item) => item.score));
  const minScore = Math.min(...prepared.map((item) => item.score));
  const scoreRange = maxScore - minScore;
  for (const item of prepared) item.relevance = scoreRange === 0 ? 1 : (item.score - minScore) / scoreRange;
  const remaining = new Set(prepared);
  const selected: T[] = [];
  while (remaining.size > 0) {
    let bestItem: PreparedMMRItem<T> | null = null;
    let bestMMRScore = -Infinity;
    for (const candidate of remaining) {
      const mmrScore = clampedLambda * candidate.relevance - (1 - clampedLambda) * candidate.maxSimilarity;
      if (mmrScore > bestMMRScore || (mmrScore === bestMMRScore && candidate.score > (bestItem?.score ?? -Infinity))) {
        bestMMRScore = mmrScore;
        bestItem = candidate;
      }
    }
    if (!bestItem) break;
    selected.push(bestItem.item);
    remaining.delete(bestItem);
    // A selected item's contribution never changes, so each candidate's running maximum is updated once per pair.
    for (const candidate of remaining) {
      const similarity = candidate.tokens.size === 0 && bestItem.tokens.size === 0
        ? Number(candidate.emptyTokenText === bestItem.emptyTokenText)
        : jaccardSimilarity(candidate.tokens, bestItem.tokens);
      if (similarity > candidate.maxSimilarity) candidate.maxSimilarity = similarity;
    }
  }
  return selected;
}
