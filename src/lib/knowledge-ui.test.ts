import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ApiError } from "@/state/api";
import { actorInitials, addressesIn, chooseSpace, formatBytes, isHiddenPath, knowledgeErrorText, relativeTime, rememberedSpace, rememberSpace, spaceLabel, vaultFilesOf, versionNote } from "./knowledge-ui";

beforeEach(() => {
  setLocale("pt-br");
});

const file = (name: string, relative = "") => Object.assign(new File(["x"], name), relative ? { webkitRelativePath: relative } : {});

describe("sizes and times", () => {
  it("writes sizes in the unit people read", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
    expect(formatBytes(-1)).toBe("");
    setLocale("en");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("says how long ago in the person's language", () => {
    const now = Date.UTC(2026, 9, 27, 12, 0, 0);
    expect(relativeTime(now - 5_000, now)).toBe("agora");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("há 2 horas");
    expect(relativeTime(now - 86_400_000, now)).toBe("ontem");
    setLocale("en");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
});

describe("spaces", () => {
  const spaces = [{ id: "internal", kind: "internal" }, { id: "client:evergreen", kind: "client", client: "evergreen" }] as const;

  it("names a space for the person and picks the one wanted when it is theirs", () => {
    expect(spaceLabel(spaces[0])).toBe("Empresa");
    expect(spaceLabel(spaces[1])).toBe("evergreen");
    expect(spaceLabel({ id: "client:fabrikam", kind: "client" })).toBe("fabrikam");
    expect(chooseSpace(spaces, "client:evergreen")).toBe("client:evergreen");
    expect(chooseSpace(spaces, "client:other")).toBe("internal");
    expect(chooseSpace([], "internal")).toBeNull();
  });

  it("remembers the space the person last looked at or saved to, and shrugs when the browser will not keep it", () => {
    const store = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) } });
    try {
      expect(rememberedSpace()).toBeNull();
      rememberSpace("client:evergreen");
      expect(rememberedSpace()).toBe("client:evergreen");
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
      expect(rememberedSpace()).toBeNull();
      expect(() => rememberSpace("internal")).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

describe("the people who open the company's space", () => {
  it("reads one address per line, and also forgives commas, semicolons and spaces", () => {
    expect(addressesIn("ana@zorg.test\nbia@zorg.test\r\n\n  caio@zorg.test  ")).toEqual(["ana@zorg.test", "bia@zorg.test", "caio@zorg.test"]);
    expect(addressesIn("ana@zorg.test, bia@zorg.test; caio@zorg.test dani@zorg.test")).toEqual(["ana@zorg.test", "bia@zorg.test", "caio@zorg.test", "dani@zorg.test"]);
    expect(addressesIn("  \n ")).toEqual([]);
    expect(addressesIn("")).toEqual([]);
  });
});

describe("who and why", () => {
  it("makes initials from the name", () => {
    expect(actorInitials({ kind: "person", name: "Ana Souza" })).toBe("AS");
    expect(actorInitials({ kind: "bot", name: "GerenteDeOperacao" })).toBe("G");
    expect(actorInitials({ kind: "person", name: "  " })).toBe("?");
  });

  it("turns the server's version tokens into sentences and leaves a person's own note alone", () => {
    expect(versionNote("restore:3")).toBe("Restaurada da versão 3");
    expect(versionNote("import:obsidian")).toBe("Importada do Obsidian");
    expect(versionNote("final text")).toBe("final text");
    expect(versionNote(undefined)).toBeUndefined();
  });
});

describe("errors", () => {
  it("explains what the server refused in plain words", () => {
    const refusal = (code: string, extra: Record<string, unknown> = {}) => new ApiError("x", 400, { code, ...extra });
    expect(knowledgeErrorText(refusal("forbidden"))).toBe("Só um administrador ou quem adicionou pode fazer isso.");
    expect(knowledgeErrorText(refusal("conflict"))).toContain("Alguém salvou");
    expect(knowledgeErrorText(refusal("too_large", { maxBytes: 100 * 1024 * 1024 }))).toContain("100 MB");
    expect(knowledgeErrorText(refusal("surprise"))).toBe("Não deu certo. Tente de novo.");
    expect(knowledgeErrorText(new TypeError("network"))).toBe("Não deu certo. Tente de novo.");
  });
});

describe("a folder chosen in the browser", () => {
  it("drops the vault's own folder name from every path", () => {
    const { root, files } = vaultFilesOf([file("Home.md", "Vault/Home.md"), file("Daily.md", "Vault/Notes/Daily.md")]);
    expect(root).toBe("Vault");
    expect(files.map((entry) => entry.path)).toEqual(["Home.md", "Notes/Daily.md"]);
  });

  it("spots hidden folders such as .obsidian", () => {
    expect(isHiddenPath(".obsidian/workspace.json")).toBe(true);
    expect(isHiddenPath("Notes/.trash/x.md")).toBe(true);
    expect(isHiddenPath("Notes/Daily.md")).toBe(false);
  });
});
