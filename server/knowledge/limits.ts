export interface KnowledgeLimits {
  driveFileMaxBytes: number;
  spaceMaxBytes: number;
  maxFilesPerSpace: number;
  maxVersions: number;
  wikiPageMaxBytes: number;
  wikiMaxPages: number;
  importMaxFiles: number;
  importMaxBytes: number;
  trashDays: number;
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const DEFAULT_KNOWLEDGE_LIMITS: KnowledgeLimits = {
  driveFileMaxBytes: 100 * MIB,
  spaceMaxBytes: 20 * GIB,
  maxFilesPerSpace: 20_000,
  maxVersions: 100,
  wikiPageMaxBytes: 512 * 1024,
  wikiMaxPages: 5_000,
  importMaxFiles: 5_000,
  importMaxBytes: 500 * MIB,
  trashDays: 30,
};

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** A positive whole number in the environment replaces a default; anything else keeps it. */
export function knowledgeLimitsFromEnv(env: NodeJS.ProcessEnv): KnowledgeLimits {
  const base = DEFAULT_KNOWLEDGE_LIMITS;
  return {
    ...base,
    driveFileMaxBytes: positiveInteger(env.NORDUS_DRIVE_FILE_MAX_BYTES, base.driveFileMaxBytes),
    spaceMaxBytes: positiveInteger(env.NORDUS_DRIVE_SPACE_MAX_BYTES, base.spaceMaxBytes),
    importMaxBytes: positiveInteger(env.NORDUS_WIKI_IMPORT_MAX_BYTES, base.importMaxBytes),
    importMaxFiles: positiveInteger(env.NORDUS_WIKI_IMPORT_MAX_FILES, base.importMaxFiles),
  };
}
