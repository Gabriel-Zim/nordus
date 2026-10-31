import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accountFamily, acceptedEfforts, destinationFor, type MoveSelection } from "../shared/account-moves.ts";
import { AccountMoveError, AccountMoves, parseMoveTargets, type ApplyModelResult, type MoveBotView } from "./account-moves.ts";
import { dispatchInProcess } from "./account-moves-boot.ts";
import { requiredScope } from "./request-auth.ts";
import { createAccountMoveRoutes } from "./routes/account-moves.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "account-moves-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function world() {
  const bots = new Map<string, MoveBotView>();
  const refuse = new Map<string, ApplyModelResult>();
  const flags = { maintenance: false };
  let clock = 1_000_000;
  let ids = 0;
  const applied: Array<[string, MoveSelection]> = [];
  const add = (id: string, selection: MoveSelection, busy = false) => bots.set(id, { id, name: `Robô ${id}`, busy, modelSelection: selection });
  const make = () => new AccountMoves({
    file: join(dir, "account-moves.json"),
    bot: (id) => bots.get(id) ?? null,
    applyModel: async (id, selection) => {
      const refusal = refuse.get(id);
      if (refusal) return refusal;
      applied.push([id, selection]);
      bots.get(id)!.modelSelection = { ...selection };
      return { ok: true };
    },
    now: () => clock,
    newId: () => `id-${++ids}`,
    expiryMs: 12 * 3_600_000,
    maintenance: () => flags.maintenance,
  });
  return { flags, bots, refuse, applied, add, make, advance: (ms: number) => { clock += ms; } };
}

const claude: MoveSelection = { instanceId: "claude", model: "claude-opus-5-5", effort: "max" };

describe("destination rules", () => {
  it("keeps the model inside a family and uses the family default across families", () => {
    expect(destinationFor(claude, "claude-78baf5fa").model).toBe("claude-opus-5-5");
    expect(destinationFor({ ...claude, model: "claude-sonnet-5" }, "claude-78baf5fa").model).toBe("claude-sonnet-5");
    expect(destinationFor(claude, "codex").model).toBe("gpt-6.1-sol");
    expect(destinationFor(claude, "grok").model).toBe("grok-4.7");
    expect(destinationFor({ instanceId: "grok", model: "grok-4.7" }, "claude").model).toBe("claude-opus-5-5");
    expect(destinationFor({ instanceId: "codex", model: "gpt-6.1-terra" }, "chatgpt").model).toBe("gpt-6.1-terra");
    expect(destinationFor(claude, "antigravity", "gemini-3.8-flash-high").model).toBe("gemini-3.8-flash-high");
  });

  it("turns an effort the destination does not take into high, and drops it where there is no rule", () => {
    expect(destinationFor(claude, "codex").effort).toBe("high");
    expect(destinationFor({ ...claude, effort: "xhigh" }, "grok").effort).toBe("high");
    expect(destinationFor({ ...claude, effort: "low" }, "grok").effort).toBe("low");
    expect(destinationFor(claude, "claude-1234").effort).toBe("max");
    expect(destinationFor(claude, "opencodeGo", "x").effort).toBeUndefined();
    expect(destinationFor({ instanceId: "grok", model: "grok-4.7" }, "codex").effort).toBeUndefined();
  });

  it("knows the families and their efforts", () => {
    expect(accountFamily("claude-78baf5fa")).toBe("claude");
    expect(accountFamily("claudeApi")).toBe("claudeApi");
    expect(accountFamily("chatgpt")).toBe(accountFamily("codex"));
    expect(acceptedEfforts("grok")).toEqual(["low", "medium", "high"]);
    expect(acceptedEfforts("cursor")).toEqual([]);
  });
});

describe("account moves", () => {
  it("applies free robots now and keeps a busy one pending until it is free", async () => {
    const w = world();
    w.add("a", claude);
    w.add("b", claude, true);
    const moves = w.make();
    const batch = await moves.create({ label: "Plano B", targets: [
      { botId: "a", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" },
      { botId: "b", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" },
    ] });
    expect(batch.items.map((item) => item.status)).toEqual(["ok", "pendente"]);
    expect(w.applied.map(([id]) => id)).toEqual(["a"]);
    expect(batch.items[1]!.before).toEqual(claude);
    w.advance(60_000);
    await moves.tick();
    expect(moves.list()[0]!.items[1]!.status).toBe("pendente");
    w.bots.get("b")!.busy = false;
    w.advance(60_000);
    await moves.tick();
    expect(moves.list()[0]!.items.map((item) => item.status)).toEqual(["ok", "ok"]);
    expect(w.bots.get("b")!.modelSelection).toEqual({ instanceId: "codex", model: "gpt-6.1-sol", effort: "high" });
  });

  it("treats a 409 as still working and any other refusal as a failure with its message", async () => {
    const w = world();
    w.add("a", claude);
    w.add("b", claude);
    w.refuse.set("a", { ok: false, status: 409, error: "the bot is working" });
    w.refuse.set("b", { ok: false, status: 400, error: 'model "x" is not offered by instance "grok"' });
    const batch = await w.make().create({ targets: [
      { botId: "a", instanceId: "grok", model: "grok-4.7" },
      { botId: "b", instanceId: "grok", model: "x" },
      { botId: "ghost", instanceId: "grok", model: "grok-4.7" },
    ] });
    expect(batch.label).toBe("Troca em lote");
    expect(batch.items.map((item) => item.status)).toEqual(["pendente", "falhou", "falhou"]);
    expect(batch.items[1]!.message).toContain("is not offered");
    expect(batch.items[2]!.message).toContain("não encontrado");
  });

  it("expires a pending robot after 12 hours", async () => {
    const w = world();
    w.add("a", claude, true);
    const moves = w.make();
    await moves.create({ targets: [{ botId: "a", instanceId: "grok", model: "grok-4.7" }] });
    w.advance(11 * 3_600_000);
    await moves.tick();
    expect(moves.list()[0]!.items[0]!.status).toBe("pendente");
    w.advance(2 * 3_600_000);
    await moves.tick();
    expect(moves.list()[0]!.items[0]!.status).toBe("expirado");
    w.bots.get("a")!.busy = false;
    await moves.tick();
    expect(w.applied).toEqual([]);
  });

  it("cancels pending robots and leaves the finished ones", async () => {
    const w = world();
    w.add("a", claude);
    w.add("b", claude, true);
    const moves = w.make();
    const batch = await moves.create({ targets: [
      { botId: "a", instanceId: "grok", model: "grok-4.7" },
      { botId: "b", instanceId: "grok", model: "grok-4.7" },
    ] });
    await moves.cancel(batch.id);
    expect(moves.list()[0]!.items.map((item) => item.status)).toEqual(["ok", "cancelado"]);
    w.bots.get("b")!.busy = false;
    await moves.tick();
    expect(w.applied.map(([id]) => id)).toEqual(["a"]);
  });

  it("survives a restart: pending robots resume from the saved file", async () => {
    const w = world();
    w.add("b", claude, true);
    const first = w.make();
    await first.create({ label: "Antes do reinício", targets: [{ botId: "b", instanceId: "grok", model: "grok-4.7", effort: "high" }] });
    expect(JSON.parse(readFileSync(join(dir, "account-moves.json"), "utf8")).batches).toHaveLength(1);
    const second = w.make();
    expect(second.list()[0]!.label).toBe("Antes do reinício");
    expect(second.list()[0]!.items[0]!.status).toBe("pendente");
    w.bots.get("b")!.busy = false;
    await second.tick();
    expect(second.list()[0]!.items[0]!.status).toBe("ok");
    expect(w.make().list()[0]!.items[0]!.status).toBe("ok");
  });

  it("undo puts each robot back exactly, with no default rule", async () => {
    const w = world();
    w.add("a", { instanceId: "claude", model: "claude-sonnet-5", effort: "xhigh" });
    w.add("b", { instanceId: "claude", model: "claude-opus-5-5" });
    const moves = w.make();
    const batch = await moves.create({ targets: [
      { botId: "a", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" },
      { botId: "b", instanceId: "codex", model: "gpt-6.1-sol" },
    ] });
    const undo = await moves.undo(batch.id);
    expect(undo.kind).toBe("undo");
    expect(undo.undoOf).toBe(batch.id);
    expect(undo.items.map((item) => item.status)).toEqual(["ok", "ok"]);
    expect(w.bots.get("a")!.modelSelection).toEqual({ instanceId: "claude", model: "claude-sonnet-5", effort: "xhigh" });
    expect(w.bots.get("b")!.modelSelection).toEqual({ instanceId: "claude", model: "claude-opus-5-5" });
    expect(moves.list().find((candidate) => candidate.id === batch.id)!.undoneBy).toBe(undo.id);
  });

  it("undo skips a robot that has already changed and cancels what was still pending", async () => {
    const w = world();
    w.add("a", claude);
    w.add("b", claude);
    w.add("c", claude, true);
    const moves = w.make();
    const batch = await moves.create({ targets: ["a", "b", "c"].map((botId) => ({ botId, instanceId: "grok", model: "grok-4.7", effort: "high" })) });
    w.bots.get("b")!.modelSelection = { instanceId: "codex", model: "gpt-6.1-sol" };
    const undo = await moves.undo(batch.id);
    expect(undo.items.map((item) => [item.botId, item.status])).toEqual([["a", "ok"], ["b", "pulado"]]);
    expect(undo.items[1]!.message).toBe("Pulado: já mudou.");
    expect(w.bots.get("b")!.modelSelection).toEqual({ instanceId: "codex", model: "gpt-6.1-sol" });
    expect(moves.list().find((candidate) => candidate.id === batch.id)!.items.map((item) => item.status)).toEqual(["ok", "ok", "cancelado"]);
  });

  it("refuses an undo with nothing to undo and an unknown batch", async () => {
    const w = world();
    w.add("a", claude, true);
    const moves = w.make();
    const batch = await moves.create({ targets: [{ botId: "a", instanceId: "grok", model: "grok-4.7" }] });
    await expect(moves.undo(batch.id)).rejects.toMatchObject({ status: 409 });
    await expect(moves.undo("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("validates targets", () => {
    expect(() => parseMoveTargets([])).toThrow(AccountMoveError);
    expect(() => parseMoveTargets([{ botId: "a", instanceId: "x" }])).toThrow(/model/);
    expect(() => parseMoveTargets([{ botId: "a", instanceId: "x", model: "m" }, { botId: "a", instanceId: "x", model: "m" }])).toThrow(/twice/);
    expect(parseMoveTargets([{ botId: "a", instanceId: "x", model: "m", effort: null }])).toEqual([{ botId: "a", instanceId: "x", model: "m" }]);
  });

  it("saves, replaces and removes presets, and keeps them across a restart", async () => {
    const w = world();
    const moves = w.make();
    const targets = [{ botId: "a", instanceId: "codex", model: "gpt-6.1-sol", effort: "high" }];
    const saved = await moves.savePreset({ name: " Plano B: Claude esgotou ", targets });
    expect(saved.name).toBe("Plano B: Claude esgotou");
    const renamed = await moves.savePreset({ id: saved.id, name: "Plano C", targets });
    expect(w.make().presets()).toEqual([renamed]);
    await expect(moves.savePreset({ id: "ghost", name: "x", targets })).rejects.toMatchObject({ status: 404 });
    expect(await moves.removePreset(saved.id)).toBe(true);
    expect(await moves.removePreset(saved.id)).toBe(false);
    expect(w.make().presets()).toEqual([]);
  });
});

describe("safety of pending moves", () => {
  const to = (botId: string, instanceId = "grok", model = "grok-4.7") => ({ botId, instanceId, model });

  it("a newer batch wins: the older pending move is cancelled and never reapplied", async () => {
    const w = world();
    w.add("a", claude, true);
    const moves = w.make();
    const first = await moves.create({ targets: [to("a")] });
    w.bots.get("a")!.busy = false;
    const second = await moves.create({ targets: [to("a", "codex", "gpt-6.1-sol")] });
    expect(second.items[0]!.status).toBe("ok");
    expect(moves.list().find((batch) => batch.id === first.id)!.items[0]!.status).toBe("cancelado");
    await moves.tick();
    expect(w.bots.get("a")!.modelSelection.instanceId).toBe("codex");
  });

  it("skips a pending move when the robot was changed by hand in the meantime", async () => {
    const w = world();
    w.add("a", claude, true);
    const moves = w.make();
    await moves.create({ targets: [to("a")] });
    w.bots.get("a")!.modelSelection = { instanceId: "codex", model: "gpt-6.1-sol" };
    w.bots.get("a")!.busy = false;
    await moves.tick();
    const item = moves.list()[0]!.items[0]!;
    expect([item.status, item.message]).toEqual(["pulado", "Pulado: já mudou."]);
    expect(w.applied).toEqual([]);
  });

  it("does not apply during a workspace backup or restore and goes on afterwards", async () => {
    const w = world();
    w.add("a", claude);
    w.flags.maintenance = true;
    const moves = w.make();
    const batch = await moves.create({ targets: [to("a")] });
    expect(batch.items[0]!.status).toBe("pendente");
    await moves.tick();
    expect(w.applied).toEqual([]);
    w.flags.maintenance = false;
    await moves.tick();
    expect(moves.list()[0]!.items[0]!.status).toBe("ok");
  });

  it("a failing retry pass never escapes the timer", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const moves = new AccountMoves({ file: join(dir, "x.json"), bot: () => { throw new Error("store gone"); }, applyModel: async () => ({ ok: true }), retryMs: 1000 });
      (moves as unknown as { state: { batches: unknown[] } }).state.batches.push({ id: "p", kind: "move", label: "p", createdAt: Date.now(), items: [{ botId: "a", botName: "a", before: { instanceId: "c", model: "m" }, target: { instanceId: "g", model: "m" }, status: "pendente", attempts: 0 }] });
      moves.start();
      await vi.advanceTimersByTimeAsync(2500);
      moves.stop();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("retry failed"));
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps a file that does not parse under a new name and starts empty", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(join(dir, "account-moves.json"), "{ not json");
    const moves = world().make();
    warn.mockRestore();
    expect(moves.list()).toEqual([]);
    const files = readdirSync(dir);
    expect(files.some((name) => name.startsWith("account-moves.json.corrompido-"))).toBe(true);
    expect(files).not.toContain("account-moves.json");
  });

  it("drops malformed batches and presets but keeps the good ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = { id: "g", kind: "move", label: "ok", createdAt: 1, items: [{ botId: "a", botName: "a", before: { instanceId: "c", model: "m" }, target: { instanceId: "g", model: "m" }, status: "ok", attempts: 1 }] };
    writeFileSync(join(dir, "account-moves.json"), JSON.stringify({ batches: [null, { id: "x", label: "l", createdAt: 1 }, { ...good, id: "y", items: [null] }, good], presets: [null, { id: "p", name: "n", targets: [] }] }));
    const moves = world().make();
    warn.mockRestore();
    expect(moves.list().map((batch) => batch.id)).toEqual(["g"]);
    expect(moves.presets().map((preset) => preset.id)).toEqual(["p"]);
  });

  it("refuses to undo twice, and a no-op undo changes nothing", async () => {
    const w = world();
    w.add("a", claude);
    w.add("b", claude, true);
    const moves = w.make();
    const batch = await moves.create({ targets: [to("a"), to("b")] });
    const undo = await moves.undo(batch.id);
    expect(undo.items).toHaveLength(1);
    await expect(moves.undo(batch.id)).rejects.toMatchObject({ status: 409 });
    w.add("c", claude, true);
    const before = moves.list().length;
    const pendingOnly = await moves.create({ targets: [to("c")] });
    await expect(moves.undo(pendingOnly.id)).rejects.toMatchObject({ status: 409 });
    expect(moves.list()[0]!.items[0]!.status).toBe("pendente");
    expect(moves.list()).toHaveLength(before + 1);
  });

  it("caps the presets", async () => {
    const w = world();
    const moves = w.make();
    for (let i = 0; i < 50; i += 1) await moves.savePreset({ name: `p${i}`, targets: [to("a")] });
    await expect(moves.savePreset({ name: "one more", targets: [to("a")] })).rejects.toMatchObject({ status: 409 });
    const first = moves.presets()[0]!;
    await expect(moves.savePreset({ id: first.id, name: "renamed", targets: [to("a")] })).resolves.toMatchObject({ name: "renamed" });
  });

  it("keeps the model variant when parsing, comparing, moving inside a family and undoing", async () => {
    expect(parseMoveTargets([{ botId: "a", instanceId: "x", model: "m", variant: "fast" }])).toEqual([{ botId: "a", instanceId: "x", model: "m", variant: "fast" }]);
    expect(() => parseMoveTargets([{ botId: "a", instanceId: "x", model: "m", variant: "fast", effort: "high" }])).toThrow(/either/);
    expect(destinationFor({ instanceId: "claude", model: "m", variant: "fast" }, "claude-2")).toEqual({ model: "m", variant: "fast" });
    expect(destinationFor({ instanceId: "claude", model: "m", variant: "fast" }, "codex").variant).toBeUndefined();
    const w = world();
    const start = { instanceId: "claude", model: "m", variant: "fast" };
    w.add("a", start);
    const moves = w.make();
    const batch = await moves.create({ targets: [{ botId: "a", instanceId: "claude", model: "m2", variant: "slow" }] });
    expect(batch.items[0]!.before).toEqual(start);
    expect(w.bots.get("a")!.modelSelection).toEqual({ instanceId: "claude", model: "m2", variant: "slow" });
    await moves.undo(batch.id);
    expect(w.bots.get("a")!.modelSelection).toEqual(start);
  });
});

describe("account move routes", () => {
  it("needs the admin scope for every path, like any route that changes a robot", () => {
    for (const [method, path] of [["GET", "/api/account-moves"], ["POST", "/api/account-moves"], ["POST", "/api/account-moves/x/undo"], ["POST", "/api/account-moves/x/cancel"],
      ["GET", "/api/account-presets"], ["PUT", "/api/account-presets"], ["DELETE", "/api/account-presets/x"]] as const) {
      expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
    }
  });

  it("answers the batch, undo, cancel and preset paths and leaves other paths alone", async () => {
    const w = world();
    w.add("a", claude);
    const handler = createAccountMoveRoutes({ moves: w.make() });
    const call = async (method: string, path: string, body?: unknown) => {
      const routes: RouteHandler[] = [handler];
      return dispatchInProcess(routes, method, path, body ?? {});
    };
    const created = await call("POST", "/api/account-moves", { label: "x", targets: [{ botId: "a", instanceId: "grok", model: "grok-4.7" }] });
    expect(created.status).toBe(200);
    expect(created.body.batch.items[0].status).toBe("ok");
    expect((await call("GET", "/api/account-moves")).body.batches).toHaveLength(1);
    expect((await call("POST", "/api/account-moves", { targets: [] })).status).toBe(400);
    expect((await call("POST", `/api/account-moves/${created.body.batch.id}/undo`)).body.batch.kind).toBe("undo");
    expect((await call("POST", "/api/account-moves/ghost/cancel")).status).toBe(404);
    const preset = await call("PUT", "/api/account-presets", { name: "P", targets: [{ botId: "a", instanceId: "grok", model: "grok-4.7" }] });
    expect((await call("GET", "/api/account-presets")).body.presets).toEqual([preset.body.preset]);
    expect((await call("DELETE", `/api/account-presets/${preset.body.preset.id}`)).status).toBe(200);
    expect((await call("DELETE", "/api/account-presets/ghost")).status).toBe(404);
    expect(await handler({ path: "/api/bots", method: "GET" } as never)).toBe(PASS);
  });

  it("dispatchInProcess hands the body to the route that owns the path", async () => {
    const seen: unknown[] = [];
    const echo: RouteHandler = async ({ req, res, path, method, json, readBody }) => {
      if (method !== "PATCH" || path !== "/api/bots/x") return PASS;
      seen.push(await readBody(req));
      return json(res, 409, { error: "the bot is working" });
    };
    expect(await dispatchInProcess([echo], "PATCH", "/api/bots/x", { modelSelection: { instanceId: "grok", model: "m" } }))
      .toEqual({ status: 409, body: { error: "the bot is working" } });
    expect(seen).toEqual([{ modelSelection: { instanceId: "grok", model: "m" } }]);
    expect((await dispatchInProcess([echo], "GET", "/nope", {})).status).toBe(404);
  });
});
