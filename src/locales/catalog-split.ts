import type TypeScript from "typescript";

export type Catalog = Record<string, string>;

export interface SourceScan {
  staticImports: string[];
  literals: string[];
  stems: string[];
}

const STEM = /^[A-Za-z][\w-]*(?:\.[\w-]+)*\.$/;

export function modulePath(idOrPath: string): string {
  return idOrPath.split("?")[0]!.replaceAll("\\", "/");
}

export function isInside(idOrPath: string, dir: string): boolean {
  return modulePath(idOrPath).startsWith(`${modulePath(dir)}/`);
}

export function scanSource(ts: typeof TypeScript, fileName: string, text: string): SourceScan {
  const kind = /\.[mc]?tsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.[mc]?jsx?$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, false, kind);
  const scan: SourceScan = { staticImports: [], literals: [], stems: [] };
  const literal = (value: string) => {
    scan.literals.push(value);
    if (STEM.test(value)) scan.stems.push(value);
  };
  const visit = (node: TypeScript.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes = clause && (clause.isTypeOnly
        || (!clause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)));
      if (!onlyTypes) scan.staticImports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      scan.staticImports.push(node.moduleSpecifier.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literal(node.text);
    } else if (ts.isTemplateExpression(node)) {
      scan.literals.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
      if (/^[A-Za-z][\w-]*(?:\.[\w-]+)*\.[\w.-]*$/.test(node.head.text)) scan.stems.push(node.head.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return scan;
}

export interface CatalogSplit {
  core: Catalog;
  rest: Catalog;
}

export function splitCatalog(catalog: Catalog, launch: readonly SourceScan[], onDemand: readonly SourceScan[]): CatalogSplit {
  const named = new Set<string>();
  const stems = new Set<string>();
  for (const scan of launch) {
    for (const value of scan.literals) if (Object.hasOwn(catalog, value)) named.add(value);
    for (const stem of scan.stems) stems.add(stem);
  }
  const namedOnDemand = new Set<string>();
  for (const scan of onDemand) for (const value of scan.literals) if (Object.hasOwn(catalog, value)) namedOnDemand.add(value);
  const stemList = [...stems];
  const core: Catalog = {};
  const rest: Catalog = {};
  for (const [key, value] of Object.entries(catalog)) {
    const needed = named.has(key) || !namedOnDemand.has(key) || stemList.some((stem) => key.startsWith(stem));
    (needed ? core : rest)[key] = value;
  }
  return { core, rest };
}
