/** What a search compares: no accents, case, spaces, hyphens, dots or underscores, so "zim studio" finds zim-studio. */
function searchKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s._-]+/g, "");
}

/** True when the search is empty or any of the names (the one on screen, the technical one) contains it. */
export function matchesSearch(query: string, ...names: Array<string | null | undefined>): boolean {
  const wanted = searchKey(query);
  if (!wanted) return true;
  return names.some((name) => Boolean(name) && searchKey(name!).includes(wanted));
}
