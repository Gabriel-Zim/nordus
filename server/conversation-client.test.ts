import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClientLens, clientContextPrompt, clientTopicName, loadClients, mentionedClients, parseFicha, resolveConversationClients,
  type ClientProfile,
} from "./conversation-client.ts";
import { routeCandidate, type CaptureClients } from "./memory-upkeep.ts";

const ficha = (front: string, body: string) => `---\n${front}\n---\n${body}\n`;
const evergreen = parseFicha("evergreen", "/marcas/evergreen", ficha("nome: Evergreen Capital\napelidos: EVERGREEN, @evergreencapital", "Tom: sóbrio. Instagram: @evergreencapital"));
const fabrikam = parseFicha("fabrikam", "/marcas/fabrikam", ficha("nome: Fabrikam Invest\napelidos: @fabrikaminvest\napelidos_ambiguos: fabrikam", "Tom: próximo. Instagram: @fabrikaminvest"));
const lumon = parseFicha("lumon", "/marcas/lumon", ficha("nome: Lumon\napelidos: LXR", "Tom: luxo. Instagram: @lumon"));
const clients: ClientProfile[] = [evergreen, fabrikam, lumon];
const known = new Set(clients.map((client) => client.slug));

describe("the client a message names", () => {
  it("finds a client by slug, name, @ or apelido, in the order named", () => {
    expect(mentionedClients("post para a Lumon e depois um da EVERGREEN", clients)).toEqual(["lumon", "evergreen"]);
    expect(mentionedClients("marca o @evergreencapital no story", clients)).toEqual(["evergreen"]);
    expect(mentionedClients("legenda pro LXR", clients)).toEqual(["lumon"]);
  });

  it("takes an everyday word only as the client's name when it reads as one", () => {
    expect(mentionedClients("troca as fontes do título", clients)).toEqual([]);
    expect(mentionedClients("usa outras fabrikam", clients)).toEqual([]);
    expect(mentionedClients("post para a Fabrikam sobre crédito", clients)).toEqual(["fabrikam"]);
    expect(mentionedClients("faz um post da fabrikam", clients)).toEqual(["fabrikam"]);
    expect(mentionedClients("cliente fabrikam, legenda nova", clients)).toEqual(["fabrikam"]);
  });

  it("ignores a name inside another word", () => {
    expect(mentionedClients("lumonxx não é cliente", clients)).toEqual([]);
  });
});

describe("the order a turn's client is decided in", () => {
  it("keeps a room's client whatever the message names", () => {
    expect(resolveConversationClients({ roomClient: "evergreen", mentioned: ["fabrikam"], previous: ["lumon"], known }))
      .toEqual({ active: ["evergreen"], outside: ["fabrikam"], source: "room" });
  });

  it("keeps a client's bot on its own client", () => {
    expect(resolveConversationClients({ botClient: "lumon", roomClient: "evergreen", mentioned: [], known }))
      .toEqual({ active: ["lumon"], outside: [], source: "bot" });
  });

  it("switches a private chat to the client named, and keeps it while none is named", () => {
    expect(resolveConversationClients({ mentioned: ["fabrikam"], previous: ["evergreen"], known }).active).toEqual(["fabrikam"]);
    expect(resolveConversationClients({ mentioned: [], previous: ["fabrikam"], known })).toEqual({ active: ["fabrikam"], outside: [], source: "previous" });
    expect(resolveConversationClients({ mentioned: [], known })).toEqual({ active: [], outside: [], source: "none" });
  });

  it("never counts a client without a ficha", () => {
    expect(resolveConversationClients({ mentioned: ["acme"], previous: ["acme"], known }).source).toBe("none");
  });
});

describe("the client part of the system prompt", () => {
  const prompt = (resolved: ReturnType<typeof resolveConversationClients>, opts: { internal?: boolean; room?: boolean } = {}) =>
    clientContextPrompt({ resolved, clients, internal: opts.internal ?? true, room: opts.room ?? false, memory: (slug) => slug === "fabrikam" ? "- prefere carrossel" : "" });

  it("carries the active client's ficha and memory and never another client's", () => {
    const text = prompt({ active: ["fabrikam"], outside: [], source: "previous" });
    expect(text).toContain("Cliente ativo: Fabrikam Invest");
    expect(text).toContain("@fabrikaminvest");
    expect(text).toContain("prefere carrossel");
    expect(text).toContain(join("/marcas/fabrikam", "trabalho"));
    expect(text).not.toMatch(/EVERGREEN|evergreen|Lumon|lumon/);
  });

  it("tells a client's room to say whose room it is when another client is named", () => {
    const text = prompt({ active: ["evergreen"], outside: ["fabrikam"], source: "room" }, { room: true });
    expect(text).toContain("esta sala é de Evergreen Capital");
    expect(text).not.toContain("@fabrikaminvest");
  });

  it("asks for the client when none is set, naming the clients only to an internal bot", () => {
    expect(prompt({ active: [], outside: [], source: "none" })).toContain("\"Para qual cliente?\"");
    expect(prompt({ active: [], outside: [], source: "none" }, { internal: false })).toBe("");
  });

  it("splits a request that names several clients", () => {
    const text = prompt({ active: ["evergreen", "lumon"], outside: [], source: "mentioned" });
    expect(text).toContain("Clientes ativos: Evergreen Capital e Lumon");
    expect(text).toContain("@evergreencapital");
    expect(text).toContain("@lumon");
    expect(text).not.toContain("@fabrikaminvest");
  });
});

describe("the memory a client's turn may see", () => {
  const lens = new ClientLens(["evergreen"], clients);

  it("drops the lines and topic files of another client", () => {
    expect(lens.filterLines("- geral: gosta de texto curto\n- a Fabrikam usa azul\n- a EVERGREEN usa verde")).toBe("- geral: gosta de texto curto\n- a EVERGREEN usa verde");
    expect(lens.hidesTopic(clientTopicName("fabrikam"), { aliases: [] })).toBe(true);
    expect(lens.hidesTopic(clientTopicName("evergreen"), { aliases: [] })).toBe(false);
    expect(lens.hidesTopic("grok-lumon.md", { aliases: [] })).toBe(true);
    expect(lens.hidesTopic("posts.md", { title: "Posts", aliases: ["LXR"] })).toBe(true);
    expect(lens.hidesTopic("estilo.md", { title: "Estilo do Avery", aliases: [] })).toBe(false);
  });

  it("hides every client's material from a turn with no client", () => {
    const none = new ClientLens([], clients);
    expect(none.hidesTopic(clientTopicName("evergreen"), { aliases: [] })).toBe(true);
    expect(none.filterLines("- a Lumon só posta à noite")).toBe("");
  });
});

describe("where a captured fact is kept", () => {
  const capture = (active: string[]): CaptureClients => ({
    active, named: (text) => mentionedClients(text, clients), name: (slug) => slug,
    topic: (slug) => ({ name: clientTopicName(slug), title: slug, aliases: [] }),
  });
  const fact = (text: string, general?: boolean) => ({ text, kind: "fact" as const, aboutUser: false, ...(general ? { general } : {}) });

  it("keeps a fact of the conversation's client in that client's memory unless it holds for every client", () => {
    expect(routeCandidate(fact("prefere fundo verde"), capture(["evergreen"]))).toEqual({ client: "evergreen" });
    expect(routeCandidate(fact("Avery quer legendas curtas", true), capture(["evergreen"]))).toEqual({});
  });

  it("files a fact by the client it names, and keeps none that names several", () => {
    expect(routeCandidate(fact("a Lumon posta às 19h"), capture([]))).toEqual({ client: "lumon" });
    expect(routeCandidate(fact("a Lumon posta às 19h", true), capture(["evergreen"]))).toEqual({ client: "lumon" });
    expect(routeCandidate(fact("EVERGREEN e Lumon dividem o fotógrafo"), capture(["evergreen"]))).toEqual({ drop: true });
    expect(routeCandidate(fact("prefere vídeo"), capture(["evergreen", "lumon"]))).toEqual({ drop: true });
  });

  it("changes nothing without clients", () => {
    expect(routeCandidate(fact("prefere vídeo"), null)).toEqual({});
  });
});

describe("the clients on disk", () => {
  let root: string | undefined;
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it("reads every folder with a FICHA.md and its regras.md", () => {
    root = mkdtempSync(join(tmpdir(), "clientes-"));
    mkdirSync(join(root, "evergreen"));
    writeFileSync(join(root, "evergreen", "FICHA.md"), ficha("nome: Evergreen Capital", "corpo"));
    writeFileSync(join(root, "evergreen", "regras.md"), "## Regras\n- sem emoji");
    mkdirSync(join(root, "sem-ficha"));
    mkdirSync(join(root, "Invalido"));
    writeFileSync(join(root, "Invalido", "FICHA.md"), "x");
    const found = loadClients(root);
    expect(found.map((client) => client.slug)).toEqual(["evergreen"]);
    expect(found[0]).toMatchObject({ name: "Evergreen Capital", ficha: "corpo", rules: "## Regras\n- sem emoji" });
  });
});
