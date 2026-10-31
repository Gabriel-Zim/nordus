/** `?desktop-settings=contas` opens Settings on "Contas e modelos"; the parameter is removed once read. */
export function takeAccountsRequest(href: string): string | null {
  const url = new URL(href);
  if (url.searchParams.get("desktop-settings") !== "contas") return null;
  url.searchParams.delete("desktop-settings");
  return `${url.pathname}${url.search}${url.hash}`;
}
