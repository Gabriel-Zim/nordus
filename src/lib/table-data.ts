export const TABLE_FILE_MAX_BYTES = 10 * 1024 * 1024;

export interface TextTable { headers: string[]; rows: string[][] }
export type TableSort = { column: number; descending: boolean } | null;

export function tableDelimiter(name: string): "," | "\t" | null {
  return /\.csv$/i.test(name) ? "," : /\.tsv$/i.test(name) ? "\t" : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export function isTableNumber(text: string): boolean { return NUMBER.test(text.trim()); }

export function tableRowOrder(rows: readonly (readonly string[])[], query: string, sort: TableSort): number[] {
  const needle = query.trim().toLocaleLowerCase();
  const order = rows.flatMap((row, index) => !needle || row.some((cell) => cell.toLocaleLowerCase().includes(needle)) ? [index] : []);
  if (sort) order.sort((a, b) => {
    const left = rows[a]![sort.column] ?? "", right = rows[b]![sort.column] ?? "";
    if (!left.trim() || !right.trim()) return Number(!left.trim()) - Number(!right.trim()) || a - b;
    const numeric = isTableNumber(left) && isTableNumber(right);
    let difference: number;
    if (numeric && /^[+-]?\d+$/.test(left.trim()) && /^[+-]?\d+$/.test(right.trim())) {
      const l = BigInt(left.trim()), r = BigInt(right.trim());
      difference = l < r ? -1 : l > r ? 1 : 0;
    } else difference = numeric ? Number(left) - Number(right) : collator.compare(left, right);
    return (Number.isFinite(difference) ? difference : collator.compare(left, right)) * (sort.descending ? -1 : 1) || a - b;
  });
  return order;
}
