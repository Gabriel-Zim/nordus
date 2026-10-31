// A page from an older build keeps working until a deploy removes a chunk it has not loaded yet. It reloads itself the first
// time it is hidden, and at once when a chunk fails and the server confirms a newer page; never during a call or an upload.

export interface PageBuildPlatform {
  ownBuild: () => string | null;
  /** The build of the page the server hands out now, or null when it cannot be reached. */
  fetchServedBuild: () => Promise<string | null>;
  hidden: () => boolean;
  onHiddenChange: (listener: () => void) => () => void;
  /** Something a reload would cut short: a call, an upload. */
  busy: () => boolean;
  reload: () => void;
  now: () => number;
  /** The last reload this tab made, so a server that keeps serving another page cannot loop it. */
  readReload: () => { build: string; at: number } | null;
  writeReload: (entry: { build: string; at: number }) => void;
}

/** One reload per served build per tab in this window: enough for a deploy, never a loop. */
export const BUILD_RELOAD_COOLDOWN_MS = 10 * 60_000;

export function createPageBuildWatch(platform: PageBuildPlatform) {
  let stopWaiting: (() => void) | null = null;

  const reloadFor = (build: string) => {
    const last = platform.readReload();
    if (last && last.build === build && platform.now() - last.at < BUILD_RELOAD_COOLDOWN_MS) return;
    stopWaiting?.();
    stopWaiting = null;
    platform.writeReload({ build, at: platform.now() });
    platform.reload();
  };

  return {
    /** The build the server serves, from the live stream's hello. */
    served(build: string): void {
      const own = platform.ownBuild();
      if (!own || own === build || stopWaiting) return;
      if (platform.hidden() && !platform.busy()) return reloadFor(build);
      stopWaiting = platform.onHiddenChange(() => {
        if (platform.hidden() && !platform.busy()) reloadFor(build);
      });
    },
    /** A lazy chunk failed to load. A network blip is not a deploy: reload only for a page the server confirms is newer. */
    async chunkFailed(): Promise<void> {
      if (platform.busy()) return;
      const own = platform.ownBuild();
      const served = await platform.fetchServedBuild();
      if (own && served && served !== own && !platform.busy()) reloadFor(served);
    },
  };
}

const RELOAD_KEY = "nordus.build-reload";
const pageBuildOf = (html: string) => /<meta name="nordus-build" content="([\w-]+)"/.exec(html)?.[1] ?? null;

function browserPlatform(): PageBuildPlatform {
  return {
    ownBuild: () => document.querySelector('meta[name="nordus-build"]')?.getAttribute("content") ?? null,
    fetchServedBuild: async () => {
      try {
        const response = await fetch("/", { cache: "no-store", credentials: "same-origin" });
        return response.ok ? pageBuildOf(await response.text()) : null;
      } catch {
        return null;
      }
    },
    // Not on blur: an Electron window loses focus to the bot's own desktop view inside it.
    hidden: () => document.visibilityState === "hidden",
    onHiddenChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    busy: () => [...holds].some((held) => held()),
    reload: () => window.location.reload(),
    now: Date.now,
    readReload: () => {
      try {
        const entry = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? "null") as { build?: unknown; at?: unknown } | null;
        return entry && typeof entry.build === "string" && typeof entry.at === "number" ? { build: entry.build, at: entry.at } : null;
      } catch {
        return null;
      }
    },
    writeReload: (entry) => {
      try {
        sessionStorage.setItem(RELOAD_KEY, JSON.stringify(entry));
      } catch {}
    },
  };
}

let watch: ReturnType<typeof createPageBuildWatch> | null = null;
const holds = new Set<() => boolean>();

/** While `held()` is true the page does not reload itself for a new build. */
export function holdReloadWhile(held: () => boolean): () => void {
  holds.add(held);
  return () => holds.delete(held);
}

/** A development page carries no server build stamp, so it never reloads on its own. */
export function installPageBuildWatch(): void {
  if (watch || import.meta.env.DEV || typeof document === "undefined") return;
  watch = createPageBuildWatch(browserPlatform());
  window.addEventListener("vite:preloadError", () => void watch?.chunkFailed());
}

export function noteServedBuild(build: string): void {
  watch?.served(build);
}
