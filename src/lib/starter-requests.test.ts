import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { starterRequests } from "./starter-requests";

describe("starter requests", () => {
  it("uses the duties a SOUL lists, three at most, in the person's words", () => {
    setLocale("pt-br");
    const soul = "# Quem sou\nDesigner.\n\n## Responsabilidades\n- Criar carrosséis para Instagram\n- Revisar a identidade visual dos clientes\n- Montar apresentações\n- Organizar a pasta de arquivos\n\n## Regras\n- Nunca publicar sem aprovação";
    expect(starterRequests({ title: "Designer", soul })).toEqual([
      "Quero ajuda com: criar carrosséis para Instagram",
      "Quero ajuda com: revisar a identidade visual dos clientes",
      "Quero ajuda com: montar apresentações",
    ]);
  });

  it("completes with role-based requests when the SOUL lists fewer than three", () => {
    setLocale("pt-br");
    expect(starterRequests({ title: "Designer", soul: "## Tarefas\n- Criar carrosséis para Instagram" })).toEqual([
      "Quero ajuda com: criar carrosséis para Instagram",
      "Me explique o que você faz e como posso pedir as coisas.",
      "Como Designer, o que você pode adiantar para mim hoje?",
    ]);
  });

  it("falls back to three generic requests without a profile", () => {
    setLocale("pt-br");
    const requests = starterRequests({});
    expect(requests).toHaveLength(3);
    expect(requests[1]).toBe("Me diga o que está pendente e o que você sugere fazer primeiro.");
  });
});

describe("starter requests for a bot from the gallery", () => {
  it("offers the ready bot's own first jobs, in the person's language", async () => {
    const { readyBot } = await import("./ready-bots");
    setLocale("pt-br");
    expect(starterRequests({ title: "Triagem de e-mail", soul: readyBot("inbox")!.soul })).toEqual([
      "O que na minha caixa precisa de mim hoje?",
      "Escreva respostas para os três e-mails mais urgentes",
      "Quem eu não respondo há mais de uma semana?",
    ]);
    setLocale("en");
    expect(starterRequests({ soul: `${readyBot("inbox")!.soul}\n` })[0]).toBe("What in my inbox needs me today?");
  });

  it("goes back to the bot's duties once its instructions were edited", async () => {
    const { readyBot } = await import("./ready-bots");
    setLocale("pt-br");
    expect(starterRequests({ title: "Caixa", soul: `${readyBot("inbox")!.soul}\nResponda sempre em português.` })[0]).not.toBe("O que na minha caixa precisa de mim hoje?");
  });
});
