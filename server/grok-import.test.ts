import { describe, expect, it } from "vitest";
import { GrokImportError, importGrokHistory, parseGrokImport } from "./grok-import.ts";
import { Store } from "./store.ts";

const selection = () => ({ instanceId: "fixture", model: "fixture-model" });

function fixture() {
  const store = new Store(selection);
  const gerentedeoperacao = store.createBot({ name: "Gerente De Operacao" }, { seedMessages: false });
  const designerdeia = store.createBot({ name: "DESIGNERDEIA" }, { seedMessages: false });
  const sm = store.createBot({ name: "LUMON" }, { seedMessages: false });
  store.appendMessage(gerentedeoperacao.threadId, { role: "user", kind: "text", text: "Pedido de hoje", at: 5_000 });
  const room = store.createGroup("LUMON HQ", [designerdeia.id, sm.id], false, undefined, undefined);
  return { store, gerentedeoperacao, designerdeia, sm, room };
}

describe("importGrokHistory", () => {
  it("writes old lines into a new inactive conversation and leaves the live one alone", () => {
    const { store, gerentedeoperacao } = fixture();
    const live = gerentedeoperacao.threadId;
    const result = importGrokHistory(store, parseGrokImport({
      target: { kind: "bot", id: gerentedeoperacao.id },
      title: "Histórico do Grok",
      lines: [
        { role: "bot", text: "Fechado Zorg", at: 2_000 },
        { role: "user", text: "Fala gerentedeoperacao", at: 1_000 },
        { role: "user", text: "Oi GerenteDeOperacao, aqui é a DESIGNERDEIA", at: 3_000, sender: "DESIGNERDEIA" },
      ],
    }));
    expect(result.imported).toBe(3);
    const bot = store.bot(gerentedeoperacao.id)!;
    expect(bot.threadId).toBe(live);
    expect(store.messagesFor(live).map((m) => m.text)).toEqual(["Pedido de hoje"]);
    const task = bot.tasks!.find((t) => t.threadId === result.threadId)!;
    expect(task.title).toBe("Histórico do Grok");
    expect(task.importedFrom).toBe("grok");
    expect(task.unread).toBe(false);
    expect(task.busy).toBe(false);
    const path = store.activePath(result.threadId);
    expect(path.map((m) => m.at)).toEqual([1_000, 2_000, 3_000]);
    expect(path.map((m) => m.text)).toEqual(["Fala gerentedeoperacao", "Fechado Zorg", "DESIGNERDEIA:\nOi GerenteDeOperacao, aqui é a DESIGNERDEIA"]);
    expect(path.every((m) => m.imported?.source === "grok" && m.kind === "text")).toBe(true);
    expect(path[0].parentId).toBeNull();
    expect(path[1].parentId).toBe(path[0].id);
    expect(path.some((m) => m.requestPending || m.queued)).toBe(false);
  });

  it("credits a room line to the member the export named, and keeps unknown speakers in the text", () => {
    const { store, designerdeia, room } = fixture();
    const result = importGrokHistory(store, parseGrokImport({
      target: { kind: "group", id: room.id },
      title: "Histórico do Grok",
      lines: [
        { role: "user", text: "Aqui falaremos sobre LUMON!", at: 1_000 },
        { role: "bot", text: "Capa pronta", at: 2_000, sender: "DESIGNERDEIA" },
        { role: "bot", text: "Tô aqui", at: 3_000, sender: "Bot da sala (não identificado)" },
      ],
    }));
    const group = store.group(room.id)!;
    expect(group.threadId).not.toBe(result.threadId);
    const path = store.activePath(result.threadId);
    expect(path[1].from).toEqual({ botId: designerdeia.id, name: "DESIGNERDEIA", color: store.bot(designerdeia.id)!.color });
    expect(path[1].text).toBe("Capa pronta");
    expect(path[2].from).toBeUndefined();
    expect(path[2].text).toBe("Bot da sala (não identificado):\nTô aqui");
  });

  it("refuses a second import of the same conversation instead of duplicating it", () => {
    const { store, gerentedeoperacao } = fixture();
    const input = parseGrokImport({ target: { kind: "bot", id: gerentedeoperacao.id }, title: "Histórico do Grok", lines: [{ role: "user", text: "oi", at: 1 }] });
    importGrokHistory(store, input);
    expect(() => importGrokHistory(store, input)).toThrow(GrokImportError);
    expect(store.bot(gerentedeoperacao.id)!.tasks!.filter((t) => t.title === "Histórico do Grok")).toHaveLength(1);
  });

  it("rejects a missing target and malformed lines", () => {
    const { store } = fixture();
    expect(() => importGrokHistory(store, parseGrokImport({ target: { kind: "bot", id: "nope" }, title: "x", lines: [{ role: "user", text: "a", at: 1 }] })))
      .toThrow(expect.objectContaining({ status: 404 }));
    expect(() => parseGrokImport({ target: { kind: "bot", id: "a" }, title: "x", lines: [{ role: "system", text: "a", at: 1 }] }))
      .toThrow(expect.objectContaining({ status: 400 }));
    expect(() => parseGrokImport({ target: { kind: "bot", id: "a" }, title: " ", lines: [{ role: "user", text: "a", at: 1 }] }))
      .toThrow(expect.objectContaining({ status: 400 }));
  });
});
