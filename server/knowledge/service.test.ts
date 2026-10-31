import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isKnowledgeError } from "./errors.ts";
import { KnowledgeService } from "./service.ts";
import { admin, ana, beto, botAsker, chunksOf, gerentedeoperacao, isolated, member, tempService, type TestBot } from "./testing.ts";
import type { Requester } from "./wire.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const fresh = (limits: Parameters<typeof tempService>[0] = {}) => {
  const made = tempService(limits);
  cleanups.push(made.cleanup);
  return made.service;
};

const eva = { kind: "person", name: "Eva", key: "u-eva", email: "eva@evergreen.test" } as const;
const betoAsker = (bots: readonly TestBot[] = isolated): Requester => member("beto@evergreen.test", beto, bots);
const evaAsker = (bots: readonly TestBot[] = isolated): Requester => member("eva@evergreen.test", eva, bots);
const anaAsker = (bots: readonly TestBot[] = isolated, named = true): Requester => member("ana@zorg.test", ana, bots, named ? ["ana@zorg.test"] : []);

async function rejection(promise: unknown): Promise<{ code?: string }> {
  try {
    await promise;
  } catch (error) {
    return { code: isKnowledgeError(error) ? error.code : "other" };
  }
  return {};
}

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return isKnowledgeError(error) ? error.code : "other";
  }
  return undefined;
};

describe("space isolation", () => {
  it("keeps a client's agent in its own space and out of the company's and of other clients'", async () => {
    const service = fresh();
    const evergreen = service.use(botAsker("evergreen-bot", isolated));
    await evergreen.drive.save("proposal.md", Buffer.from("evergreen only"));
    evergreen.wiki.writeByTitle("EVERGREEN Brief", "private to evergreen");
    for (const target of ["internal", "client:fabrikam", "client:../internal", "client:evergreen/../fabrikam", "nonsense"]) {
      expect(codeOf(() => service.use(botAsker("evergreen-bot", isolated), target))).toBe("no_space");
    }
    const company = service.use(botAsker("gerentedeoperacao", isolated));
    expect(company.drive.list("").items).toEqual([]);
    expect(company.wiki.list({}).pages).toEqual([]);
    expect(codeOf(() => service.use(botAsker("gerentedeoperacao", isolated), "client:evergreen"))).toBe("no_space");
    expect(codeOf(() => company.drive.open("proposal.md"))).toBe("not_found");
  });

  it("gives an agent that is neither internal nor a client's no space at all", () => {
    const service = fresh();
    expect(codeOf(() => service.use(botAsker("loose", isolated)))).toBe("no_space");
    expect(codeOf(() => service.use(botAsker("loose", isolated), "internal"))).toBe("no_space");
  });

  it("shows each person only the spaces of the agents shown to them, and the company's only to admins and the people an admin named", () => {
    const service = fresh();
    expect(service.describe(betoAsker()).map((space) => space.id)).toEqual(["client:evergreen"]);
    expect(service.describe(anaAsker(isolated, false)).map((space) => space.id)).toEqual([]);
    expect(service.describe(anaAsker()).map((space) => space.id)).toEqual(["internal"]);
    expect(service.describe(member("who@else.test", ana, isolated)).map((space) => space.id)).toEqual([]);
    expect(service.describe(admin(isolated)).map((space) => space.id)).toEqual(["internal", "client:evergreen", "client:fabrikam"]);
    expect(codeOf(() => service.use(betoAsker(), "internal"))).toBe("no_space");
    expect(codeOf(() => service.use(anaAsker(isolated, false), "internal"))).toBe("no_space");
    expect(codeOf(() => service.use(anaAsker(), "client:evergreen"))).toBe("no_space");
    expect(service.use(betoAsker()).space.id).toBe("client:evergreen");
  });

  it("lets a person of one client use that client's Drive and Wiki while another client sees nothing of it", async () => {
    const service = fresh();
    const mine = service.use(betoAsker());
    await mine.drive.save("contracts/nda.pdf", Buffer.from("pdf"));
    mine.wiki.create({ title: "Onboarding", content: "Welcome" });
    const fabrikam = service.use(member("carla@fabrikam.test", ana, isolated), undefined).space.id;
    expect(fabrikam).toBe("client:fabrikam");
    const theirs = service.use(member("carla@fabrikam.test", ana, isolated));
    expect(theirs.drive.list("").items).toEqual([]);
    expect(theirs.wiki.list({}).pages).toEqual([]);
    expect(codeOf(() => theirs.drive.open("contracts/nda.pdf"))).toBe("not_found");
  });

  it("shows an admin each space on its own, never mixed", async () => {
    const service = fresh();
    await service.use(botAsker("evergreen-bot", isolated)).drive.save("a.md", Buffer.from("1"));
    await service.use(botAsker("gerentedeoperacao", isolated)).drive.save("b.md", Buffer.from("2"));
    const root = admin(isolated);
    expect(service.use(root, "client:evergreen").drive.list("").items.map((item) => item.name)).toEqual(["a.md"]);
    expect(service.use(root, "internal").drive.list("").items.map((item) => item.name)).toEqual(["b.md"]);
    expect(service.knownSpaces().sort()).toEqual(["client:evergreen", "internal"]);
  });

  it("hides what an agent shown to admins only wrote from everyone else in the space", async () => {
    const service = fresh();
    await service.use(botAsker("secret", isolated)).drive.save("board/notes.md", Buffer.from("closed"));
    service.use(botAsker("secret", isolated)).wiki.writeByTitle("Board", "closed");
    await service.use(botAsker("gerentedeoperacao", isolated)).drive.save("open.md", Buffer.from("open"));
    const ana = service.use(anaAsker());
    expect(ana.drive.list("").items.map((item) => item.name)).toEqual(["open.md"]);
    expect(ana.wiki.list({}).pages).toEqual([]);
    expect(codeOf(() => ana.drive.open("board/notes.md"))).toBe("not_found");
    expect(codeOf(() => ana.drive.info("board/notes.md"))).toBe("not_found");
    const root = service.use(admin(isolated), "internal");
    expect(root.drive.list("").items.map((item) => item.name).sort()).toEqual(["board", "open.md"]);
  });
});

describe("saving and reading files", () => {
  it("keeps the earlier content when a path is saved again and lists who saved what", async () => {
    const service = fresh();
    const mine = service.use(betoAsker());
    const first = await mine.drive.save("Reports/q4.md", chunksOf("first draft"));
    expect(first).toMatchObject({ outcome: "created", version: 1, file: { name: "q4.md", size: 11, versions: 1, preview: "markdown", canDelete: true } });
    const botSave = await service.use(botAsker("evergreen-bot", isolated)).drive.save("Reports/q4.md", Buffer.from("agent revision"), { note: "tidied" });
    expect(botSave).toMatchObject({ outcome: "updated", version: 2 });
    const info = mine.drive.info("Reports/q4.md");
    expect(info.versions.map((version) => [version.n, version.by.kind, version.by.name, version.current, version.note])).toEqual([
      [2, "bot", "EVERGREEN Bot", true, "tidied"],
      [1, "person", "Beto", false, undefined],
    ]);
    expect(info.file.by).toMatchObject({ kind: "bot", id: "evergreen-bot" });
    const listing = mine.drive.list("Reports");
    expect(listing).toMatchObject({ path: "Reports", breadcrumb: [{ name: "Reports", path: "Reports" }] });
    expect(listing.items).toHaveLength(1);
    expect(mine.drive.search("Q4").map((file) => file.path)).toEqual(["Reports/q4.md"]);
  });

  it("restores an earlier version as a new one and opens any version", async () => {
    const service = fresh();
    const mine = service.use(betoAsker());
    await mine.drive.save("n.txt", Buffer.from("one"));
    await mine.drive.save("n.txt", Buffer.from("two"));
    expect(mine.drive.restoreVersion("n.txt", 1)).toMatchObject({ outcome: "updated", version: 3 });
    expect(mine.drive.readText("n.txt", undefined, 100).text).toBe("one");
    expect(mine.drive.readText("n.txt", 2, 100).text).toBe("two");
    expect(mine.drive.readText("n.txt", 3, 2)).toMatchObject({ text: "on", truncated: true });
    expect(codeOf(() => mine.drive.open("n.txt", 9))).toBe("not_found");
    expect(mine.drive.open("n.txt", 1)).toMatchObject({ name: "n.txt", size: 3 });
  });

  it("refuses a file over the size cap before and while it is sent, and a space with no room left", async () => {
    const service = fresh({ driveFileMaxBytes: 8, spaceMaxBytes: 12 });
    const mine = service.use(betoAsker());
    expect((await rejection(mine.drive.save("big.bin", chunksOf("123456789"), { declaredSize: 9 }))).code).toBe("too_large");
    expect((await rejection(mine.drive.save("big.bin", chunksOf("123456789")))).code).toBe("too_large");
    expect((await rejection(mine.drive.save("big.bin", Buffer.from("123456789")))).code).toBe("too_large");
    expect(mine.drive.list("").items).toEqual([]);
    await mine.drive.save("a.bin", Buffer.from("12345678"));
    expect((await rejection(mine.drive.save("b.bin", Buffer.from("abcdefgh")))).code).toBe("full");
    expect((await rejection(mine.drive.save("a.bin", Buffer.from("12345678")))).code).toBeUndefined();
    await mine.drive.save("c.bin", Buffer.from("abcd"));
    expect(mine.drive.list("").items).toHaveLength(2);
  });

  it("refuses a path that climbs out or names no file", async () => {
    const service = fresh();
    const mine = service.use(betoAsker());
    for (const path of ["../x", "a/../../b", "a\\b", "", "/"]) expect((await rejection(mine.drive.save(path, Buffer.from("x")))).code).toBe("bad_path");
    expect(codeOf(() => mine.drive.list("../.."))).toBe("bad_path");
    expect(codeOf(() => mine.drive.open("../../etc/passwd"))).toBe("bad_path");
  });

  it("lets only an admin or the person who saved a file delete it, and keeps it in the trash", async () => {
    const service = fresh();
    const mine = service.use(betoAsker());
    await mine.drive.save("mine.txt", Buffer.from("m"));
    await service.use(botAsker("evergreen-bot", isolated)).drive.save("bot.txt", Buffer.from("b"));
    const others = service.use(evaAsker());
    expect(others.drive.list("").items.map((item) => (item.kind === "file" ? [item.name, item.canDelete] : [])).sort()).toEqual([["bot.txt", false], ["mine.txt", false]]);
    expect(codeOf(() => others.drive.remove("mine.txt"))).toBe("forbidden");
    expect(codeOf(() => mine.drive.remove("bot.txt"))).toBe("forbidden");
    expect(mine.drive.remove("mine.txt")).toEqual({ trashed: 1 });
    expect(service.use(admin(isolated), "client:evergreen").drive.remove("bot.txt")).toEqual({ trashed: 1 });
    expect(mine.drive.list("").items).toEqual([]);
    const trash = mine.drive.trash();
    expect(trash.map((item) => item.name).sort()).toEqual(["bot.txt", "mine.txt"]);
    const mineId = trash.find((item) => item.name === "mine.txt")!.id;
    expect(codeOf(() => others.drive.restoreFromTrash(mineId))).toBe("forbidden");
    expect(mine.drive.restoreFromTrash(mineId)).toMatchObject({ name: "mine.txt" });
    expect(mine.drive.list("").items.map((item) => item.name)).toEqual(["mine.txt"]);
  });

  it("moves and renames inside the space and creates folders idempotently", async () => {
    const service = fresh();
    const mine = service.use(betoAsker());
    expect(mine.drive.createFolder("Clients/EVERGREEN")).toEqual({ path: "Clients/EVERGREEN", created: true });
    expect(mine.drive.createFolder("clients/evergreen")).toEqual({ path: "Clients/EVERGREEN", created: false });
    await mine.drive.save("Clients/EVERGREEN/a.txt", Buffer.from("a"));
    expect(mine.drive.move("Clients/EVERGREEN/a.txt", "Clients/EVERGREEN/b.txt")).toMatchObject({ moved: 1 });
    expect(mine.drive.list("Clients/EVERGREEN").items.map((item) => item.name)).toEqual(["b.txt"]);
  });
});

describe("the Wiki through the API", () => {
  it("shows a page with its links, backlinks and the files it embeds", async () => {
    const service = fresh();
    const mine = service.use(betoAsker());
    await mine.drive.save("Wiki/anexos/Vault/img/photo.png", Buffer.from("png"));
    const target = mine.wiki.create({ title: "Target", content: "text" }).page;
    const source = mine.wiki.create({ title: "Source", folder: "Notes", content: "See [[Target]] and [[Nowhere]]\n![[photo.png]]\n![local](img/photo.png)" }).page;
    expect(source.links).toEqual({ Target: target.id, Nowhere: null, "photo.png": null });
    expect(source.files).toEqual({ "photo.png": "Wiki/anexos/Vault/img/photo.png", "img/photo.png": "Wiki/anexos/Vault/img/photo.png" });
    const detail = mine.wiki.page(target.id);
    expect(detail.backlinks).toEqual([{ id: source.id, title: "Source", folder: "Notes", excerpt: "See [[Target]] and [[Nowhere]]" }]);
    expect(detail).toMatchObject({ version: 1, createdBy: { kind: "person", name: "Beto" }, canDelete: true });
    expect(mine.wiki.graph()).toMatchObject({ nodes: expect.any(Array), edges: [{ source: source.id, target: target.id }] });
  });

  it("attributes an agent's page to the agent and guards a person's edit with the version they started from", () => {
    const service = fresh();
    const bot = service.use(botAsker("evergreen-bot", isolated));
    const written = bot.wiki.writeByTitle("Playbook", "v1", "first");
    expect(written).toMatchObject({ outcome: "created", page: { updatedBy: { kind: "bot", name: "EVERGREEN Bot" }, version: 1 } });
    const again = bot.wiki.writeByTitle("playbook", "v2");
    expect(again).toMatchObject({ outcome: "updated", page: { version: 2 } });
    expect(bot.wiki.writeByTitle("Clients/Brief", "in a folder").page.folder).toBe("Clients");
    const mine = service.use(betoAsker());
    const page = mine.wiki.list({}).pages.find((entry) => entry.title === "Playbook")!;
    expect(page.canDelete).toBe(false);
    expect(mine.wiki.update(page.id, { content: "mine", expectedVersion: 2 }).page.version).toBe(3);
    expect(codeOf(() => mine.wiki.update(page.id, { content: "stale", expectedVersion: 2 }))).toBe("conflict");
    expect(codeOf(() => mine.wiki.remove(page.id))).toBe("forbidden");
    expect(service.use(admin(isolated), "client:evergreen").wiki.remove(page.id)).toBeUndefined();
    expect(mine.wiki.trash().map((item) => item.title)).toEqual(["Playbook"]);
  });

  it("finds a page by title for an agent, with similar titles when it is not there", () => {
    const service = fresh();
    const bot = service.use(botAsker("gerentedeoperacao", isolated));
    bot.wiki.writeByTitle("Onboarding checklist", "step one");
    expect(bot.wiki.pageByTitle("onboarding CHECKLIST")?.content).toBe("step one");
    expect(bot.wiki.pageByTitle("Missing")).toBeNull();
    expect(bot.wiki.search("onboarding").map((hit) => hit.title)).toEqual(["Onboarding checklist"]);
  });

  it("rejects what is not text or has no title", () => {
    const service = fresh();
    const mine = service.use(betoAsker());
    expect(codeOf(() => mine.wiki.create({ content: "x" }))).toBe("bad_title");
    expect(codeOf(() => mine.wiki.create({ title: "T", content: 5 }))).toBe("bad_input");
    expect(codeOf(() => mine.wiki.create({ title: "T", folder: "../x", content: "" }))).toBe("bad_path");
    expect(codeOf(() => mine.wiki.update("missing", { content: "x" }))).toBe("not_found");
    expect(codeOf(() => mine.wiki.update("missing", { expectedVersion: 0 }))).toBe("bad_input");
  });

  it("shares one quota between the Wiki and the Drive of a space", async () => {
    const service = fresh({ spaceMaxBytes: 20 });
    const mine = service.use(betoAsker());
    await mine.drive.save("a.bin", Buffer.from("123456789012"));
    expect(codeOf(() => mine.wiki.create({ title: "Big", content: "1234567890" }))).toBe("full");
    expect(mine.wiki.create({ title: "Small", content: "123456" }).outcome).toBe("created");
  });
});

describe("the doorway", () => {
  it("refuses an unknown space the same way as one the asker may not use", () => {
    const service = fresh();
    expect(codeOf(() => service.use(admin(isolated), "client:unknown-client"))).toBe("no_space");
    expect(codeOf(() => service.use(admin(isolated), "client:BAD"))).toBe("no_space");
    expect(codeOf(() => service.use(anaAsker(), "client:unknown-client"))).toBe("no_space");
  });

  it("uses the first space the asker may use when none is named", () => {
    const service = fresh();
    expect(service.use(admin(isolated)).space.id).toBe("internal");
    expect(service.use(admin(isolated), "").space.id).toBe("internal");
    expect(service.use(botAsker("gerentedeoperacao", isolated)).drive.list("")).toMatchObject({ space: "internal", path: "" });
  });

  it("clears out what is not needed any more without touching what is", async () => {
    const service = fresh({ trashDays: 0 });
    const mine = service.use(betoAsker());
    await mine.drive.save("keep.txt", Buffer.from("keep"));
    await mine.drive.save("drop.txt", Buffer.from("drop"));
    mine.drive.remove("drop.txt");
    service.maintain(Date.now() + 86_400_000);
    expect(mine.drive.list("").items.map((item) => item.name)).toEqual(["keep.txt"]);
    expect(mine.drive.trash()).toEqual([]);
    expect(mine.drive.readText("keep.txt", undefined, 10).text).toBe("keep");
    void gerentedeoperacao;
  });
});

describe("the space the server picks for a conversation", () => {
  it("lets an admin open a client's space before it holds anything, and nobody else", () => {
    const service = fresh();
    expect(service.knownSpaces()).toEqual([]);
    expect(service.useDecided(admin(isolated), "client:acme").space.id).toBe("client:acme");
    expect(codeOf(() => service.useDecided(betoAsker(), "client:acme"))).toBe("no_space");
    expect(codeOf(() => service.useDecided(betoAsker(), "internal"))).toBe("no_space");
    expect(service.useDecided(betoAsker(), "client:evergreen").space.id).toBe("client:evergreen");
    expect(codeOf(() => service.useDecided(botAsker("evergreen-bot", isolated), "client:acme"))).toBe("no_space");
  });
});

describe("who the company's space is open to", () => {
  const made = () => {
    const tmp = tempService();
    cleanups.push(tmp.cleanup);
    return tmp;
  };

  it("is nobody until an admin names people, and the names outlast a restart", () => {
    const { service, root } = made();
    expect(service.internalPeople()).toEqual([]);
    expect(service.setInternalPeople([" Ana@ZORG.test ", "ana@zorg.test", "bia@zorg.test"])).toEqual(["ana@zorg.test", "bia@zorg.test"]);
    expect(new KnowledgeService({ root: join(root, "knowledge") }).internalPeople()).toEqual(["ana@zorg.test", "bia@zorg.test"]);
    expect(service.setInternalPeople([])).toEqual([]);
    expect(new KnowledgeService({ root: join(root, "knowledge") }).internalPeople()).toEqual([]);
  });

  it("takes whole addresses only: no domain, no wildcard, no list that is not a list", () => {
    const { service } = made();
    for (const bad of [["@zorg.test"], ["*"], ["zorg.test"], ["ana@zorg"], ["a b@zorg.test"], ["ana@zorg.test,bia@zorg.test"], [42], "ana@zorg.test", null, { 0: "ana@zorg.test" }]) {
      expect(codeOf(() => service.setInternalPeople(bad)), JSON.stringify(bad)).toBe("bad_input");
    }
    expect(codeOf(() => service.setInternalPeople(Array.from({ length: 201 }, (_, index) => `p${index}@zorg.test`)))).toBe("limit");
    expect(service.internalPeople()).toEqual([]);
  });

  it("opens the space to nobody when the saved list cannot be trusted", () => {
    const { root } = made();
    const folder = join(root, "knowledge");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "settings.json"), "{ not json");
    expect(new KnowledgeService({ root: folder }).internalPeople()).toEqual([]);
    writeFileSync(join(folder, "settings.json"), JSON.stringify({ internalPeople: ["@zorg.test", "*", 42, "ok@zorg.test", "x".repeat(400) + "@zorg.test"] }));
    expect(new KnowledgeService({ root: folder }).internalPeople()).toEqual(["ok@zorg.test"]);
  });

  it("opens the space to the named people alone, whatever the case of their address", () => {
    const service = fresh();
    expect(codeOf(() => service.use(anaAsker(isolated, false), "internal"))).toBe("no_space");
    expect(service.use(member("ANA@zorg.test", ana, isolated, ["ana@zorg.test"]), "internal").space.id).toBe("internal");
    expect(codeOf(() => service.use(member("bia@zorg.test", ana, isolated, ["ana@zorg.test"]), "internal"))).toBe("no_space");
    expect(codeOf(() => service.use(member("bia@zorg.test", ana, isolated, ["@zorg.test"]), "internal"))).toBe("no_space");
  });
});
