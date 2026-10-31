import { describe, expect, it } from "vitest";

import { readableMailText } from "./EmailsTab";

describe("readableMailText", () => {
  it("joins hard-wrapped lines into paragraphs and keeps blank lines and lists", () => {
    const text = "Segundo teste da caixa da Nordus, para conferir o aviso na conversa. Pode\nignorar.\n\nItens:\n- um\n- dois\n";
    expect(readableMailText(text)).toBe("Segundo teste da caixa da Nordus, para conferir o aviso na conversa. Pode ignorar.\n\nItens:\n- um\n- dois");
  });
});
