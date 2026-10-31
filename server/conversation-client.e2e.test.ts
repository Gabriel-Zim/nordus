// Against the real server and the fake Claude: one internal social media bot in three client rooms and in a private
// chat. Each turn's assembled system prompt carries only its own client's ficha and memory.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";

const FICHAS: Record<string, string> = {
  evergreen: "---\nnome: Evergreen Capital\napelidos: EVERGREEN, @evergreencapital\n---\n# Ficha da Evergreen Capital\nTom de voz: sóbrio e técnico. Instagram: @evergreencapital. Publicar: Metricool, perfil @evergreencapital.\n",
  fabrikam: "---\nnome: Fabrikam Invest\napelidos: @fabrikaminvest\napelidos_ambiguos: fabrikam\n---\n# Ficha da Fabrikam Invest\nTom de voz: próximo e didático. Instagram: @fabrikaminvest.\n",
  lumon: "---\nnome: Lumon\napelidos: LXR, @lumon\n---\n# Ficha da Lumon\nTom de voz: luxo silencioso. Instagram: @lumon.\n",
};
const MARKER: Record<string, string> = { evergreen: "@evergreencapital", fabrikam: "@fabrikaminvest", lumon: "@lumon" };
const others = (slug: string) => Object.keys(MARKER).filter((other) => other !== slug);

it("gives every turn of one internal bot only the ficha and memory of the client it works for", async () => {
  const fixture = await launchVerificationServer();
  const { url, dataDir } = fixture.info;
  const env = { NORDUS_URL: url };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result;
  };
  const dump = () => {
    try {
      // SAFETY: the fake CLI writes exactly this shape; a missing or partial file reads as no dump yet
      return JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { argv: string[]; systemPrompt?: string };
    } catch {
      return undefined;
    }
  };
  const nextTurn = async (send: () => Promise<unknown>, botId: string) => {
    rmSync(fixture.fixtureDumpPath, { force: true });
    await send();
    await expect.poll(() => dump()?.systemPrompt ?? "", { timeout: 30_000 }).not.toBe("");
    await runControlNordus(["wait", "--bot", botId, "--timeout", "30"], { env });
    return { prompt: dump()!.systemPrompt!, argv: dump()!.argv };
  };
  try {
    const root = join(dataDir, "zorg", "marcas");
    for (const [slug, text] of Object.entries(FICHAS)) {
      mkdirSync(join(root, slug), { recursive: true });
      writeFileSync(join(root, slug, "FICHA.md"), text);
    }
    // SAFETY: control-nordus returns the created bot record under `bot`
    const { bot: created } = await runControlNordus(["new-bot", "--name", "Social"], { env }) as { bot: { id: string } };
    const bot = (await api("PATCH", `/api/bots/${created.id}`, { audience: "internal" })).bot as { id: string; threadId: string };
    expect(bot.threadId).toBeTruthy();
    // What the bot already knew before this feature: a general line, a line naming a client, and each client's topic.
    const workspace = join(dataDir, "workspaces", bot.id);
    mkdirSync(join(workspace, "memory"), { recursive: true });
    writeFileSync(join(workspace, "MEMORY.md"), "# Memory\n\n- 2026-10-01 · Avery quer legendas curtas.\n- 2026-10-01 · A Lumon só posta à noite.\n");
    for (const slug of Object.keys(FICHAS)) {
      writeFileSync(join(workspace, "memory", `cliente-${slug}.md`), `---\ntitle: Cliente ${slug}\n---\n- 2026-10-01 · nota-secreta-${slug}\n`);
    }

    expect((await api("GET", "/api/clients")).clients.map((client: { slug: string }) => client.slug)).toEqual(["evergreen", "fabrikam", "lumon"]);

    for (const slug of Object.keys(FICHAS)) {
      // SAFETY: the groups route returns the created room under `group`
      const { group } = await api("POST", "/api/groups", {
        name: `${slug.toUpperCase()} HQ`, memberIds: [bot.id],
        setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } },
      });
      expect((await api("PATCH", `/api/groups/${group.id}`, { client: slug })).group.client).toBe(slug);
      const { prompt, argv } = await nextTurn(() => api("POST", `/api/groups/${group.id}/messages`, { text: "faça a legenda de um post sobre o tema câmbio" }), bot.id);
      expect(prompt, `${slug} room`).toContain(MARKER[slug]);
      expect(prompt).toContain(`nota-secreta-${slug}`);
      expect(prompt).toContain("Avery quer legendas curtas");
      for (const other of others(slug)) {
        expect(prompt, `${slug} room leaks ${other}`).not.toContain(MARKER[other]);
        expect(prompt, `${slug} room leaks ${other}'s memory`).not.toContain(`nota-secreta-${other}`);
      }
      if (slug !== "lumon") expect(prompt).not.toContain("só posta à noite");
      expect(argv.join(" "), "the client's folder is reachable").toContain(join(root, slug));
      if (slug === "evergreen") {
        const crossed = await nextTurn(() => api("POST", `/api/groups/${group.id}/messages`, { text: "agora faz um post da Fabrikam" }), bot.id);
        expect(crossed.prompt).toContain("esta sala é de Evergreen Capital");
        expect(crossed.prompt).not.toContain(MARKER.fabrikam);
        expect(crossed.prompt).not.toContain("nota-secreta-fabrikam");
      }
    }

    const direct = await nextTurn(() => api("POST", `/api/bots/${bot.id}/messages`, { text: "post para a Fabrikam sobre crédito imobiliário", threadId: bot.threadId }), bot.id);
    expect(direct.prompt).toContain("Cliente ativo: Fabrikam Invest");
    expect(direct.prompt).toContain(MARKER.fabrikam);
    for (const other of others("fabrikam")) expect(direct.prompt).not.toContain(MARKER[other]);
    const listed = (await api("GET", "/api/bots?messages=0")).bots.find((entry: { id: string }) => entry.id === bot.id);
    const task = listed?.tasks?.find((entry: { threadId: string }) => entry.threadId === bot.threadId);
    expect(task?.clients).toEqual(["fabrikam"]);

    const followUp = await nextTurn(() => api("POST", `/api/bots/${bot.id}/messages`, { text: "agora um carrossel sobre o mesmo tema", threadId: bot.threadId }), bot.id);
    expect(followUp.prompt, "the next message without a name stays on Fabrikam").toContain("Cliente ativo: Fabrikam Invest");
    expect(followUp.prompt).toContain(MARKER.fabrikam);

    const fresh = await api("POST", `/api/bots/${bot.id}/tasks`, {});
    const threadId = fresh.task.threadId;
    const unnamed = await nextTurn(() => api("POST", `/api/bots/${bot.id}/messages`, { text: "faz um post", threadId }), bot.id);
    expect(unnamed.prompt).toContain("\"Para qual cliente?\"");
    for (const slug of Object.keys(MARKER)) expect(unnamed.prompt).not.toContain(MARKER[slug]);
    for (const slug of Object.keys(MARKER)) expect(unnamed.prompt).not.toContain(`nota-secreta-${slug}`);
    expect(unnamed.prompt).not.toContain("só posta à noite");
  } finally {
    await fixture.close();
  }
}, 240_000);
