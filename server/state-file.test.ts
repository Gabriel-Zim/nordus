import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isJsonObject, readJsonState } from "./state-file.ts";
import { removeTempDir } from "./testing/cleanup.ts";

let dir: string;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "state-file-"));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  await removeTempDir(dir);
});

const copies = () => readdirSync(dir).filter((name) => name.startsWith("state.json.corrompido-"));

describe("readJsonState", () => {
  it("reads a missing file as missing, without a warning", () => {
    expect(readJsonState(join(dir, "state.json"), isJsonObject)).toEqual({ status: "missing" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports an unreadable file once, by kind only, and keeps a copy of its bytes", () => {
    const path = join(dir, "state.json");
    const torn = '{"title": "segredo da conversa"';
    writeFileSync(path, torn);
    expect(readJsonState(path, isJsonObject)).toEqual({ status: "unreadable" });
    expect(readJsonState(path, isJsonObject)).toEqual({ status: "unreadable" });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain(path);
    expect(line).toContain("invalid JSON");
    expect(line).not.toContain("segredo");
    expect(copies()).toHaveLength(1);
    expect(readFileSync(join(dir, copies()[0]!), "utf8")).toBe(torn);
  });

  it("calls a well-formed file of the wrong shape unreadable, and warns again after a good read", () => {
    const path = join(dir, "state.json");
    writeFileSync(path, "[1, 2]");
    expect(readJsonState(path, isJsonObject)).toEqual({ status: "unreadable" });
    expect(String(warn.mock.calls[0]![0])).toContain("unexpected shape");
    writeFileSync(path, '{"a": 1}');
    expect(readJsonState(path, isJsonObject)).toEqual({ status: "ok", value: { a: 1 } });
    writeFileSync(path, "{");
    expect(readJsonState(path, isJsonObject)).toEqual({ status: "unreadable" });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
