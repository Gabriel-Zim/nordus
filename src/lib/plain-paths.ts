/** People read a file's name, not where it sits on disk: a bare path in a reply becomes a file link named by its file. */
export const PLAIN_PATH = /(?<![\w:/.~])(?:~\/|\/)(?:[\w.@-]+\/)+[\w@-][\w.@-]*/g;
const WHOLE_PATH = /^(?:~\/|\/)(?:[\w.@-]+\/)+[\w@-][\w.@-]*$/;

export function isPlainPath(value: string): boolean {
  return WHOLE_PATH.test(value.trim());
}

export function pathFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

const SKIP = new Set(["link", "linkReference", "code", "inlineCode", "definition", "html", "math", "inlineMath"]);

function splitText(value: string): MdNode[] | null {
  PLAIN_PATH.lastIndex = 0;
  const out: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(PLAIN_PATH)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    out.push({ type: "link", url: match[0], children: [{ type: "text", value: pathFileName(match[0]) }] });
    last = start + match[0].length;
  }
  if (!out.length) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdNode): void {
  if (!node.children || SKIP.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      const parts = splitText(child.value);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    walk(child);
    next.push(child);
  }
  node.children = next;
}

export function remarkPlainPaths() {
  return (tree: MdNode) => walk(tree);
}
