// An engine refusing a turn before it sent the prompt, in the plain English
// words the drivers throw and the server stores in the failed turn's row: the
// phones read those words whole, and the app words them again in the reader's
// language.

/** The engine whose own words these are, named in the reader's sentence. */
export type RefusingEngine = "Grok" | "Codex" | "Claude";

/** What the engine had that the bot's tool selection does not allow, what it could not confirm (retrying can
 * help), what its own settings keep it from confirming, or what this engine or model cannot do with a selection. */
export type TurnRefusal =
  | { kind: "extra-connections" | "unconfirmed" | "engine-config"; engine: RefusingEngine }
  | { kind: "tool-not-connected" | "model-profile" | "unsupported-engine" };

export const TURN_REFUSED = {
  grokCatalogUnconfirmed: "Grok could not confirm its MCP catalog. No prompt was sent.",
  grokExtraConnection: "Grok has an MCP connection outside the bot's selection. Disable native MCP connections before using tool selection. No prompt was sent.",
  grokCatalogUnenforced: "Grok could not enforce the selected MCP catalog. No prompt was sent.",
  grokServerNotConnected: "Grok could not connect a selected MCP server. No prompt was sent.",
  grokCatalogLate: "Grok did not confirm its selected MCP catalog in time. No prompt was sent.",
  grokModelProfile: "Grok could not confirm the selected model without replacing its tool profile. Start a new conversation or choose a model with a supported Grok profile. No prompt was sent.",
  grokProfileFile: "Grok's existing agent profile cannot be safely intersected with tool selection. Use a profile file with explicit tools or a separate default Grok account.",
  grokAgentEnv: "Grok's existing agent profile cannot be safely intersected with tool selection. Use a separate default Grok account.",
  grokRuntimeUnverified: "This Grok runtime does not have verified native tool selection. Use Grok 1.0.41 or Pi; update Grok support before using another version.",
  codexShellExclusions: "Codex could not confirm its shell environment exclusions. No prompt was sent.",
  codexShellSnapshots: "Codex could not disable inherited shell snapshots. No prompt was sent.",
  codexShellPolicy: "Codex could not confirm its shell environment policy. No prompt was sent.",
  codexMcpUnconfirmed: "Codex could not confirm its selected MCP configuration. No prompt was sent.",
  codexExtraServer: "Codex has an MCP server outside the selected configuration. Disable native MCP entries for this account before using tool selection. No prompt was sent.",
  claudeMcpUnconfirmed: "Claude cannot confirm a restricted MCP configuration for this account. Disable inherited Claude MCP servers and use a current, identifiable Claude CLI before using tool selection.",
  claudeCliUnconfirmed: "Claude cannot confirm a restricted MCP configuration with this Claude CLI. Use a current, identifiable Claude CLI before using tool selection.",
  /** After "<engine>: ". */
  selectionUnsupported: "tool selection is not supported by this engine. Choose a supported engine.",
  /** After "<engine>: ". */
  nativeSelectionUnsupported: "native tool selection is not supported by this engine. Keep native:* in the selection or choose a supported engine.",
} as const;

const REFUSAL: Record<keyof typeof TURN_REFUSED, TurnRefusal> = {
  grokCatalogUnconfirmed: { kind: "unconfirmed", engine: "Grok" },
  grokExtraConnection: { kind: "extra-connections", engine: "Grok" },
  grokCatalogUnenforced: { kind: "engine-config", engine: "Grok" },
  grokServerNotConnected: { kind: "tool-not-connected" },
  grokCatalogLate: { kind: "unconfirmed", engine: "Grok" },
  grokModelProfile: { kind: "model-profile" },
  grokProfileFile: { kind: "engine-config", engine: "Grok" },
  grokAgentEnv: { kind: "engine-config", engine: "Grok" },
  grokRuntimeUnverified: { kind: "unsupported-engine" },
  codexShellExclusions: { kind: "engine-config", engine: "Codex" },
  codexShellSnapshots: { kind: "engine-config", engine: "Codex" },
  codexShellPolicy: { kind: "engine-config", engine: "Codex" },
  codexMcpUnconfirmed: { kind: "engine-config", engine: "Codex" },
  codexExtraServer: { kind: "extra-connections", engine: "Codex" },
  claudeMcpUnconfirmed: { kind: "engine-config", engine: "Claude" },
  claudeCliUnconfirmed: { kind: "unconfirmed", engine: "Claude" },
  selectionUnsupported: { kind: "unsupported-engine" },
  nativeSelectionUnsupported: { kind: "unsupported-engine" },
};

/** Which refusal a failed turn's cause carries, or null for any other failure.
 * A cause can wrap the words ("Automatic recovery unavailable: … Original error: …"). */
export function turnRefusal(cause: string): TurnRefusal | null {
  const words = (Object.keys(TURN_REFUSED) as Array<keyof typeof TURN_REFUSED>).find(key => cause.includes(TURN_REFUSED[key]));
  return words ? REFUSAL[words] : null;
}
