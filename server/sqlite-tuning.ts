import type { DatabaseSync } from "node:sqlite";

const CACHE_KIB = 32 * 1024;
const MMAP_BYTES = 256 * 1024 * 1024;
const WAL_LIMIT_BYTES = 64 * 1024 * 1024;

/** The default 2 MiB page cache cannot hold the newest messages of forty threads, so every list read goes back to the file. */
export function tuneConnection(db: DatabaseSync): void {
  db.exec(`PRAGMA cache_size = -${CACHE_KIB}`);
  db.exec(`PRAGMA mmap_size = ${MMAP_BYTES}`);
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec(`PRAGMA journal_size_limit = ${WAL_LIMIT_BYTES}`);
}

/** A reader that never lets go stops the automatic checkpoint; this one retries and never blocks a writer. */
export function checkpointPeriodically(db: DatabaseSync, everyMs = 10 * 60_000): () => void {
  const timer = setInterval(() => {
    try {
      db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    } catch {}
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
