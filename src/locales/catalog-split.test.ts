import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isInside, modulePath, scanSource, splitCatalog, type SourceScan } from "./catalog-split";

const scan = (text: string, fileName = "file.tsx") => scanSource(ts, fileName, text);
const files = (...literals: string[]): SourceScan => ({ staticImports: [], literals, stems: [] });

describe("scanSource", () => {
  it("reads the strings a file names, in code and in JSX", () => {
    const found = scan(`const a = t("chat.send"); const b = <p title='chat.stop'>{\`composer.hint\`}</p>;`);
    expect(found.literals).toEqual(expect.arrayContaining(["chat.send", "chat.stop", "composer.hint"]));
  });

  it("reads the text around the holes of a template", () => {
    const found = scan("const key = `model.effort.${level}.hint`;");
    expect(found.literals).toEqual(["model.effort.", ".hint"]);
    expect(found.stems).toEqual(["model.effort."]);
  });

  it("takes a literal that ends in a dot for the start of a key built later", () => {
    const found = scan(`const stem = "approval.kind."; const sentence = "Hello there.";`);
    expect(found.stems).toEqual(["approval.kind."]);
  });

  it("follows the imports that run code, and leaves out the ones that do not", () => {
    const found = scan([
      `import { a } from "./a";`,
      `import "./side-effect";`,
      `import type { B } from "./b";`,
      `import { type C } from "./c";`,
      `import { type D, e } from "./d";`,
      `export * from "./f";`,
      `export type { G } from "./g";`,
      `const lazy = import("./h");`,
    ].join("\n"));
    expect(found.staticImports).toEqual(["./a", "./side-effect", "./d", "./f"]);
  });

  it("reads TypeScript and plain scripts by their extension", () => {
    expect(scan("const n = <T,>(x: T) => x; t('a.b');", "file.ts").literals).toContain("a.b");
    expect(scan("export const f = (x) => t('a.b');", "file.mjs").literals).toContain("a.b");
  });
});

describe("splitCatalog", () => {
  const catalog = {
    "chat.send": "Enviar",
    "settings.title": "Configurações",
    "shared.close": "Fechar",
    "orphan.key": "Ninguém usa",
    "kind.tool": "Ferramenta",
    "kind.task": "Tarefa",
    "server.reply": "Do servidor",
  };

  it("keeps the strings launch code names, and moves the ones only later screens name", () => {
    const { core, rest } = splitCatalog(
      catalog,
      [files("chat.send", "shared.close")],
      [files("settings.title", "shared.close")],
    );
    expect(Object.keys(core).sort()).toEqual(["chat.send", "kind.task", "kind.tool", "orphan.key", "server.reply", "shared.close"].sort());
    expect(Object.keys(rest)).toEqual(["settings.title"]);
  });

  it("keeps every key a launch stem could build", () => {
    const { core, rest } = splitCatalog(
      catalog,
      [{ staticImports: [], literals: ["kind."], stems: ["kind."] }],
      [files("kind.tool", "settings.title")],
    );
    expect(Object.keys(core)).toEqual(expect.arrayContaining(["kind.tool", "kind.task"]));
    expect(Object.keys(rest)).toEqual(["settings.title"]);
  });

  it("keeps a key nothing names, since something may build it", () => {
    const { core } = splitCatalog(catalog, [files("chat.send")], []);
    expect(Object.keys(core)).toEqual(Object.keys(catalog));
  });

  it("loses no string and gives none twice", () => {
    const { core, rest } = splitCatalog(catalog, [files("chat.send")], [files("settings.title")]);
    expect({ ...core, ...rest }).toEqual(catalog);
    expect(Object.keys(core).filter((key) => key in rest)).toEqual([]);
  });
});

describe("module paths", () => {
  const windowsSrc = path.win32.join("C:\\repo", "src");
  const windowsFile = path.win32.join(windowsSrc, "components", "Chat.tsx");
  const viteId = "C:/repo/src/components/Chat.tsx?v=1a2b3c";

  it("reads a Windows path and a Vite id for one file as the same module", () => {
    expect(windowsFile).not.toBe(viteId.split("?")[0]);
    expect(modulePath(windowsFile)).toBe(modulePath(viteId));
    expect(modulePath(viteId)).toBe("C:/repo/src/components/Chat.tsx");
  });

  it("finds that file inside its folder from either form, and not inside a folder that only starts like it", () => {
    expect(isInside(windowsFile, windowsSrc)).toBe(true);
    expect(isInside(viteId, windowsSrc)).toBe(true);
    expect(isInside("C:/repo/src2/components/Chat.tsx", windowsSrc)).toBe(false);
  });

  it("leaves a POSIX path as it is", () => {
    expect(modulePath("/repo/src/components/Chat.tsx")).toBe("/repo/src/components/Chat.tsx");
    expect(isInside("/repo/src/components/Chat.tsx", "/repo/src")).toBe(true);
    expect(isInside("/repo/src2/components/Chat.tsx", "/repo/src")).toBe(false);
  });
});
