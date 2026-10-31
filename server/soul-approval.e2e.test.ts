import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it("holds every soul change of a Full access turn on one card until the person approves it, and keeps memory free", async () => {
  const gates = mkdtempSync(join(tmpdir(), "nordus-soul-approval-"));
  const gate = join(gates, "finish");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
  const evidence: unknown[] = [];
  const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url,
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    evidence.push({ method, path, body, status: response.status, result });
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(expected);
    return result;
  };
  const control = async (...args: string[]) => {
    const result = await runControlNordus([...args, "--url", fixture.info.url]) as any;
    evidence.push({ command: args, result });
    return result;
  };
  const bots = async () => (await api("GET", "/api/bots")).bots as any[];
  const souls = async (ids: string[]) => {
    const fleet = await bots();
    return ids.map((id) => fleet.find((bot) => bot.id === id).soul ?? "");
  };
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const dump = () => JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
  const turnToken = async (previousPid?: number) => {
    let token = "";
    await expect.poll(() => {
      try { token = dump().pid !== previousPid ? dump().mcpConfig.mcpServers.agents.env.NORDUS_COMMS_TOKEN : ""; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 15_000 }).toBe(true);
    return token;
  };
  const idle = (botId: string) => expect.poll(async () => (await bots()).find((bot) => bot.id === botId).busy, { timeout: 15_000 }).toBe(false);
  try {
    const chief = (await api("POST", "/api/bots", { name: "Gerente De Operacao", section: "Ops" }, 201)).bot;
    const peers = [];
    for (const name of ["LUMON", "FABRIKAM", "EVERGREEN", "SOCIAL", "MontadorDeVideo"]) peers.push((await api("POST", "/api/bots", { name, section: "Ops" }, 201)).bot);
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, approvalMode: "full" });
    const targets = [...peers, chief];
    const ids = targets.map((bot) => bot.id);

    await control("send", "--bot", chief.id, "--task", chief.threadId, "--text", "Padronize o tom de todos os robôs.");
    let token = await turnToken();
    const internal = (path: string, body: object) => api("POST", path, { fromBotId: chief.id, fromThreadId: chief.threadId, ...body }, path.includes("profile") ? 201 : 200, token);

    const noted = await internal("/api/internal/memory", { action: "append", text: "Avery prefers short replies." });
    const logged = await internal("/api/internal/memory/log", { text: "Standardized the team's tone." });
    expect((await api("GET", `/api/bots/${chief.id}/memory/file?path=MEMORY.md`)).text).toContain("Avery prefers short replies.");
    expect((await api("GET", `/api/bots/${chief.id}/memory/file?path=${encodeURIComponent(logged.file)}`)).text).toContain("Standardized the team's tone.");
    expect(noted.ok).toBe(true);
    expect((await messages(chief.threadId)).filter((message) => message.card)).toEqual([]);

    const titled = await internal("/api/internal/profile-requests", { forBotId: peers[0].id, changes: { title: "Copywriter" }, reason: "Clearer roles" });
    expect(titled).toMatchObject({ state: "applied", appliedBy: "full-access" });

    const proposals = [];
    for (const target of targets) {
      proposals.push(await internal("/api/internal/profile-requests", {
        ...(target.id === chief.id ? {} : { forBotId: target.id }), changes: { soul: `Tom calmo para ${target.name}.` }, reason: "Padronizar o tom",
      }));
    }
    expect(proposals.map((proposal) => [proposal.state, proposal.batch.joined])).toEqual([["pending", false], ...Array(5).fill(["pending", true])]);
    expect(new Set(proposals.map((proposal) => proposal.requestId)).size).toBe(1);
    expect(await souls(ids)).toEqual(Array(6).fill(""));
    const soulCards = async () => (await messages(chief.threadId)).filter((message) => message.card?.profileRequest && !message.card.autoApplied);
    const [card] = await soulCards();
    expect(card.card.profileRequest.items.map((item: any) => item.targetBotId)).toEqual(ids);
    expect(card.card).toMatchObject({ options: ["Confirm", "Cancel"] });

    const respond = (body: object, expected: number) => api("POST", `/api/threads/${chief.threadId}/respond`, { requestId: card.card.requestId, ...body }, expected);
    expect((await respond({ behavior: "allow" }, 409)).error).toContain("still putting this request together");
    expect((await respond({ behavior: "allow", reviewedSha256: "0".repeat(64) }, 409)).error).toContain("list changed");
    expect(await souls(ids)).toEqual(Array(6).fill(""));

    writeFileSync(gate, "finish");
    await idle(chief.id);
    const approved = await respond({ behavior: "allow" }, 200);
    expect(approved.profileTargets.map((target: any) => target.targetBotId)).toEqual(ids);
    expect(await souls(ids)).toEqual(targets.map((target) => `Tom calmo para ${target.name}.`));
    expect((await soulCards())[0].card.answered).toBe("allow");

    const previousPid = dump().pid;
    unlinkSync(gate);
    await control("send", "--bot", chief.id, "--task", chief.threadId, "--text", "Agora mude só o FABRIKAM.");
    token = await turnToken(previousPid);
    const next = await internal("/api/internal/profile-requests", { forBotId: peers[1].id, changes: { soul: "Tom formal." }, reason: "Pedido novo" });
    expect(next).toMatchObject({ state: "pending", batch: { joined: false, count: 1 } });
    expect(next.requestId).not.toBe(card.card.requestId);
    await api("POST", `/api/threads/${chief.threadId}/respond`, { requestId: next.requestId, behavior: "deny" });
    expect((await souls([peers[1].id]))[0]).toBe("Tom calmo para FABRIKAM.");

    const setup = (operations: unknown[]) => api("POST", "/api/internal/team-setup-requests", { plan: { reason: "Ajustar o time", operations } }, 201, token);
    const held = await setup([{ action: "update", botId: peers[2].id, fields: { soul: "Tom técnico." } }]);
    expect(held).toMatchObject({ state: "pending", applied: false });
    expect((await souls([peers[2].id]))[0]).toBe("Tom calmo para EVERGREEN.");
    const created = await setup([{ action: "create", key: "Nova", fields: { name: "Nova", title: "Revisora", soul: "Revise tudo.", section: "Ops", modelSelection: chief.modelSelection } }]);
    expect(created).toMatchObject({ state: "applied", applied: true });
    expect((await bots()).find((bot) => bot.name === "Nova")).toMatchObject({ soul: "Revise tudo." });
    writeFileSync(gate, "finish");
    await idle(chief.id);
  } finally {
    const evidencePath = `${fixture.info.logPath}.soul-approval.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath, logPath: fixture.info.logPath }));
    await fixture.close();
    await removeTempDir(gates);
  }
}, 90_000);
