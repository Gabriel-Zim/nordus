// Read before main.tsx's first-paint writes: applySkin stamps nordus-skin on every boot.
const PRIOR_RUN_KEYS = ["nordus-skin", "nordus-installed", "nordus-email-gate", "nordus-drafts", "nordus-show-threads"];

export function hasPriorRun(store: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return PRIOR_RUN_KEYS.some((key) => store?.getItem(key) != null);
  } catch {
    return false;
  }
}
