// What the bot reads after add_mcp_server, in plain Portuguese: nothing about transport, addresses, headers or ids.
import type { Json } from "./agents-client.ts";

const SAY_IT_LIKE_A_PERSON =
  "Fale com a pessoa em português, numa frase curta e simples, sem falar de transporte, cabeçalho, endereço técnico ou identificador.";

export function addedMcpServerText(saved: Json): string {
  if (saved.needsYes === true && typeof saved.question === "string") {
    return `${saved.question}\n\nFaça a pergunta em texto, numa única frase em português, do jeito que se fala com uma pessoa, e encerre a sua vez esperando o sim. ` +
      `Use o verbo ligar ou instalar (por exemplo: "Quer que eu ligue o Notion? Vou precisar que você entre na sua conta."). ` +
      `Se o app for mesmo de um endereço na internet, cite só o domínio curto. ${SAY_IT_LIKE_A_PERSON} ` +
      "Depois do sim, chame esta ferramenta de novo com exatamente os mesmos parâmetros. Nada foi salvo ainda.";
  }
  const raw = typeof saved.name === "string" && saved.name ? saved.name : "";
  const app = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "o app";
  const label = raw ? `o app ${app}` : app;
  if (saved.state === "needs-sign-in") {
    return `O app ${app} ficou salvo e ligado, esperando a pessoa entrar na conta dele. Diga em uma frase que ela precisa entrar na conta do ${app} para eu poder usar; ` +
      `o botão Entrar fica em Apps, nas configurações, como reserva. ${SAY_IT_LIKE_A_PERSON}`;
  }
  if (saved.state === "connected") {
    return `Conectei ${label}. Já dá para usar. (Se for para o robô de um cliente, ele só enxerga o app depois que a pessoa o liga na lista de apps desse robô; diga isso só nesse caso.)`;
  }
  const card = typeof saved.requestId === "string"
    ? " Um cartão apareceu agora na conversa: é só a pessoa tocar em Ligar."
    : "";
  return `Salvei ${label}, mas ele ficou desligado: a pessoa liga em Apps, nas configurações, quando quiser usar.${card} ${SAY_IT_LIKE_A_PERSON}`;
}
