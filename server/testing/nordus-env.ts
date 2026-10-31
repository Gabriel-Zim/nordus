// A shell exporting NORDUS_* / NORDUS_* leaks them into every child and import-time env snapshot.

const AMBIENT_PREFIXES = ["NORDUS_", "NORDUS_"] as const;

export function isAmbientNordusKey(key: string): boolean {
  return AMBIENT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function stripNordusEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isAmbientNordusKey(key)) clean[key] = value;
  }
  return clean;
}

export function childEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...stripNordusEnv(process.env), ...overrides };
}
