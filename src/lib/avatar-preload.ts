/** Pictures already asked for, so a bot list that changes on every message never starts the same download twice. */
const requested = new Set<string>();

/** Only the server's small WebP copies are cached; an original picture comes back with no-store, so a preload would fetch it twice. */
const CONVERTED_AVATAR = /-av-w[1-9]\d{0,4}h[1-9]\d{0,4}\.webp$/;

export function avatarUrlsToPreload(owners: ReadonlyArray<{ avatarUrl?: string | null }>): string[] {
  const urls = new Set<string>();
  for (const owner of owners) if (owner.avatarUrl && CONVERTED_AVATAR.test(owner.avatarUrl)) urls.add(owner.avatarUrl);
  return [...urls];
}

type Schedule = (run: () => void) => void;

const whenIdle: Schedule = (run) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2_000 });
  else setTimeout(run, 200);
};

/** Fetches and decodes the avatars off the render path, so the list shows them already painted. */
export function preloadAvatars(
  owners: ReadonlyArray<{ avatarUrl?: string | null }>,
  schedule: Schedule = whenIdle,
  create: () => { src: string; decode?: () => Promise<void> } | undefined = () => (typeof Image === "undefined" ? undefined : new Image()),
): void {
  for (const url of avatarUrlsToPreload(owners)) {
    if (requested.has(url)) continue;
    requested.add(url);
    schedule(() => {
      const image = create();
      if (!image) return;
      image.src = url;
      image.decode?.().catch(() => requested.delete(url));
    });
  }
}

export function __resetAvatarPreloadForTests(): void {
  requested.clear();
}
