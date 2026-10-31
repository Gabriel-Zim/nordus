import { afterEach, describe, expect, it } from "vitest";

import { isKnowledgeError } from "./errors.ts";
import { ana, botAsker, chunksOf, isolated, member, tempService } from "./testing.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Ana is named by an admin, so she works in the company's space; the Secret agent is shown to admins only, so she sees nothing it writes. */
async function build() {
  const made = tempService();
  cleanups.push(made.cleanup);
  const secret = made.service.use(botAsker("secret", isolated));
  await secret.drive.save("Board/plan.md", Buffer.from("closed"));
  await secret.drive.save("Board/Deep/notes.md", Buffer.from("closed too"));
  secret.wiki.create({ title: "Layoffs", content: "closed" });
  const mine = made.service.use(member("ana@zorg.test", ana, isolated, ["ana@zorg.test"]), "internal");
  return { service: made.service, secret, mine };
}

type Failure = { code: string; message: string; detail?: Record<string, unknown> } | null;

const failureOf = async (run: () => unknown): Promise<Failure> => {
  try {
    await run();
  } catch (error) {
    if (!isKnowledgeError(error)) throw error;
    return { code: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}) };
  }
  return null;
};

const REVEALS = /exist|already|taken|hidden|cannot see|can't see/i;

describe("Drive names the asker cannot see", () => {
  it("refuses the name of a hidden file, of a folder that holds only hidden things, and of a hidden file in the way, like a name that cannot be used", async () => {
    const { mine } = await build();
    await mine.drive.save("own.txt", Buffer.from("mine"));
    const attempts: Array<[string, () => unknown]> = [
      ["a hidden file", () => mine.drive.save("Board/plan.md", Buffer.from("mine"))],
      ["a hidden folder", () => mine.drive.save("Board", Buffer.from("mine"))],
      ["a deeper hidden folder", () => mine.drive.save("Board/Deep", Buffer.from("mine"))],
      ["a hidden file where a folder should be", () => mine.drive.save("Board/plan.md/child.txt", Buffer.from("mine"))],
      ["a stream onto a hidden file", () => mine.drive.save("Board/plan.md", chunksOf("mine"))],
      ["moving onto a hidden file", () => mine.drive.move("own.txt", "Board/plan.md")],
      ["moving onto a hidden folder", () => mine.drive.move("own.txt", "Board")],
    ];
    for (const [what, run] of attempts) {
      const failure = await failureOf(run);
      expect([what, failure?.code]).toEqual([what, "bad_path"]);
      expect(failure?.message, what).not.toMatch(REVEALS);
      expect(failure?.detail, what).toBeUndefined();
    }
    expect(mine.drive.list("").items.map((item) => item.name)).toEqual(["own.txt"]);
  });

  it("still says what is in the way when the asker can see it", async () => {
    const { mine } = await build();
    await mine.drive.save("Docs/a.txt", Buffer.from("mine"));
    expect((await failureOf(() => mine.drive.save("Docs", Buffer.from("x"))))?.code).toBe("path_taken");
    expect((await failureOf(() => mine.drive.save("Docs/a.txt/child", Buffer.from("x"))))?.code).toBe("path_taken");
    await mine.drive.save("b.txt", Buffer.from("b"));
    expect((await failureOf(() => mine.drive.move("b.txt", "Docs/a.txt")))?.code).toBe("path_taken");
  });

  it("treats a folder that holds only hidden things as not there, exactly like one that never was", async () => {
    const { mine } = await build();
    const missing = await failureOf(() => mine.drive.list("Nowhere"));
    expect(missing).toMatchObject({ code: "not_found" });
    for (const folder of ["Board", "board", "Board/Deep"]) expect(await failureOf(() => mine.drive.list(folder)), folder).toEqual(missing);
    expect(mine.drive.list("").items).toEqual([]);
    expect((await failureOf(() => mine.drive.move("Board", "Elsewhere")))?.code).toBe("not_found");
    expect((await failureOf(() => mine.drive.remove("Board")))?.code).toBe("not_found");
    expect((await failureOf(() => mine.drive.remove("Board/Deep")))?.code).toBe("not_found");
    expect(mine.drive.search("plan")).toEqual([]);
  });

  it("lets the asker make a folder with the name of one that holds only hidden things, as if it were new", async () => {
    const { mine } = await build();
    expect(mine.drive.createFolder("Board")).toEqual({ path: "Board", created: true });
    expect(mine.drive.list("Board").items).toEqual([]);
    expect(mine.drive.createFolder("Board")).toEqual({ path: "Board", created: false });
    expect(mine.drive.list("").items.map((item) => item.name)).toEqual(["Board"]);
  });

  it("refuses to move or delete a folder that also holds hidden things without saying what it holds", async () => {
    const { mine } = await build();
    await mine.drive.save("Board/mine.txt", Buffer.from("mine"));
    expect(mine.drive.list("Board").items.map((item) => item.name)).toEqual(["mine.txt"]);
    for (const run of [() => mine.drive.move("Board", "Moved"), () => mine.drive.remove("Board")]) {
      const failure = await failureOf(run);
      expect(failure?.code).toBe("forbidden");
      expect(failure?.message).not.toMatch(REVEALS);
    }
  });
});

describe("Wiki titles the asker cannot see", () => {
  it("refuses the title of a hidden page like a title that cannot be used, whichever way it is reached", async () => {
    const { mine } = await build();
    const own = mine.wiki.create({ title: "Mine", content: "mine" });
    const attempts: Array<[string, () => unknown]> = [
      ["create", () => mine.wiki.create({ title: "Layoffs", content: "mine" })],
      ["write by title", () => mine.wiki.writeByTitle("Layoffs", "mine")],
      ["rename", () => mine.wiki.update(own.page.id, { title: "Layoffs" })],
    ];
    for (const [what, run] of attempts) {
      const failure = await failureOf(run);
      expect([what, failure?.code]).toEqual([what, "bad_title"]);
      expect(failure?.message, what).not.toMatch(REVEALS);
    }
    expect(mine.wiki.list({}).pages.map((page) => page.title)).toEqual(["Mine"]);
  });

  it("refuses to bring back a page from the trash onto a hidden title the same way", async () => {
    const { mine, secret } = await build();
    const draft = mine.wiki.create({ title: "Draft", content: "mine" });
    mine.wiki.remove(draft.page.id);
    secret.wiki.create({ title: "Draft", content: "closed" });
    const failure = await failureOf(() => mine.wiki.restoreFromTrash(draft.page.id));
    expect(failure?.code).toBe("bad_title");
    expect(failure?.message).not.toMatch(REVEALS);
  });

  it("still says the title is taken when the asker can see the page", async () => {
    const { mine } = await build();
    mine.wiki.create({ title: "Visible", content: "mine" });
    expect((await failureOf(() => mine.wiki.create({ title: "Visible", content: "again" })))?.code).toBe("title_taken");
    const other = mine.wiki.create({ title: "Other", content: "x" });
    expect((await failureOf(() => mine.wiki.update(other.page.id, { title: "Visible" })))?.code).toBe("title_taken");
  });

  it("counts the links of an import only over the pages the asker can see", async () => {
    const { service, mine } = await build();
    const started = service.imports.start(mine.space, mine.who, "Vault");
    const send = (path: string, content: string) => service.imports.addFile(mine.space, mine.who, started.session, path, chunksOf(content));
    await send("Note.md", "Points to [[Layoffs]] and to [[Mine]].");
    await send("Mine.md", "Back to [[Note]].");
    const summary = await service.imports.finish(mine.space, mine.who, started.session);
    expect(summary.pages.created).toBe(2);
    expect(summary.links).toEqual({ resolved: 2, missing: 1 });
    expect(mine.wiki.pageByTitle("Note")!.links).toEqual({ Layoffs: null, Mine: expect.any(String) });
  });
});
