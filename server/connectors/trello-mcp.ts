// Trello by API key + member token (REST API v1, https://developer.atlassian.com/cloud/trello/rest/).
import { requestJson, serveStdioMcp } from "./stdio-mcp.ts";

const KEY = process.env.TRELLO_API_KEY ?? "";
const TOKEN = process.env.TRELLO_TOKEN ?? "";
const BASE = "https://api.trello.com/1";
// Trello's documented scheme: key and token in the Authorization header keep them out of request URLs.
const AUTH = `OAuth oauth_consumer_key="${KEY}", oauth_token="${TOKEN}"`;

const call = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, query?: Record<string, unknown>) => {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return requestJson(url.toString(), { method, headers: { authorization: AUTH, accept: "application/json" } });
};
const str = (value: unknown) => String(value ?? "");
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", required, properties });
const text = { type: "string" };

serveStdioMcp("trello", [
  { name: "list_boards", description: "Lista os quadros abertos da conta do Trello.", inputSchema: obj({}), run: () => call("GET", "/members/me/boards", { filter: "open", fields: "name,url,desc,idOrganization" }) },
  {
    name: "list_lists",
    description: "Lista as listas (colunas) abertas de um quadro.",
    inputSchema: obj({ board_id: text }, ["board_id"]),
    run: (args) => call("GET", `/boards/${encodeURIComponent(str(args.board_id))}/lists`, { filter: "open", fields: "name,pos" }),
  },
  {
    name: "list_cards",
    description: "Lista os cartões abertos de uma lista, ou de um quadro inteiro se vier board_id.",
    inputSchema: obj({ list_id: text, board_id: text }),
    run: (args) => args.list_id
      ? call("GET", `/lists/${encodeURIComponent(str(args.list_id))}/cards`, { fields: "name,desc,due,idList,idLabels,url,closed" })
      : call("GET", `/boards/${encodeURIComponent(str(args.board_id))}/cards`, { filter: "open", fields: "name,desc,due,idList,idLabels,url" }),
  },
  {
    name: "get_card",
    description: "Detalhes de um cartão, com etiquetas, anexos e comentários recentes.",
    inputSchema: obj({ card_id: text }, ["card_id"]),
    run: (args) => call("GET", `/cards/${encodeURIComponent(str(args.card_id))}`, { attachments: "true", actions: "commentCard", actions_limit: 20, labels: "true" }),
  },
  {
    name: "create_card",
    description: "Cria um cartão numa lista.",
    inputSchema: obj({ list_id: text, name: text, desc: text, due: { type: "string", description: "Data ISO 8601" }, label_ids: { type: "array", items: text } }, ["list_id", "name"]),
    run: (args) => call("POST", "/cards", {
      idList: str(args.list_id),
      name: str(args.name),
      desc: args.desc,
      due: args.due,
      idLabels: Array.isArray(args.label_ids) ? args.label_ids.map(str).join(",") : undefined,
      pos: "bottom",
    }),
  },
  {
    name: "update_card",
    description: "Muda nome, descrição, prazo ou arquiva um cartão.",
    inputSchema: obj({ card_id: text, name: text, desc: text, due: text, closed: { type: "boolean" } }, ["card_id"]),
    run: (args) => call("PUT", `/cards/${encodeURIComponent(str(args.card_id))}`, { name: args.name, desc: args.desc, due: args.due, closed: args.closed }),
  },
  {
    name: "move_card",
    description: "Move um cartão para outra lista (e, se vier board_id, para outro quadro).",
    inputSchema: obj({ card_id: text, list_id: text, board_id: text, position: { type: "string", description: "top, bottom ou um número" } }, ["card_id", "list_id"]),
    run: (args) => call("PUT", `/cards/${encodeURIComponent(str(args.card_id))}`, { idList: str(args.list_id), idBoard: args.board_id, pos: args.position ?? "top" }),
  },
  {
    name: "add_comment",
    description: "Comenta num cartão.",
    inputSchema: obj({ card_id: text, text }, ["card_id", "text"]),
    run: (args) => call("POST", `/cards/${encodeURIComponent(str(args.card_id))}/actions/comments`, { text: str(args.text) }),
  },
  {
    name: "list_labels",
    description: "Lista as etiquetas de um quadro.",
    inputSchema: obj({ board_id: text }, ["board_id"]),
    run: (args) => call("GET", `/boards/${encodeURIComponent(str(args.board_id))}/labels`, { fields: "name,color" }),
  },
  {
    name: "create_label",
    description: "Cria uma etiqueta num quadro. Cores: green, yellow, orange, red, purple, blue, sky, lime, pink, black.",
    inputSchema: obj({ board_id: text, name: text, color: text }, ["board_id", "name"]),
    run: (args) => call("POST", "/labels", { idBoard: str(args.board_id), name: str(args.name), color: args.color ?? "blue" }),
  },
  {
    name: "add_label",
    description: "Põe uma etiqueta existente num cartão.",
    inputSchema: obj({ card_id: text, label_id: text }, ["card_id", "label_id"]),
    run: (args) => call("POST", `/cards/${encodeURIComponent(str(args.card_id))}/idLabels`, { value: str(args.label_id) }),
  },
  {
    name: "remove_label",
    description: "Tira uma etiqueta de um cartão.",
    inputSchema: obj({ card_id: text, label_id: text }, ["card_id", "label_id"]),
    run: (args) => call("DELETE", `/cards/${encodeURIComponent(str(args.card_id))}/idLabels/${encodeURIComponent(str(args.label_id))}`),
  },
  {
    name: "list_attachments",
    description: "Lista os anexos de um cartão.",
    inputSchema: obj({ card_id: text }, ["card_id"]),
    run: (args) => call("GET", `/cards/${encodeURIComponent(str(args.card_id))}/attachments`, { fields: "name,url,mimeType,date" }),
  },
  {
    name: "add_attachment",
    description: "Anexa um link (https) a um cartão.",
    inputSchema: obj({ card_id: text, url: text, name: text }, ["card_id", "url"]),
    run: (args) => {
      const link = str(args.url);
      if (!/^https:\/\//i.test(link)) throw new Error("O anexo precisa ser um link https.");
      return call("POST", `/cards/${encodeURIComponent(str(args.card_id))}/attachments`, { url: link, name: args.name });
    },
  },
]);
