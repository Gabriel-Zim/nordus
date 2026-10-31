import { describe, expect, it } from "vitest";
import { bareDomainLinks } from "./bare-domains";

const urls = (text: string) => bareDomainLinks(text).map((link) => link.url);

describe("bare domains", () => {
  it("links an address written without https://, path included", () => {
    expect(urls("Publiquei em averymercer.com.br/artigo/exemplo-de-artigo.")).toEqual([
      "https://averymercer.com.br/artigo/exemplo-de-artigo",
    ]);
    expect(urls("veja nordus.ai e contoso.com")).toEqual(["https://nordus.ai", "https://contoso.com"]);
    expect(urls("app.example.io/painel?aba=1")).toEqual(["https://app.example.io/painel?aba=1"]);
  });

  it("keeps the address as written for the link text", () => {
    expect(bareDomainLinks("em averymercer.com.br, hoje")[0]).toMatchObject({ text: "averymercer.com.br", start: 3 });
  });

  it("leaves file names, e-mails and other words alone", () => {
    expect(urls("o arquivo video.mp4 e notas.md e index.html")).toEqual([]);
    expect(urls("escreva para avery@contoso.com")).toEqual([]);
    expect(urls("versão 1.2.3 e foo.company")).toEqual([]);
    expect(urls("https://nordus.ai já é link")).toEqual([]);
  });
});
