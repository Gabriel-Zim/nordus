import { once } from "node:events";
import { Worker } from "node:worker_threads";

const HOLDER = `
const { DatabaseSync } = require("node:sqlite");
const { parentPort, workerData } = require("node:worker_threads");
const db = new DatabaseSync(workerData.path);
db.exec("BEGIN IMMEDIATE");
parentPort.postMessage("locked");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.ms);
db.exec("COMMIT");
db.close();
`;

/** Takes the write lock on `path` from another thread and holds it for `ms`; resolves once the lock is held. */
export async function holdWriteLock(path: string, ms: number): Promise<{ released: Promise<void> }> {
  const worker = new Worker(HOLDER, { eval: true, workerData: { path, ms } });
  await once(worker, "message");
  return { released: once(worker, "exit").then(() => undefined) };
}
