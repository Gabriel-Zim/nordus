import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-nordus.ts";

// The real server: the move goes through the real PATCH /api/bots/:id handler, the undo puts the exact selection back,
// and the batch survives on disk.
it("moves a robot to another model and effort through the bot handler, then undoes it exactly", async () => {
  const fixture = await launchVerificationServer();
  const url = fixture.info.url;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const created = await call("POST", "/api/bots", { name: "Troca em lote" });
    expect(created.status).toBe(201);
    const botId = created.body.bot.id as string;
    const instances = (await call("GET", "/api/instances")).body.instances as Array<{ instanceId: string; snapshot: { state: string }; models: { default: string; options: Array<{ id: string }> }; capabilities?: { effortLevels?: string[] } }>;
    const instance = instances.find((candidate) => candidate.snapshot.state === "available" && candidate.models.options.length >= 2 && (candidate.capabilities?.effortLevels?.length ?? 0) >= 2)!;
    expect(instance, JSON.stringify(instances.map((i) => i.instanceId))).toBeTruthy();
    const [first, second] = instance.models.options.map((option) => option.id);
    const [low, high] = instance.capabilities!.effortLevels!;
    const set = await call("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId: instance.instanceId, model: first, effort: low } });
    expect(set.status).toBe(200);

    const moved = await call("POST", "/api/account-moves", {
      label: "Plano B",
      targets: [
        { botId, instanceId: instance.instanceId, model: second, effort: high },
        { botId: "ghost", instanceId: instance.instanceId, model: second },
      ],
    });
    expect(moved.status).toBe(200);
    expect(moved.body.batch.items.map((item: { status: string }) => item.status)).toEqual(["ok", "falhou"]);
    expect(moved.body.batch.items[0].before).toEqual({ instanceId: instance.instanceId, model: first, effort: low });
    const current = async () => ((await call("GET", "/api/bots")).body.bots ?? (await call("GET", "/api/bots")).body).find((bot: { id: string }) => bot.id === botId).modelSelection;
    expect(await current()).toEqual({ instanceId: instance.instanceId, model: second, effort: high });

    const refused = await call("POST", "/api/account-moves", { targets: [{ botId, instanceId: instance.instanceId, model: "not-in-the-catalog" }] });
    expect(refused.body.batch.items[0].status).toBe("falhou");
    expect(refused.body.batch.items[0].message).toContain("is not offered");
    expect(await current()).toEqual({ instanceId: instance.instanceId, model: second, effort: high });

    const undone = await call("POST", `/api/account-moves/${moved.body.batch.id}/undo`);
    expect(undone.body.batch.items.map((item: { status: string }) => item.status)).toEqual(["ok"]);
    expect(await current()).toEqual({ instanceId: instance.instanceId, model: first, effort: low });

    const listed = (await call("GET", "/api/account-moves")).body.batches as Array<{ id: string }>;
    expect(listed.map((batch) => batch.id)).toEqual([undone.body.batch.id, refused.body.batch.id, moved.body.batch.id]);
    const file = join(fixture.info.dataDir, "account-moves.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).batches).toHaveLength(3);
  } finally {
    await fixture.close();
  }
}, 120_000);
