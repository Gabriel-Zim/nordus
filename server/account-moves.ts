// Account moves: batches that send robots to another model account, with the exact "before" kept so a batch can be
// undone. A robot that is busy stays pending and is retried every minute until it is free, the person cancels, or 12 hours
// pass. State lives in one JSON file written atomically, so a restart resumes the pending ones.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

import {
  MAX_PRESETS,
  MOVE_EXPIRY_MS,
  MOVE_RETRY_MS,
  sameSelection,
  type AccountPreset,
  type MoveBatch,
  type MoveItem,
  type MoveSelection,
  type MoveTarget,
} from "../shared/account-moves.ts";
import { writeFileAtomic } from "./atomic.ts";

export interface MoveBotView {
  id: string;
  name: string;
  busy: boolean;
  modelSelection: MoveSelection;
}

export type ApplyModelResult = { ok: true } | { ok: false; status: number; error: string };

export interface AccountMovesDeps {
  file: string;
  bot(botId: string): MoveBotView | null;
  /** Same path as `PATCH /api/bots/:id` with `requireAvailableModel`; a 409 means "working, try later". */
  applyModel(botId: string, selection: MoveSelection): Promise<ApplyModelResult>;
  /** True while the workspace is being backed up or restored: nothing is applied, robots stay pending. */
  maintenance?: () => boolean;
  now?: () => number;
  newId?: () => string;
  retryMs?: number;
  expiryMs?: number;
}

export class AccountMoveError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const KEEP_BATCHES = 200;
const LIST_BATCHES = 50;
const MAX_TARGETS = 300;
const MAX_TEXT = 200;

interface MoveFile {
  version: 1;
  batches: MoveBatch[];
  presets: AccountPreset[];
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT) {
    throw new AccountMoveError(400, `${field} must be a non-empty text of at most ${MAX_TEXT} characters`);
  }
  return value.trim();
}

/** Throws a 400 AccountMoveError on a malformed list; the same shape serves batches and presets. */
export function parseMoveTargets(raw: unknown): MoveTarget[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new AccountMoveError(400, "targets must be a non-empty list");
  if (raw.length > MAX_TARGETS) throw new AccountMoveError(400, `targets can hold at most ${MAX_TARGETS} robots`);
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new AccountMoveError(400, `targets[${index}] must be an object`);
    const value = entry as Record<string, unknown>;
    const botId = text(value.botId, `targets[${index}].botId`);
    if (seen.has(botId)) throw new AccountMoveError(400, `robot ${botId} is listed twice`);
    seen.add(botId);
    const effort = value.effort === undefined || value.effort === null || value.effort === "" ? undefined : text(value.effort, `targets[${index}].effort`);
    const variant = value.variant === undefined || value.variant === null || value.variant === "" ? undefined : text(value.variant, `targets[${index}].variant`);
    if (effort && variant) throw new AccountMoveError(400, `targets[${index}] takes either an effort or a variant`);
    return { botId, instanceId: text(value.instanceId, `targets[${index}].instanceId`), model: text(value.model, `targets[${index}].model`), ...(effort ? { effort } : {}), ...(variant ? { variant } : {}) };
  });
}

export class AccountMoves {
  private readonly file: string;
  private state: MoveFile;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly retryMs: number;
  private readonly expiryMs: number;

  private readonly deps: AccountMovesDeps;

  constructor(deps: AccountMovesDeps) {
    this.deps = deps;
    this.file = deps.file;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => randomUUID());
    this.retryMs = deps.retryMs ?? MOVE_RETRY_MS;
    this.expiryMs = deps.expiryMs ?? MOVE_EXPIRY_MS;
    this.state = this.load();
  }

  private load(): MoveFile {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return { version: 1, batches: [], presets: [] };
    }
    let parsed: Partial<MoveFile> | null;
    try {
      parsed = JSON.parse(raw) as Partial<MoveFile> | null;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    } catch (error) {
      const moved = `${this.file}.corrompido-${new Date(this.now()).toISOString().replace(/[:.]/g, "-")}`;
      try { renameSync(this.file, moved); } catch { /* start empty anyway */ }
      console.warn(`account moves: ${this.file} could not be read (${error instanceof Error ? error.message : String(error)}); kept as ${moved}`);
      return { version: 1, batches: [], presets: [] };
    }
    const sel = (value: unknown): value is MoveSelection =>
      Boolean(value) && typeof value === "object" && typeof (value as MoveSelection).instanceId === "string" && typeof (value as MoveSelection).model === "string";
    const batches = (Array.isArray(parsed.batches) ? parsed.batches : []).filter((batch): batch is MoveBatch => {
      const ok = Boolean(batch) && typeof batch === "object" && typeof batch.id === "string" && typeof batch.label === "string" &&
        typeof batch.createdAt === "number" && Array.isArray(batch.items) &&
        batch.items.every((item) => Boolean(item) && typeof item.botId === "string" && sel(item.before) && sel(item.target) && typeof item.status === "string");
      if (!ok) console.warn("account moves: dropped a malformed batch from the saved file");
      return ok;
    });
    const presets = (Array.isArray(parsed.presets) ? parsed.presets : []).filter((preset): preset is AccountPreset => {
      const ok = Boolean(preset) && typeof preset === "object" && typeof preset.id === "string" && typeof preset.name === "string" && Array.isArray(preset.targets);
      if (!ok) console.warn("account moves: dropped a malformed preset from the saved file");
      return ok;
    });
    return { version: 1, batches, presets };
  }

  private save(): void {
    this.state.batches = this.state.batches.slice(0, KEEP_BATCHES);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  /** One mutation at a time, so a retry tick never interleaves with a new batch. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Retries pending robots now and then every minute. Safe to call once at boot. */
  start(): void {
    if (this.timer) return;
    const safeTick = () => this.tick().catch((error) => console.warn(`account moves: retry failed: ${error instanceof Error ? error.message : String(error)}`));
    void safeTick();
    this.timer = setInterval(() => void safeTick(), this.retryMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(): MoveBatch[] {
    return this.state.batches.slice(0, LIST_BATCHES);
  }

  presets(): AccountPreset[] {
    return this.state.presets;
  }

  private async attempt(item: MoveItem): Promise<void> {
    const bot = this.deps.bot(item.botId);
    if (!bot) {
      item.status = "falhou";
      item.message = "Robô não encontrado.";
      return;
    }
    item.botName = bot.name;
    if (sameSelection(bot.modelSelection, item.target)) {
      item.status = "ok";
      item.message = "Já estava neste modelo.";
      item.appliedAt = this.now();
      return;
    }
    if (!sameSelection(bot.modelSelection, item.before)) {
      // Someone (a newer batch, a manual change) moved the robot since this was queued; the newer choice wins.
      item.status = "pulado";
      item.message = "Pulado: já mudou.";
      return;
    }
    if (this.deps.maintenance?.()) {
      item.status = "pendente";
      item.message = "Backup ou restauração em andamento. Tento de novo em 1 minuto.";
      return;
    }
    item.attempts += 1;
    if (bot.busy) {
      item.status = "pendente";
      item.message = "Robô ocupado. Tento de novo em 1 minuto.";
      return;
    }
    let result: ApplyModelResult;
    try {
      result = await this.deps.applyModel(item.botId, item.target);
    } catch (error) {
      result = { ok: false, status: 500, error: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) {
      item.status = "ok";
      item.message = undefined;
      item.appliedAt = this.now();
    } else if (result.status === 409) {
      item.status = "pendente";
      item.message = `${result.error}. Tento de novo em 1 minuto.`;
    } else {
      item.status = "falhou";
      item.message = result.error;
    }
  }

  private async applyPending(batch: MoveBatch): Promise<void> {
    for (const item of batch.items) {
      if (item.status === "pendente") await this.attempt(item);
    }
  }

  private makeItem(bot: MoveBotView | null, botId: string, target: MoveSelection, status: MoveItem["status"] = "pendente", message?: string): MoveItem {
    return {
      botId,
      botName: bot?.name ?? botId,
      before: bot ? { ...bot.modelSelection } : { instanceId: "", model: "" },
      target: { ...target },
      status,
      ...(message ? { message } : {}),
      attempts: 0,
    };
  }

  /** A newer batch wins: pending robots of older batches for the same robots are cancelled. */
  private supersede(botIds: readonly string[], except: string): void {
    for (const batch of this.state.batches) {
      if (batch.id === except) continue;
      for (const item of batch.items) {
        if (item.status === "pendente" && botIds.includes(item.botId)) {
          item.status = "cancelado";
          item.message = "Substituído por uma troca mais nova.";
        }
      }
    }
  }

  create(input: { label?: unknown; targets: unknown }): Promise<MoveBatch> {
    const targets = parseMoveTargets(input.targets);
    const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 120) : "Troca em lote";
    return this.serial(async () => {
      const batch: MoveBatch = {
        id: this.newId(),
        kind: "move",
        label,
        createdAt: this.now(),
        items: targets.map((target) => {
          const { botId, ...selection } = target;
          return this.makeItem(this.deps.bot(botId), botId, selection);
        }),
      };
      this.supersede(targets.map((target) => target.botId), batch.id);
      this.state.batches.unshift(batch);
      this.save();
      await this.applyPending(batch);
      this.save();
      return batch;
    });
  }

  /** Puts each robot of a batch back where it was, only if it is still at that batch's destination. */
  undo(batchId: string): Promise<MoveBatch> {
    return this.serial(async () => {
      const original = this.state.batches.find((batch) => batch.id === batchId);
      if (!original) throw new AccountMoveError(404, "no such batch");
      if (original.undoneBy) throw new AccountMoveError(409, "this batch was already undone");
      const items: MoveItem[] = [];
      for (const item of original.items) {
        if (item.status !== "ok") continue;
        const bot = this.deps.bot(item.botId);
        const still = bot ? sameSelection(bot.modelSelection, item.target) : false;
        const entry = still
          ? this.makeItem(bot, item.botId, item.before)
          : this.makeItem(bot, item.botId, item.before, "pulado", "Pulado: já mudou.");
        if (!bot) entry.botName = item.botName;
        items.push(entry);
      }
      if (items.length === 0) throw new AccountMoveError(409, "nothing to undo in this batch");
      for (const item of original.items) {
        if (item.status === "pendente") {
          item.status = "cancelado";
          item.message = "Cancelado ao desfazer.";
        }
      }
      const batch: MoveBatch = {
        id: this.newId(),
        kind: "undo",
        label: `Desfazer: ${original.label}`.slice(0, 140),
        createdAt: this.now(),
        undoOf: original.id,
        items,
      };
      original.undoneBy = batch.id;
      this.supersede(items.map((item) => item.botId), batch.id);
      this.state.batches.unshift(batch);
      this.save();
      await this.applyPending(batch);
      this.save();
      return batch;
    });
  }

  cancel(batchId: string): Promise<MoveBatch> {
    return this.serial(async () => {
      const batch = this.state.batches.find((candidate) => candidate.id === batchId);
      if (!batch) throw new AccountMoveError(404, "no such batch");
      for (const item of batch.items) {
        if (item.status === "pendente") {
          item.status = "cancelado";
          item.message = "Cancelado por você.";
        }
      }
      this.save();
      return batch;
    });
  }

  /** One pass over every pending robot: expire the old ones, retry the rest. */
  tick(): Promise<void> {
    return this.serial(async () => {
      let changed = false;
      for (const batch of this.state.batches) {
        if (!batch.items.some((item) => item.status === "pendente")) continue;
        if (this.now() - batch.createdAt >= this.expiryMs) {
          for (const item of batch.items) {
            if (item.status === "pendente") {
              item.status = "expirado";
              item.message = "Expirou depois de 12 horas sem o robô ficar livre.";
            }
          }
        } else {
          await this.applyPending(batch);
        }
        changed = true;
      }
      if (changed) this.save();
    });
  }

  savePreset(input: { id?: unknown; name: unknown; targets: unknown }): Promise<AccountPreset> {
    const name = text(input.name, "name");
    if (name.length > 80) throw new AccountMoveError(400, "name must be at most 80 characters");
    const targets = parseMoveTargets(input.targets);
    return this.serial(async () => {
      const id = typeof input.id === "string" && input.id ? input.id : "";
      const existing = id ? this.state.presets.find((preset) => preset.id === id) : undefined;
      if (id && !existing) throw new AccountMoveError(404, "no such preset");
      if (!existing && this.state.presets.length >= MAX_PRESETS) throw new AccountMoveError(409, `at most ${MAX_PRESETS} presets can be saved`);
      const preset: AccountPreset = { id: existing?.id ?? this.newId(), name, targets, updatedAt: this.now() };
      this.state.presets = existing
        ? this.state.presets.map((candidate) => (candidate.id === preset.id ? preset : candidate))
        : [...this.state.presets, preset];
      this.save();
      return preset;
    });
  }

  removePreset(id: string): Promise<boolean> {
    return this.serial(async () => {
      const before = this.state.presets.length;
      this.state.presets = this.state.presets.filter((preset) => preset.id !== id);
      if (this.state.presets.length === before) return false;
      this.save();
      return true;
    });
  }
}
