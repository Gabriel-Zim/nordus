import { describe, expect, it } from "vitest";

import { createTaskRoutes } from "./tasks.ts";

/** The real thread PATCH handler over stubs. Passing every guard reaches the write path, reported by throwing. */
async function patch(body: Record<string, unknown>, options: { targetBusy?: boolean; otherBusy?: boolean }) {
  const target: any = { id: "sac", name: "SAC", threadId: "t1", modelSelection: { instanceId: "x", model: "m" }, tasks: [], busy: options.targetBusy ?? false };
  const other: any = { id: "editordevideo", name: "EDITORDEVIDEO", busy: options.otherBusy ?? false, tasks: [] };
  const known: Record<string, unknown> = { bot: (id: string) => (id === "sac" ? target : undefined), bots: [target, other], projectBotForTask: () => target };
  const store = new Proxy(known, { get: (t, key) => { if (key in t) return t[key as string]; throw new Error(`passed the guards: store.${String(key)}`); } });
  const deps: any = new Proxy({
    store, desktopManaged: false, hostedWorkspace: false, cloudHome: false, hostedFullAccessRefusal: "",
    cloudThreadRefusal: () => null, supportsApprovalMode: () => true, threadBusy: () => false, checkedModelSelection: () => ({ ok: true, selection: target.modelSelection }),
  }, { get: (t, key) => (key in t ? t[key as keyof typeof t] : () => { throw new Error(`passed the guards: deps.${String(key)}`); }) });
  let result: { status: number; payload: any } | undefined;
  const json = (_res: unknown, status: number, payload: unknown) => { result = { status, payload: payload as any }; return true; };
  try {
    await createTaskRoutes(deps)({ req: { headers: {} }, res: {}, path: "/api/bots/sac/tasks/t1", method: "PATCH", url: new URL("http://127.0.0.1/api/bots/sac/tasks/t1"), auth: { kind: "loopback" }, json, readBody: async () => body } as any);
  } catch (error) {
    return { status: 0, payload: { error: (error as Error).message } };
  }
  return result ?? { status: 0, payload: { error: "no response" } };
}

describe("widening a thread's approval mode through the local API with no paired session", () => {
  it("is not held up by an unrelated bot that is working", async () => {
    const out = await patch({ approvalMode: "auto", acknowledgeLocalAuto: true }, { otherBusy: true });
    expect(out.payload.error ?? "").toMatch(/^passed the guards|^$/);
    expect(out.status).not.toBe(409);
  });

  it("is still refused while the bot it lands on is working", async () => {
    expect(await patch({ approvalMode: "auto", acknowledgeLocalAuto: true }, { targetBusy: true })).toMatchObject({ status: 409, payload: { error: expect.stringContaining("This bot is working") } });
  });
});
