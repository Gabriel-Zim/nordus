import { describe, expect, it } from "vitest";

import { judgeWaits, ORPHAN_REASON, type WaitNode } from "./wait-watch.ts";

const NOW = 10_000_000;
const WINDOW = 10 * 60_000;
const OLD = NOW - 2 * WINDOW;

const node = (id: string, status: WaitNode["status"], patch: Partial<WaitNode> = {}): WaitNode =>
  ({ id, status, awaited: true, lastActivityAt: OLD, turnAlive: false, continuation: false, ...patch });

const root = node("root", "waiting", { lastActivityAt: NOW });
const judge = (...nodes: WaitNode[]) => judgeWaits(nodes, NOW, WINDOW);

describe("judgeWaits", () => {
  it("keeps a wait whose teammate has a live turn, however old its last activity", () => {
    expect(judge(root, node("kid", "running", { parentId: "root", turnAlive: true }))).toEqual({ cancel: [], wake: [] });
  });

  it("keeps a wait whose teammate showed activity inside the window", () => {
    expect(judge(root, node("kid", "running", { parentId: "root", lastActivityAt: NOW - WINDOW + 1_000 }))).toEqual({ cancel: [], wake: [] });
  });

  it("keeps waiting while the teammate is parked on the person, however old", () => {
    expect(judge(root, node("kid", "needs_input", { parentId: "root" }))).toEqual({ cancel: [], wake: [] });
  });

  it("keeps a teammate queued behind a live turn or continuing in place", () => {
    expect(judge(root, node("kid", "queued", { parentId: "root", turnAlive: true })).cancel).toEqual([]);
    expect(judge(root, node("kid", "queued", { parentId: "root", continuation: true })).cancel).toEqual([]);
  });

  it("cuts loose a teammate a restart cut and nobody rescheduled inside the window", () => {
    expect(judge(root, node("kid", "queued", { parentId: "root" }))).toEqual({ cancel: [{ id: "kid", reason: ORPHAN_REASON }], wake: [] });
    expect(judge(root, node("kid", "resume", { parentId: "root" })).cancel.map(c => c.id)).toEqual(["kid"]);
  });

  it("cuts loose a running teammate with no live turn and no progress inside the window", () => {
    expect(judge(root, node("kid", "running", { parentId: "root" })).cancel.map(c => c.id)).toEqual(["kid"]);
  });

  it("judges a chain by its deepest live work: EstrategistaDeConteudo waits on a live Pesquisador, so neither is cut", () => {
    const estrategistadeconteudo = node("estrategistadeconteudo", "waiting", { parentId: "root" });
    expect(judge(root, estrategistadeconteudo, node("pesquisador", "running", { parentId: "estrategistadeconteudo", turnAlive: true }))).toEqual({ cancel: [], wake: [] });
  });

  it("cuts only the dead leaf of a chain, leaving the waiting middle to resume with its result", () => {
    const estrategistadeconteudo = node("estrategistadeconteudo", "waiting", { parentId: "root" });
    expect(judge(root, estrategistadeconteudo, node("pesquisador", "queued", { parentId: "estrategistadeconteudo" })).cancel.map(c => c.id)).toEqual(["pesquisador"]);
  });

  it("cuts a dead requester above dead work once, not twice", () => {
    const estrategistadeconteudo = node("estrategistadeconteudo", "resume", { parentId: "root" });
    expect(judge(root, estrategistadeconteudo, node("pesquisador", "queued", { parentId: "estrategistadeconteudo" })).cancel.map(c => c.id)).toEqual(["estrategistadeconteudo"]);
  });

  it("keeps a teammate whose own teammate is parked on the person", () => {
    const estrategistadeconteudo = node("estrategistadeconteudo", "waiting", { parentId: "root" });
    expect(judge(root, estrategistadeconteudo, node("pesquisador", "needs_input", { parentId: "estrategistadeconteudo" })).cancel).toEqual([]);
  });

  it("ignores teammates nothing waits on and wakes a waiter that has only those", () => {
    expect(judge(root, node("note", "running", { parentId: "root", awaited: false }))).toEqual({ cancel: [], wake: ["root"] });
    expect(judge(root)).toEqual({ cancel: [], wake: ["root"] });
  });

  it("does not wake a waiter whose teammates are done and reported: the runtime resumes it", () => {
    expect(judge(root, node("kid", "completed", { parentId: "root" }))).toEqual({ cancel: [], wake: [] });
  });

  it("never judges work under a requester that is itself running", () => {
    const running = node("root", "running", { lastActivityAt: NOW });
    expect(judge(running, node("kid", "queued", { parentId: "root" }))).toEqual({ cancel: [], wake: [] });
  });
});
