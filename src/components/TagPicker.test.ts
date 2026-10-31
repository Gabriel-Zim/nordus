import { describe, expect, it } from "vitest";

import { tagPickerChoices } from "./TagPicker";

const shown = (query: string) => tagPickerChoices(query).areas.flatMap((area) => area.tags);

describe("tag picker search", () => {
  it("shows the whole catalog before anything is typed", () => {
    expect(tagPickerChoices("").typed).toBeNull();
    expect(shown("").length).toBeGreaterThan(140);
  });

  it("ignores accents, case and hyphens", () => {
    expect(shown("frontend")).toContain("Desenvolvedor Front-end");
    expect(shown("juridico")).toContain("Jurídico");
    expect(shown("VIDEO")).toContain("Editor de Vídeo");
  });

  it("keeps a whole area when its name matches", () => {
    expect(shown("financeiro")).toEqual(expect.arrayContaining(["Tesouraria", "Cobrança", "Financeiro"]));
  });

  it("offers a typed tag that is not in the catalog", () => {
    expect(tagPickerChoices("  QG   de Design ").typed).toBe("QG de Design");
    expect(tagPickerChoices("social media").typed).toBeNull();
  });
});
