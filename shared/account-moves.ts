// Account moves: the rules for sending robots to another model account, shared by the server (which applies them)
// and the Settings screen (which suggests them). Nothing here touches disk or the network.

export interface MoveSelection {
  instanceId: string;
  model: string;
  effort?: string;
  /** A model variant (kept whole; a variant and an effort never travel together). */
  variant?: string;
}

export interface MoveTarget extends MoveSelection {
  botId: string;
}

export type MoveItemStatus = "pendente" | "ok" | "falhou" | "cancelado" | "expirado" | "pulado";
export type MoveBatchKind = "move" | "undo";

export interface MoveItem {
  botId: string;
  botName: string;
  before: MoveSelection;
  target: MoveSelection;
  status: MoveItemStatus;
  message?: string;
  attempts: number;
  appliedAt?: number;
}

export interface MoveBatch {
  id: string;
  kind: MoveBatchKind;
  label: string;
  createdAt: number;
  undoOf?: string;
  undoneBy?: string;
  items: MoveItem[];
}

export interface AccountPreset {
  id: string;
  name: string;
  targets: MoveTarget[];
  updatedAt: number;
}

/** How long a robot may stay pending before the batch gives up on it. */
export const MOVE_EXPIRY_MS = 12 * 60 * 60_000;
export const MOVE_RETRY_MS = 60_000;
export const MAX_PRESETS = 50;

/** Instances that start with "claude" share one model family; the API-key one is metered, so it stays apart. */
export function accountFamily(instanceId: string): string {
  if (instanceId === "claudeApi") return instanceId;
  if (instanceId.startsWith("claude")) return "claude";
  // Codex and the ChatGPT plan offer the same models.
  if (instanceId === "codex" || instanceId === "chatgpt") return "codex";
  return instanceId;
}

const DEFAULT_MODEL: Readonly<Record<string, string>> = {
  codex: "gpt-6.1-sol",
  grok: "grok-4.7",
  claude: "claude-opus-5-5",
  cursor: "grok-4.7-xhigh",
};

const ACCEPTED_EFFORTS: Readonly<Record<string, readonly string[]>> = {
  codex: ["low", "medium", "high", "xhigh"],
  grok: ["low", "medium", "high"],
  claude: ["low", "medium", "high", "xhigh", "max"],
};

/** The efforts a family takes. A family without a rule takes none. */
export function acceptedEfforts(instanceId: string): readonly string[] {
  return ACCEPTED_EFFORTS[accountFamily(instanceId)] ?? [];
}

export function defaultModelFor(instanceId: string): string | undefined {
  return DEFAULT_MODEL[accountFamily(instanceId)];
}

/**
 * Model and effort a robot gets when it moves to `toInstanceId`: the same family keeps its model, a new family gets
 * that family's default (or `fallbackModel`, the destination's own default, when the family has none). An effort the
 * destination does not take becomes "high"; a family with no effort rule drops it.
 */
export function destinationFor(
  current: MoveSelection,
  toInstanceId: string,
  fallbackModel?: string,
): { model: string; effort?: string; variant?: string } {
  const sameFamily = accountFamily(current.instanceId) === accountFamily(toInstanceId);
  const model = sameFamily ? current.model : defaultModelFor(toInstanceId) ?? fallbackModel ?? current.model;
  if (sameFamily && current.variant && model === current.model) return { model, variant: current.variant };
  const accepted = acceptedEfforts(toInstanceId);
  if (!current.effort || accepted.length === 0) return { model };
  return { model, effort: accepted.includes(current.effort) ? current.effort : "high" };
}

export function sameSelection(a: MoveSelection, b: MoveSelection): boolean {
  return a.instanceId === b.instanceId && a.model === b.model && (a.effort ?? undefined) === (b.effort ?? undefined) &&
    (a.variant ?? undefined) === (b.variant ?? undefined);
}

export function itemCounts(items: readonly MoveItem[]): Record<MoveItemStatus, number> {
  const counts: Record<MoveItemStatus, number> = { pendente: 0, ok: 0, falhou: 0, cancelado: 0, expirado: 0, pulado: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}
