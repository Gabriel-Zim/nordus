// A bot connects an app (an MCP server) by conversation: the person says yes in plain words, the server tests the
// connection, and only a connection that answers is saved, already on. The decision logic lives here so the route
// in index.ts stays thin and this can be tested without a running server.
import { createHash } from "node:crypto";

import type { CriticalCall, Decision } from "./conversation-approval.ts";
import { mcpHealthReason } from "./mcp-health.ts";
import type { McpProbeResult } from "./mcp-probe.ts";
import { addDisabledMcpServer, isRemoteMcpServer, type StoredMcpServer } from "./mcp-registry.ts";
import { redactSecretsInText } from "../shared/redact.ts";

export interface McpAddDeps {
  current: () => Record<string, unknown>;
  /** The organisation's refusal, if its policy does not allow this server. */
  refusal: (name: string, server: StoredMcpServer) => string | undefined;
  /** The conversation approval: only a yes from an administrator frees it; the decision model never does. */
  decide: (call: Omit<CriticalCall, "threadId" | "botId">) => Promise<Decision>;
  probe: (server: StoredMcpServer) => Promise<McpProbeResult>;
  persist: (next: Record<string, unknown>) => void;
  markNeedsSignIn: (name: string, url: string) => void;
  /** Single-flight with the MCP servers route: a release function, or null while another writer is busy. */
  acquire: () => (() => void) | null;
}

export interface McpAddOutcome {
  status: number;
  body: Record<string, unknown>;
}

/** The app's name as a person reads it: "notion" is "Notion". */
export const appDisplayName = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** What the person is asked about. Security invariant: the fingerprint binds the whole server (address or command,
 * arguments, header and variable names, sign-in app), through a digest longer than any value the question must show,
 * so a bot cannot ask about one app and connect another. Secret values never enter: the digest covers names only. */
export function mcpAddApproval(name: string, server: StoredMcpServer): Omit<CriticalCall, "threadId" | "botId"> {
  const remote = isRemoteMcpServer(server);
  const whole = JSON.stringify({
    name,
    ...(remote
      ? { type: server.type, url: server.url, headers: Object.keys(server.headers).sort(), oauth: server.oauth ? { clientId: server.oauth.clientId, scopes: server.oauth.scopes ?? [] } : null }
      : { command: server.command, args: server.args, env: Object.keys(server.env).sort() }),
  });
  const binding = createHash("sha512").update(whole).digest("hex");
  const shown = remote
    ? { host: new URL(server.url).host }
    : { command: server.command, args: server.args.filter((arg) => !arg.startsWith("-") && redactSecretsInText(arg) === arg) };
  return { reason: "config", tool: "add_mcp_server", input: { name, ...shown, binding } };
}

const turnedOn = (server: StoredMcpServer): StoredMcpServer => ({ ...server, enabled: true });

export async function addMcpServerByConversation(deps: McpAddDeps, body: unknown): Promise<McpAddOutcome> {
  const first = addDisabledMcpServer(deps.current(), body);
  if (!first.ok) return { status: first.status, body: { error: first.error } };
  const { name, server } = first;
  const refusal = deps.refusal(name, server);
  if (refusal) return { status: 403, body: { error: refusal, code: "managed_policy" } };
  const decision = await deps.decide(mcpAddApproval(name, server));
  if (decision.kind === "ask") return { status: 200, body: { needsYes: true, question: decision.botText } };
  // The desktop app has no sessions to answer, and an unreadable store cannot be trusted: save it off, as before.
  const cardOnly = decision.kind === "card" || Boolean(server.runsOn);
  // Only a person's yes reaches here. A command runs on this computer, so it is tested before anything is saved.
  const result = cardOnly ? null : await deps.probe(turnedOn(server));
  if (result && !result.ok && result.auth !== "required") {
    return { status: 422, body: { error: `Não conectei o app ${appDisplayName(name)}. ${mcpHealthReason(result)} Não salvei nada.` } };
  }
  const release = deps.acquire();
  if (!release) return { status: 409, body: { error: "MCP servers are already being updated." } };
  try {
    // The test may have taken seconds: another writer could have taken the name meanwhile.
    const again = addDisabledMcpServer(deps.current(), body);
    if (!again.ok) return { status: again.status, body: { error: again.error } };
    const saved = result ? turnedOn(again.server) : again.server;
    deps.persist({ ...again.next, [name]: saved });
    if (!result) return { status: 201, body: { name, enabled: false, state: "off" } };
    const signIn = !result.ok && isRemoteMcpServer(saved);
    if (signIn) deps.markNeedsSignIn(name, saved.url);
    return { status: 201, body: { name, enabled: true, state: signIn ? "needs-sign-in" : "connected" } };
  } finally {
    release();
  }
}
