/** The app-wide MCP servers a bot mounts, by name, or undefined for every enabled one. Its own list wins; without
 * one, only an internal bot gets them all, because ZORG's own connections hold every client's work. */
export function botMcpServerNames(own: string[] | null | undefined, internal: boolean): string[] | undefined {
  return own ?? (internal ? undefined : []);
}

/** Whether going from one selection to the other, each as `botMcpServerNames` gives it, lets the bot use a server it
 * could not use before. No list means every server but the `explicit` ones. */
export function mcpSelectionWidens(before: string[] | undefined, after: string[] | undefined, explicit: readonly string[] = []): boolean {
  if (before === undefined) return after !== undefined && after.some((name) => explicit.includes(name));
  return after === undefined || after.some((name) => !before.includes(name));
}
