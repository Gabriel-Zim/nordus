// ManyChat by API key (Settings → API, plan Pro). Endpoints from https://api.manychat.com/swagger (Page API).
import { requestJson, serveStdioMcp } from "./stdio-mcp.ts";

const KEY = process.env.MANYCHAT_API_KEY ?? "";
const BASE = "https://api.manychat.com";
const call = (method: "GET" | "POST", path: string, body?: Record<string, unknown>, query?: Record<string, string>) => {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return requestJson(url.toString(), {
    method,
    headers: { authorization: `Bearer ${KEY}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
};
const str = (value: unknown) => String(value ?? "");

serveStdioMcp("manychat", [
  { name: "page_info", description: "Informações da página/conta conectada no ManyChat.", inputSchema: { type: "object", properties: {} }, run: () => call("GET", "/fb/page/getInfo") },
  { name: "list_automations", description: "Lista as automações (flows) da conta, com o identificador flow_ns de cada uma.", inputSchema: { type: "object", properties: {} }, run: () => call("GET", "/fb/page/getFlows") },
  { name: "list_growth_tools", description: "Lista as ferramentas de crescimento (gatilhos, links, palavras-chave de comentário).", inputSchema: { type: "object", properties: {} }, run: () => call("GET", "/fb/page/getGrowthTools") },
  { name: "list_tags", description: "Lista as etiquetas da conta.", inputSchema: { type: "object", properties: {} }, run: () => call("GET", "/fb/page/getTags") },
  { name: "list_bot_fields", description: "Lista os campos do bot (valores usados nas automações, como links).", inputSchema: { type: "object", properties: {} }, run: () => call("GET", "/fb/page/getBotFields") },
  {
    name: "set_bot_field",
    description: "Atualiza o valor de um campo do bot pelo nome (por exemplo, o link que uma automação envia).",
    inputSchema: { type: "object", required: ["field_name", "field_value"], properties: { field_name: { type: "string" }, field_value: { type: "string" } } },
    run: (args) => call("POST", "/fb/page/setBotFieldByName", { field_name: str(args.field_name), field_value: args.field_value }),
  },
  {
    name: "find_subscriber",
    description: "Procura assinantes pelo nome.",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    run: (args) => call("GET", "/fb/subscriber/findByName", undefined, { name: str(args.name) }),
  },
  {
    name: "send_automation",
    description: "Envia uma automação (flow) para um assinante. Use o flow_ns de list_automations.",
    inputSchema: { type: "object", required: ["subscriber_id", "flow_ns"], properties: { subscriber_id: { type: "string" }, flow_ns: { type: "string" } } },
    run: (args) => call("POST", "/fb/sending/sendFlow", { subscriber_id: str(args.subscriber_id), flow_ns: str(args.flow_ns) }),
  },
  {
    name: "send_text",
    description: "Envia uma mensagem de texto para um assinante (dentro da janela permitida pela plataforma).",
    inputSchema: { type: "object", required: ["subscriber_id", "text"], properties: { subscriber_id: { type: "string" }, text: { type: "string" } } },
    run: (args) => call("POST", "/fb/sending/sendContent", {
      subscriber_id: str(args.subscriber_id),
      data: { version: "v2", content: { messages: [{ type: "text", text: str(args.text) }] } },
    }),
  },
  {
    name: "tag_subscriber",
    description: "Adiciona uma etiqueta a um assinante.",
    inputSchema: { type: "object", required: ["subscriber_id", "tag_name"], properties: { subscriber_id: { type: "string" }, tag_name: { type: "string" } } },
    run: (args) => call("POST", "/fb/subscriber/addTagByName", { subscriber_id: str(args.subscriber_id), tag_name: str(args.tag_name) }),
  },
]);
