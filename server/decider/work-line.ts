// Nordus: what a bot is doing, in a person's words ("Desenhando a capa do Reels do CJ"), written once per request by the
// bot's light model, and the object it works on, so the steps can say "Editando a capa do Reels do CJ". Never throws.
export interface WorkLine {
  doing: string;
  object?: string;
}

/** The words the line is written from: the person's message, or the brief a teammate was handed; a continuation has none. */
export function workLineRequest(turn: { text: string; continuation: boolean; brief?: string }): string | undefined {
  if (turn.brief !== undefined) return turn.brief;
  return turn.continuation ? undefined : turn.text;
}

export function workLinePrompt(request: string): string {
  return [
    'Responda só com JSON no formato {"fazendo":"...","objeto":"..."}.',
    '"fazendo": o que o assistente está fazendo agora para atender o pedido abaixo, em português do Brasil, com até 8 palavras, começando por um verbo no gerúndio, em linguagem de gente. Exemplo: "Desenhando a capa do Reels do CJ".',
    '"objeto": a coisa em que ele trabalha, com artigo, até 6 palavras. Exemplo: "a capa do Reels do CJ". Use "" se não houver uma coisa clara.',
    "Nunca escreva nome de ferramenta, comando, código, arquivo, caminho, link ou palavra em inglês. Não use travessão.",
    "",
    `Pedido: """${request.replace(/"""/g, "\"\"").slice(0, 1_500)}"""`,
  ].join("\n");
}

const TECHNICAL = /[/\\_`<>{}|=$#@]|https?:|\bmcp\b|\.(?:ts|js|py|json|md|png|jpg|mp4|html|css)\b|—/i;

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value.replace(/\s+/g, " ").replace(/^["'“”]+|["'“”.]+$/g, "").trim();
  if (!line || line.length > max || TECHNICAL.test(line)) return undefined;
  return line;
}

export function parseWorkLine(reply: string): WorkLine | null {
  const match = /\{[\s\S]*\}/.exec(reply);
  if (!match) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const doing = clean(body.fazendo, 70);
  if (!doing || !/^\p{L}+ndo\b/iu.test(doing)) return null;
  const object = clean(body.objeto, 50);
  return { doing: doing[0]!.toUpperCase() + doing.slice(1), ...(object ? { object: object[0]!.toLowerCase() + object.slice(1) } : {}) };
}
