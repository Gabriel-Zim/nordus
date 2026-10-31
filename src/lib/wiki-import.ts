import type { KnowledgeSpaceId, WikiImportLimits, WikiImportSummary } from "../../shared/knowledge";
import { isHiddenPath, isKnowledgeCode, type VaultFile } from "./knowledge-ui";

export interface ImportApi {
  start(space: KnowledgeSpaceId, root: string): Promise<{ session: string; root: string; limits: WikiImportLimits }>;
  file(space: KnowledgeSpaceId, session: string, path: string, body: Blob, signal?: AbortSignal): Promise<{ accepted: boolean; skipped?: string }>;
  finish(space: KnowledgeSpaceId, session: string): Promise<WikiImportSummary>;
  cancel(space: KnowledgeSpaceId, session: string): Promise<unknown>;
}

export interface ImportProgress {
  phase: "sending" | "finishing";
  sent: number;
  total: number;
}

export interface ImportOutcome {
  summary: WikiImportSummary;
  /** Files the browser did not send: hidden folders such as .obsidian, files over the size cap, and what came after the cap on the number of files. */
  leftOut: number;
  /** The server's cap on files or total size was reached, so the rest of the vault stayed behind. */
  hitLimit: boolean;
}

const FAILURES_ALLOWED = 20;

export async function runVaultImport(options: {
  api: ImportApi;
  space: KnowledgeSpaceId;
  root: string;
  files: readonly VaultFile[];
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
}): Promise<ImportOutcome> {
  const { api, space, signal } = options;
  signal?.throwIfAborted();
  const started = await api.start(space, options.root);
  const limits = started.limits;
  let leftOut = 0;
  let bytes = 0;
  let hitLimit = false;
  const queue: VaultFile[] = [];
  for (const entry of options.files) {
    if (isHiddenPath(entry.path) || entry.file.size > limits.maxFileBytes) {
      leftOut += 1;
    } else if (queue.length >= limits.maxFiles || bytes + entry.file.size > limits.maxBytes) {
      leftOut += 1;
      hitLimit = true;
    } else {
      queue.push(entry);
      bytes += entry.file.size;
    }
  }

  let next = 0;
  let sent = 0;
  let failures = 0;
  let firstError: unknown;
  let stopped = false;
  const total = queue.length;
  options.onProgress?.({ phase: "sending", sent, total });

  const worker = async () => {
    while (!stopped && next < queue.length) {
      signal?.throwIfAborted();
      const entry = queue[next]!;
      next += 1;
      try {
        await api.file(space, started.session, entry.path, entry.file, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (isKnowledgeCode(error, "limit") || isKnowledgeCode(error, "full")) {
          hitLimit = true;
          stopped = true;
          leftOut += queue.length - next + 1;
          return;
        }
        failures += 1;
        leftOut += 1;
        firstError ??= error;
        if (failures > FAILURES_ALLOWED) {
          stopped = true;
          throw firstError;
        }
      }
      sent += 1;
      options.onProgress?.({ phase: "sending", sent, total });
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 3, total || 1)) }, worker));
    signal?.throwIfAborted();
    options.onProgress?.({ phase: "finishing", sent, total });
    const summary = await api.finish(space, started.session);
    return { summary, leftOut, hitLimit };
  } catch (error) {
    await api.cancel(space, started.session).catch(() => undefined);
    throw error;
  }
}
