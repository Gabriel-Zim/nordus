// Claude Code PreToolUse hook for a bot working on its own: a critical action (spend, settings, permanent deletion,
// sending outside, deploy) waits for the person. The server either lets it run, has the bot ask in the conversation
// (Claude Code hands a "deny" reason to the model as the tool's result), or asks on a card through the permission
// prompt tool. Everything else passes untouched. Claude Code waits for this process, so it always exits 0.
import { readFileSync } from "node:fs";

import { criticalAction } from "../../shared/critical-action.ts";

/** Nordus: the server decides. It lets the action run, sends the person a card, or tells the bot what to ask in the conversation. */
/** Claude Code gives this hook 5 s (criticalHookSettings); the server may read the portal (about 1.4 s) or ask Jev. */
const SERVER_BUDGET_MS = 3_000;
const HARD_STOP_MS = 3_500;
const COMMAND_MAX = 4_000;
/** The whole input travels, so the server can bind an approval to exactly these parameters. */
const INPUT_MAX = 200_000;
const CONVERSATION_MAX = 2_000;

/** The breaker's answer to the engine: the person said no several times in a row, so the bot stops. */
const STOP_REASON = "Parei: a pessoa negou várias ações seguidas nesta conversa. Não tente de novo nem por outro caminho; termine e pergunte como ela quer seguir.";

type ServerAnswer = { kind: "pass" } | { kind: "ask" } | { kind: "stop" } | { kind: "talk"; text: string };

/** Anything but a clear answer from the server asks the person on a card. */
async function serverAnswer(reason: string, tool: string, command: string | undefined, input: unknown): Promise<ServerAnswer> {
  const url = process.env.NORDUS_HOOK_URL ?? "";
  const tokenFile = process.env.NORDUS_HOOK_TOKEN_FILE ?? "";
  if (!/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(url) || !tokenFile) return { kind: "ask" };
  let token = "";
  try { token = readFileSync(tokenFile, "utf8").trim(); } catch { return { kind: "ask" }; }
  if (!token) return { kind: "ask" };
  let whole = "";
  try { whole = JSON.stringify(input ?? {}); } catch { whole = ""; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_BUDGET_MS);
  try {
    const response = await fetch(`${url}/api/internal/critical-check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reason, tool, ...(command ? { command: command.slice(0, COMMAND_MAX) } : {}),
        ...(whole ? { input: whole.slice(0, INPUT_MAX), inputComplete: whole.length <= INPUT_MAX } : {}),
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "ask" };
    const body = (await response.json().catch(() => null)) as { critical?: unknown; stop?: unknown; conversation?: unknown } | null;
    if (body?.stop === true) return { kind: "stop" };
    if (body?.critical === false) return { kind: "pass" };
    const text = body?.conversation;
    if (typeof text === "string" && text.trim() && text.length <= CONVERSATION_MAX) return { kind: "talk", text };
    return { kind: "ask" };
  } catch {
    return { kind: "ask" };
  } finally {
    clearTimeout(timer);
  }
}

const decide = (decision: "ask" | "deny", reason: string) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } });

const MAX_INPUT_BYTES = 1024 * 1024;

function finish(out?: string): void {
  if (out === undefined) process.exit(0);
  process.stdout.write(out, () => process.exit(0));
}
/** Security invariant: once the call is known to be critical, running out of time asks the person, never lets it run. */
let critical: string | null = null;
setTimeout(() => finish(critical ? decide("ask", `critical action: ${critical}`) : undefined), HARD_STOP_MS).unref();

let data = "";
let bytes = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  bytes += Buffer.byteLength(chunk);
  if (bytes > MAX_INPUT_BYTES) finish();
  else data += chunk;
});
process.stdin.on("end", () => {
  let payload: { hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown };
  try { payload = JSON.parse(data); } catch { return finish(); }
  if (payload.hook_event_name !== "PreToolUse" || typeof payload.tool_name !== "string") return finish();
  const input = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input as { command?: unknown } : {};
  const command = typeof input.command === "string" ? input.command : undefined;
  const reason = criticalAction(payload.tool_name, command);
  if (!reason) return finish();
  critical = reason;
  void serverAnswer(reason, payload.tool_name, command, payload.tool_input).then((answer) => {
    if (answer.kind === "pass") return finish();
    if (answer.kind === "stop") return finish(decide("deny", STOP_REASON));
    if (answer.kind === "talk") return finish(decide("deny", answer.text));
    finish(decide("ask", `critical action: ${reason}`));
  });
});
process.stdin.on("error", () => finish());
