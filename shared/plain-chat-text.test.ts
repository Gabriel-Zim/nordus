import { describe, expect, it } from "vitest";
import { plainChatText, splitImagePaths } from "./plain-chat-text";

describe("plainChatText", () => {
  it("drops shell blocks and tells inline commands and paths in words", () => {
    const text = "Exemplo citando o caminho `/workspace/notas/pauta-outubro.md` para referência.\n\n```bash\nls -la ~/notas\n```\n\nE aqui um comando inline: `ls`.";
    expect(plainChatText(text)).toBe("Exemplo citando o caminho pauta-outubro.md para referência.\n\nE aqui um comando inline: o comando.");
  });

  it("keeps code that is not a terminal line", () => {
    const text = "Veja:\n\n```python\nprint('oi')\n```";
    expect(plainChatText(text)).toBe(text);
    expect(plainChatText("Use a fórmula `SOMA(A1:A3)`.")).toBe("Use a fórmula `SOMA(A1:A3)`.");
  });

  it("names the product Nordus and hides drivers and acronyms", () => {
    expect(plainChatText("O driver do computador (CUA) não está pronto; reinicie o Nordus no painel."))
      .toBe("O computador não está pronto; reinicie o Nordus no painel.");
    expect(plainChatText("Rodei `sudo -n true` e não funcionou.")).toBe("Rodei o comando e não funcionou.");
  });

  it("never shows an em dash", () => {
    expect(plainChatText("Isso só você consegue resolver — por favor, confira.")).toBe("Isso só você consegue resolver, por favor, confira.");
    expect(plainChatText("# Roteiro — Carrossel 4")).toBe("# Roteiro, Carrossel 4");
    expect(plainChatText("— começo da linha")).toBe("começo da linha");
  });

  it("never renames inside a link's address", () => {
    expect(plainChatText("I read **[Prudctual/Nordus](https://github.com/Prudctual/Nordus)**."))
      .toBe("I read **[Prudctual/Nordus](https://github.com/Prudctual/Nordus)**.");
    expect(plainChatText("Veja https://github.com/x/Nordus — e <https://claude.ai/Claude>"))
      .toBe("Veja https://github.com/x/Nordus, e <https://claude.ai/Claude>");
  });

  it("leaves links alone", () => {
    const text = "[Onboarding](https://example.com/a/b/c) e https://claude.ai/x";
    expect(plainChatText(text)).toBe(text);
  });

  it("takes pictures named by path out of the words, for the gallery", () => {
    const text = "Rodada 1.\n\nArquivos:\n/home/x/a/slide-1.png\n/home/x/a/slide-2.png\n\nTextos esperados:\nLâmina 1";
    expect(splitImagePaths(text)).toEqual({ text: "Rodada 1.\n\nTextos esperados:\nLâmina 1", images: ["/home/x/a/slide-1.png", "/home/x/a/slide-2.png"] });
    expect(splitImagePaths("Veja /home/x/a.png no meio da frase")).toEqual({ text: "Veja /home/x/a.png no meio da frase", images: [] });
  });
  it("drops the model's English narration between Portuguese sentences, and nothing else", () => {
    expect(plainChatText("Vou buscar os dados agora. The first call did not record. Retrying... Pronto, achei os três clientes."))
      .toBe("Vou buscar os dados agora. Pronto, achei os três clientes.");
    expect(plainChatText("Hello, how are you today?")).toBe("Hello, how are you today?");
    expect(plainChatText("O título é \"Let it be\" e fica na capa.")).toBe("O título é \"Let it be\" e fica na capa.");
  });
  it("names a reply's sources in Portuguese and cleans their link titles", () => {
    expect(plainChatText("Achei isto.\n\n**Sources:**\n- [@ Tesla Pushes Roadster](https://example.com/a)\n- [From:Internet Info Agency 2026-06-08](https://example.com/b)"))
      .toBe("Achei isto.\n\n**Fabrikam:**\n- [Tesla Pushes Roadster](https://example.com/a)\n- [Internet Info Agency 2026-06-08](https://example.com/b)");
  });
});
