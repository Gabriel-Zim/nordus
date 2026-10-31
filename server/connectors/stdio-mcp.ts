// A small MCP server over stdio (newline-delimited JSON-RPC), for the key-based connectors Nordus runs itself.
import readline from "node:readline";

export interface ConnectorTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

export function serveStdioMcp(name: string, tools: ConnectorTool[]): void {
  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    let request: { id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    try { request = JSON.parse(line); } catch { return; }
    const { id, method, params } = request;
    if (id === undefined) return; // notifications need no answer
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name, version: "1" } } });
    }
    if (method === "tools/list") {
      return send({ jsonrpc: "2.0", id, result: { tools: tools.map(({ run: _run, ...tool }) => tool) } });
    }
    if (method === "tools/call") {
      const tool = tools.find((candidate) => candidate.name === params?.name);
      if (!tool) return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool" } });
      try {
        const result = await tool.run(params?.arguments ?? {});
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2).slice(0, 60_000) }] } });
      } catch (error) {
        return send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] } });
      }
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown method" } });
  });
}

export async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`O serviço respondeu ${response.status}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}
