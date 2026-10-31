import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { DurationSequencer } from "./scripts/testing/duration-sequencer.ts";
import { UI_MANIFEST_FILE, buildUiManifest } from "./scripts/ui-manifest.ts";
import { isInside, modulePath, scanSource, splitCatalog, type Catalog, type SourceScan } from "./src/locales/catalog-split.ts";
import { hostTimeout } from "./server/testing/host-timeout.ts";

// The About dialog's version, inlined at build time: the preload bridge is
// absent in dev.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

// The server echoes the stamp of the page it serves, so an open page from another build knows to reload. Equal pages hash
// equal: a deploy that leaves the page unchanged reloads nobody.
const buildStamp = {
  name: "nordus-build-stamp",
  transformIndexHtml: {
    order: "post" as const,
    handler: (html: string) => html.replace(
      "</head>",
      `  <meta name="nordus-build" content="${createHash("sha256").update(html).digest("hex").slice(0, 16)}" />\n  </head>`,
    ),
  },
};

// The Mac shell embeds this build and updates itself from the manifest; written last, after public/ is copied in.
let outDir = "";
const uiManifest = {
  name: "nordus-ui-manifest",
  apply: "build" as const,
  configResolved: (config: { root: string; build: { outDir: string } }) => {
    outDir = path.resolve(config.root, config.build.outDir);
  },
  closeBundle: () => {
    writeFileSync(path.join(outDir, UI_MANIFEST_FILE), `${JSON.stringify(buildUiManifest(outDir), null, 2)}\n`);
  },
};

const CATALOG_REST = "virtual:nordus-catalog-rest";
const SCANNED = /\.(?:tsx?|mts|mjs|js)$/;
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"];

function catalogSplit(): Plugin {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = modulePath(path.join(root, "src"));
  const inSrc = (...parts: string[]) => modulePath(path.join(srcDir, ...parts));
  const i18nFile = inSrc("lib", "i18n.ts");
  const ptBrFile = inSrc("locales", "pt-br.json");
  const localesDir = inSrc("locales");
  let building = false;
  let ts: typeof import("typescript") | undefined;
  const scans = new Map<string, SourceScan>();
  const launchFiles = new Set<string>();
  let rest: Catalog = {};
  let core: Catalog = {};

  const scan = (file: string): SourceScan => {
    let found = scans.get(file);
    if (!found) {
      found = scanSource(ts!, file, readFileSync(file, "utf8"));
      scans.set(file, found);
    }
    return found;
  };
  const resolveSource = (from: string, specifier: string): string | undefined => {
    const base = specifier.startsWith("@/") ? path.join(srcDir, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : undefined;
    if (!base) return undefined;
    const found = SOURCE_EXTENSIONS.map((extension) => base + extension).find((candidate) => SCANNED.test(candidate) && existsSync(candidate));
    return found && modulePath(found);
  };
  const sources = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) sources(file, out);
      } else if (SCANNED.test(entry.name) && !/\.(?:test|node-test)\.|\.d\.ts$/.test(entry.name)) {
        out.push(modulePath(file));
      }
    }
    return out;
  };
  const usesStrings = (file: string) => {
    const found = scan(file);
    return found.staticImports.some((specifier) => resolveSource(file, specifier) === i18nFile) || found.literals.some((value) => Object.hasOwn(rest, value));
  };

  return {
    name: "nordus-catalog-split",
    enforce: "pre",
    configResolved(config) {
      building = config.command === "build";
    },
    async buildStart() {
      if (!building) return;
      ts = (await import("typescript")).default;
      const queue = [inSrc("main.tsx")];
      while (queue.length) {
        const file = queue.pop()!;
        if (launchFiles.has(file)) continue;
        launchFiles.add(file);
        for (const specifier of scan(file).staticImports) {
          const target = resolveSource(file, specifier);
          if (target) queue.push(target);
        }
      }
      const beyondTheApp = ["shared", "server", "electron"].flatMap((dir) => sources(path.join(root, dir)));
      const onDemand = sources(srcDir).filter((file) => !launchFiles.has(file) && !isInside(file, localesDir));
      ({ core, rest } = splitCatalog(
        JSON.parse(readFileSync(ptBrFile, "utf8")) as Catalog,
        [...launchFiles, ...beyondTheApp].map(scan),
        onDemand.map(scan),
      ));
    },
    resolveId(source, importer) {
      if (source === CATALOG_REST) return `\0${CATALOG_REST}`;
      if (building && importer && modulePath(importer) === i18nFile && modulePath(path.resolve(path.dirname(i18nFile), source.replace(/^@\//, `${srcDir}/`))) === ptBrFile) return "\0nordus-catalog-core";
      return null;
    },
    load(id) {
      if (id === "\0nordus-catalog-core") return `export default ${JSON.stringify(core)};`;
      if (id !== `\0${CATALOG_REST}`) return null;
      if (!building) return "export {};";
      return `import { extendFallback } from ${JSON.stringify(i18nFile)};\nextendFallback(${JSON.stringify(rest)});`;
    },
    transform(code, id) {
      const file = modulePath(id);
      if (!building || file.includes("\0") || !isInside(file, srcDir) || !SCANNED.test(file) || launchFiles.has(file) || isInside(file, localesDir) || !usesStrings(file)) return null;
      return { code: `import ${JSON.stringify(CATALOG_REST)};${code}`, map: null };
    },
    generateBundle(_options, bundle) {
      if (!building) return;
      const missing: string[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk" || !item.isEntry) continue;
        for (const [id, rendered] of Object.entries(item.modules)) {
          const file = modulePath(id);
          if (!isInside(file, srcDir) || !rendered.code) continue;
          for (const value of scanSource(ts!, `${file}.js`, rendered.code).literals) {
            if (Object.hasOwn(rest, value)) missing.push(`${value} (${path.relative(root, file)})`);
          }
        }
      }
      if (missing.length) this.error(`The launch bundle names keys the catalog split moved out of it:\n${missing.join("\n")}`);
    },
  };
}

// Packages of the start-up bundle move rarely: their own chunks keep the same hash across releases, so a release
// re-downloads the app code only.
const VENDOR_CHUNKS: Array<[string, RegExp]> = [
  ["vendor-react", /^(react|react-dom|scheduler)$/],
  ["vendor-markdown", /^(?!.*math)(react-markdown|remark-.*|micromark.*|mdast-.*|hast-util-to-jsx-runtime|hast-util-whitespace|unist-.*|unified|vfile.*|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities.*|trim-lines|bail|trough|is-plain-obj|devlop|ccount|markdown-table|zwitch|longest-streak|stringify-entities|parse-entities|inline-style-parser|style-to-.*|extend|@ungap\/structured-clone)$/],
  ["vendor-utils", /^(zod|tailwind-merge|@tanstack\/.*)$/],
];

function vendorChunk(id: string): string | undefined {
  const name = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(id)?.[1];
  return name ? VENDOR_CHUNKS.find(([, pattern]) => pattern.test(name))?.[0] : undefined;
}

export default defineConfig({
  build: { rollupOptions: { output: { manualChunks: vendorChunk } } },
  plugins: [catalogSplit(), react(), tailwindcss(), buildStamp, uiManifest],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: "node",
    env: { VITE_POSTHOG_TOKEN: "test-posthog-token" },
    include: [
      "evals/**/*.test.ts",
      "server/**/*.test.ts",
      "electron/**/*.test.mjs",
      "src/**/*.test.ts",
      "shared/**/*.test.ts",
      "companion/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "scripts/**/*.test.ts",
      "deploy/**/*.test.mjs",
    ],
    setupFiles: ["server/testing/setup.ts", "src/testing/locales-setup.ts"],
    // the suite spawns fake provider CLIs and a real harness server;
    // parallel files introduce load-sensitive flakes for no win
    fileParallelism: false,
    // --shard splits the files by recorded CI seconds, not count
    sequence: { sequencer: DurationSequencer },
    // Known flakes in scripts/testing/ci-retry-list.json get two retries in
    // CI only, each reported.
    runner: "./scripts/testing/ci-retry-runner.ts",
    // Doubled on Windows, whose runners are about 1.45x slower.
    testTimeout: hostTimeout(20_000),
    hookTimeout: hostTimeout(30_000),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // IPv4 explicitly — a bare ::1 bind makes localhost a coin-flip for
    // clients that resolve IPv4 first
    host: "127.0.0.1",
    port: Number(process.env.NORDUS_UI_PORT) || 5199,
    // packager output lands inside the repo — its HTML files must never
    // trigger dev full-page reloads
    watch: {
      ignored: ["**/release/**", "**/build/**", "**/dist/**", "**/electron/resources/**"],
    },
    // the harness server owns every provider process; the app only ever
    // talks to /api — clients hold no transports
    proxy: {
      "/api": {
        ws: true,
        target: `http://127.0.0.1:${process.env.NORDUS_PORT || process.env.OGB_PORT || 8799}`,
      },
      "/.well-known/nordus/environment": {
        target: `http://127.0.0.1:${process.env.NORDUS_PORT || process.env.OGB_PORT || 8799}`,
      },
    },
  },
});
