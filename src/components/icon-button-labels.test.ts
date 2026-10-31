import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

function unlabelledIconButtons(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "button") {
      const children = node.children.filter((child) => !(ts.isJsxText(child) && !child.getText().trim()));
      const iconOnly = children.length > 0 && children.every((child) => ts.isJsxSelfClosingElement(child) && /^[A-Z]/.test(child.tagName.getText()));
      const props = node.openingElement.attributes.properties;
      const names = props.map((prop) => prop.name?.getText());
      const spreads = props.some((prop) => ts.isJsxSpreadAttribute(prop));
      if (iconOnly && !spreads && !names.includes("aria-label") && !names.includes("aria-labelledby")) {
        found.push(`${relative(src, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("icon-only buttons", () => {
  it("each carries an aria-label, since a title is not read on touch", () => {
    expect(sources(src).flatMap(unlabelledIconButtons)).toEqual([]);
  });
});
