// Adapted from OpenClaw (https://github.com/openclaw/openclaw, commit facbe21d,
// extensions/memory-core/src/memory/tokenize.ts). Copyright (c) 2026 OpenClaw Foundation.
// Used under the MIT License; the full text is in third_party/openclaw/LICENSE.
// Changes: plugin-sdk lowercasing replaced by String.toLowerCase.

const CJK_RE = /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u1100-\u11ff]/;
const CJK_RUN_RE = new RegExp(`${CJK_RE.source}+`, "g");

// Only adjacent CJK characters form bigrams.
export function tokenize(text: string): Set<string> {
  const lower = (text ?? "").toLowerCase().normalize("NFC");
  const words = lower.replace(CJK_RUN_RE, " ").match(/[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*/gu) ?? [];
  const tokens = new Set(words);
  const cjkRuns = lower.match(CJK_RUN_RE) ?? [];
  for (const run of cjkRuns) {
    for (let index = 1; index < run.length; index += 1) tokens.add(run.slice(index - 1, index + 1));
  }
  for (const run of cjkRuns) {
    for (const char of run) tokens.add(char);
  }
  return tokens;
}

export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersectionSize = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;
  for (const token of smaller) if (larger.has(token)) intersectionSize++;
  return intersectionSize / (setA.size + setB.size - intersectionSize);
}
