const CLAUDE_HOSTS = ["claude.com", "claude.ai", "console.anthropic.com", "platform.claude.com"];

/** Security: never turn arbitrary process output into a sign-in link; the server applies the same rule first. */
export function claudeSignInLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const trusted = CLAUDE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    return url.protocol === "https:" && trusted && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function chatgptPlanLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://auth.openai.com" && url.pathname === "/api/accounts/authorize" &&
      !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}

/** Managed engines return their own sign-in page; still never a credentialed or non-https address. */
export function secureSignInLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}
