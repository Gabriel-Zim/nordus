import { describe, expect, it } from "vitest";

import type { CaptureTurn } from "./memory-capture.ts";
import { DEFAULT_NIGHT_WINDOW, gateCapture, hasMemoryCue, hourIn, inNightWindow } from "./memory-gate.ts";

const turn = (person: string, bot: string): CaptureTurn => ({ person, bot });

describe("o porteiro da consolidação de memória", () => {
  it("pula o que é curto demais para ter um fato", () => {
    expect(gateCapture([turn("ok", "ok")])).toEqual({ action: "skip", reason: "trivial" });
    expect(gateCapture([turn("", "")])).toEqual({ action: "skip", reason: "trivial" });
  });

  it("pula só cortesia: agradecimento, cumprimento, despedida e teste", () => {
    expect(gateCapture([turn("valeu, obrigado!", "De nada, qualquer coisa é só chamar por aqui, combinado?")])).toEqual({ action: "skip", reason: "cumprimento" });
    expect(gateCapture([turn("Bom dia", "Bom dia! Como posso ajudar você hoje na rotina de conteúdo?")])).toEqual({ action: "skip", reason: "cumprimento" });
    expect(gateCapture([turn("testando", "Tudo certo por aqui, recebi a mensagem de teste normalmente.")])).toEqual({ action: "skip", reason: "cumprimento" });
  });

  it("nunca pula um sim ou um pode que responde a uma pergunta do robô: é uma decisão", () => {
    const rule = 'Quer que eu guarde isto como regra: "nos cortes, a palavra grande fica inteira acima da cabeça"?';
    for (const answer of ["sim", "SIM", "pode", "ok", "pode ser", "não", "fechado"]) {
      const verdict = gateCapture([turn(answer, rule)]);
      expect(verdict.action, answer).not.toBe("skip");
    }
  });

  it("pula a resposta de rotina NADA_NOVO sem fala da pessoa", () => {
    expect(gateCapture([turn("", "NADA_NOVO")])).toEqual({ action: "skip", reason: "trivial" });
    const long = [{ person: "", bot: "Nada novo nas últimas 4 horas: nenhuma menção nova, nenhum e-mail sem resposta.\n\nNADA_NOVO" }];
    expect(gateCapture(long).action).toBe("skip");
    expect(gateCapture([{ person: "[rotina] verificar as menções", bot: "Sem novidades nas menções de hoje, nada a registrar por enquanto.\n\nNADA_NOVO" }]).action).toBe("skip");
  });

  it("pula um turno em que ninguém falou e o robô só deu uma resposta curta", () => {
    expect(gateCapture([turn("", "Pedi pra DesignerGrafico, te passo o retorno assim que ela devolver a prévia dos 6 slides.")])).toEqual({ action: "skip", reason: "sem-fala-curta" });
  });

  it("deixa para a madrugada um resultado do robô sem fala da pessoa", () => {
    expect(gateCapture([turn("", "A".repeat(400))])).toEqual({ action: "night", reason: "so-resposta" });
  });

  it("deixa para a madrugada uma conversa de conteúdo sem pedido de memória", () => {
    expect(gateCapture([turn("Faz a capa do carrossel do dólar com a balança de cobre", "Feito, a capa está pronta para você ver aqui.")])).toEqual({ action: "night", reason: "conteudo" });
  });

  it("consolida já o que a pessoa pediu para lembrar, corrigiu ou decidiu", () => {
    const now = { action: "now", reason: "pedido-de-memoria" };
    expect(gateCapture([turn("Lembra disso: o Avery só aprova capa sem logo em caixa.", "Anotado.")])).toEqual(now);
    expect(gateCapture([turn("guarda aí que a conta da EVERGREEN fecha dia 5", "Guardei.")])).toEqual(now);
    expect(gateCapture([turn("Não é assim, o certo é Benefício em Vida com B e V maiúsculos", "Corrigido.")])).toEqual(now);
    expect(gateCapture([turn("Decidimos usar a Archivo nos títulos daqui pra frente", "Certo.")])).toEqual(now);
    expect(gateCapture([turn("From now on always answer in Portuguese", "Okay, will do.")])).toEqual(now);
    expect(gateCapture([turn("Remember that my sister is called Asha", "Noted, thanks.")])).toEqual(now);
    expect(gateCapture([turn("Amanhã tenho prova de inglês", "Boa sorte!")])).toEqual(now);
    expect(gateCapture([turn("Aprovado e sem trilha", "Já comecei a versão final com a legenda no estilo do perfil.")])).toEqual(now);
  });

  it("um pedido de memória no meio de várias falas puxa a conversa inteira para agora", () => {
    const verdict = gateCapture([turn("Gera a capa", "Pronto, aqui está a capa."), turn("e anota que o cliente prefere fundo claro", "Anotei.")]);
    expect(verdict).toEqual({ action: "now", reason: "pedido-de-memoria" });
  });

  it("lê a fala da pessoa numa sala, não a de outro robô", () => {
    const room: CaptureTurn = { person: "", bot: "Segue o relatório da semana com os números fechados.", room: [{ by: "peer", name: "Pixel", text: "lembra de guardar isso, sempre" }] };
    expect(hasMemoryCue([room])).toBe(false);
    const own: CaptureTurn = { person: "lembra disso", bot: "Ok.", room: [{ by: "person", name: "Person", text: "lembra disso, o prazo é sexta" }] };
    expect(hasMemoryCue([own])).toBe(true);
  });

  it("uma frase curta que é fato sobre a pessoa não é pulada", () => {
    expect(gateCapture([turn("Sou vegano e moro em Pune, pode anotar", "Ok, anotado.")]).action).toBe("now");
    expect(gateCapture([turn("Meu cliente novo é a Acme Corp", "Certo, vou considerar.")]).action).toBe("now");
  });
});

describe("a janela da madrugada", () => {
  const sp = (hourUtc: number) => new Date(Date.UTC(2026, 9, 26, hourUtc, 30));
  it("usa o horário de São Paulo, não o do servidor", () => {
    expect(hourIn(sp(5), "America/Sao_Paulo")).toBe(2);
    expect(inNightWindow(sp(5), DEFAULT_NIGHT_WINDOW)).toBe(true);
    expect(inNightWindow(sp(7), DEFAULT_NIGHT_WINDOW)).toBe(true);
    expect(inNightWindow(sp(8), DEFAULT_NIGHT_WINDOW)).toBe(false);
    expect(inNightWindow(sp(4), DEFAULT_NIGHT_WINDOW)).toBe(false);
    expect(inNightWindow(sp(15), DEFAULT_NIGHT_WINDOW)).toBe(false);
  });

  it("aceita uma janela que cruza a meia-noite e um fuso inválido", () => {
    const wrap = { startHour: 23, endHour: 4, timeZone: "UTC" };
    expect(inNightWindow(new Date(Date.UTC(2026, 9, 26, 23, 10)), wrap)).toBe(true);
    expect(inNightWindow(new Date(Date.UTC(2026, 9, 26, 3, 10)), wrap)).toBe(true);
    expect(inNightWindow(new Date(Date.UTC(2026, 9, 26, 12, 0)), wrap)).toBe(false);
    expect(() => hourIn(new Date(), "Nao/Existe")).not.toThrow();
  });
});
