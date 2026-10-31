import { describe, expect, it } from "vitest";

import { createBotPatchRoutes } from "./bot-patch.ts";

const POLICY = { allow: [{ label: "tudo", command: "node *" }], ask: [] };
const WIDER = { allow: [{ label: "tudo", command: "bash *" }], ask: [] };

/** The real PATCH handler over a stub store. A request that passes every guard reaches the write path, which the stub
 * reports as "passed the guards" by throwing, since nothing after the guards is under test here. */
async function patch(body: Record<string, unknown>, options: { origin?: string; busy?: boolean; leaderBusy?: boolean; groupTurn?: boolean; leader?: Record<string, unknown>; others?: Record<string, unknown>[] } = {}) {
  const leader: any = { id: "lead1", name: "DESIGNERGRAFICO", section: "QG", busy: options.leaderBusy ?? false, modelSelection: { instanceId: "x", model: "m" }, tasks: [], ...options.leader };
  const worker: any = { id: "busy1", name: "Mira", section: "QG", busy: options.busy ?? true, modelSelection: { instanceId: "x", model: "m" }, tasks: [] };
  const known: Record<string, unknown> = {
    bot: (id: string) => (id === "lead1" ? leader : undefined),
    bots: [leader, worker, ...(options.others ?? [])],
    sections: ["QG", "OUTRO"],
    tasks: () => [],
    taskByThread: () => undefined,
    projectBotForTask: () => undefined,
  };
  const store = new Proxy(known, { get: (target, key) => { if (key in target) return target[key as string]; throw new Error(`passed the guards: store.${String(key)}`); } });
  const deps: any = new Proxy({
    store, cfg: {}, desktopManaged: false, hostedWorkspace: false, hostedFullAccessRefusal: "", maxWorkspaceBots: 50,
    routines: () => null, requestedTaskBot: () => leader, activeGroupTurnForBot: (id: string) => (options.groupTurn && id === "lead1" ? {} : null), threadBusy: () => false, supportsApprovalMode: () => true,
  }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => { throw new Error(`passed the guards: deps.${String(key)}`); }) });
  let result: { status: number; payload: any } | undefined;
  const json = (_res: unknown, status: number, payload: unknown) => { result = { status, payload: payload as any }; return true; };
  const req: any = { headers: options.origin ? { origin: options.origin } : {} };
  try {
    await createBotPatchRoutes(deps)({ req, res: {}, path: "/api/bots/lead1", method: "PATCH", auth: { kind: "loopback" }, json, readBody: async () => body } as any);
  } catch (error) {
    return { status: 0, payload: { error: (error as Error).message } };
  }
  return result!;
}

describe("a leader's policy through the local API with no paired session", () => {
  it("is refused while the bot it lands on works, whatever Origin the call claims, like openTo", async () => {
    const busy = { leaderBusy: true };
    expect((await patch({ teamLead: POLICY }, busy)).status).toBe(409);
    expect(await patch({ teamLead: POLICY }, { ...busy, origin: "http://127.0.0.1:5173" })).toMatchObject({ status: 409, payload: { error: expect.stringContaining("This bot is working") } });
    expect((await patch({ teamLead: WIDER }, { ...busy, origin: "http://127.0.0.1:5173", leader: { teamLead: POLICY } })).status).toBe(409);
    expect((await patch({ section: "OUTRO" }, { ...busy, origin: "http://127.0.0.1:5173", leader: { teamLead: POLICY } })).status).toBe(409);
    expect((await patch({ openTo: ["QG"], acknowledgePeerScope: true }, { ...busy, origin: "http://127.0.0.1:5173" })).status).toBe(409);
  });

  it("is also refused while the target bot works in a group turn", async () => {
    expect((await patch({ teamLead: POLICY }, { groupTurn: true })).status).toBe(409);
  });

  it("passes the guards when only another, unrelated bot works, and when unchanged rules never count as widening", async () => {
    expect((await patch({ teamLead: POLICY }, { origin: "http://127.0.0.1:5173", busy: true })).payload.error).toMatch(/^passed the guards/);
    expect((await patch({ openTo: ["QG"], acknowledgePeerScope: true }, { busy: true })).payload.error).toMatch(/^passed the guards/);
    expect((await patch({ teamLead: POLICY }, { origin: "http://127.0.0.1:5173", leaderBusy: true, leader: { teamLead: POLICY } })).payload.error).toMatch(/^passed the guards/);
  });

  it("keeps one leader per team: a hidden leader coming back finds its team taken", async () => {
    const vera = { id: "vera", name: "Vera", section: "QG", teamLead: POLICY, modelSelection: { instanceId: "x", model: "m" }, tasks: [] };
    expect(await patch({ hidden: false }, { leader: { hidden: true, teamLead: POLICY }, others: [vera] })).toMatchObject({ status: 409, payload: { error: expect.stringContaining("Vera already leads QG") } });
    for (const hidden of [null, 0, ""]) {
      expect(await patch({ hidden }, { leader: { hidden: true, teamLead: POLICY }, others: [vera] }), String(hidden)).toMatchObject({ status: 409 });
    }
    expect((await patch({ teamLead: POLICY }, { others: [{ ...vera, hidden: true }] })).payload.error).toMatch(/^passed the guards/);
  });
});
