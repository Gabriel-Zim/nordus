import { describe, expect, it } from "vitest";
import { BOARD_LIMITS } from "../../shared/board.ts";
import { fit } from "./salvage.ts";
import { storedMission, storedTask } from "./schema.ts";

const person = { kind: "person", id: "rafael@zorg.com" } as const;
const task = (extra: Record<string, unknown> = {}) => ({
  id: 1, title: "Subir", status: "todo", createdBy: person, createdAt: 1, updatedAt: 1, history: [], ...extra,
});
const mission = (extra: Record<string, unknown> = {}) => ({
  id: "m1", title: "Virar", goal: "g", createdBy: person, createdAt: 1, status: "running", leadBotId: "dev", teamBotIds: ["dev"],
  groupId: "sala", threadId: "th-sala", stepIds: [], feed: [], runner: {}, ...extra,
});

describe("fitting a row to what the loader accepts", () => {
  it("hands back a valid row as it is", () => {
    const row = task({ description: "ok", links: [{ url: "https://exemplo.com/" }] });
    expect(fit(storedTask, row)).toEqual(row);
  });

  it("cuts a text that is too long and keeps everything else", () => {
    const out = fit(storedTask, task({ description: "x".repeat(BOARD_LIMITS.description + 500) }));
    expect(out?.description).toHaveLength(BOARD_LIMITS.description);
    expect(out?.title).toBe("Subir");
  });

  it("cuts a list that is too long, and a name inside an actor", () => {
    const links = Array.from({ length: BOARD_LIMITS.links + 5 }, (_, index) => ({ url: `https://exemplo.com/${index}` }));
    const out = fit(storedTask, task({ links, createdBy: { kind: "person", id: "rafael@zorg.com", name: "N".repeat(400) } }));
    expect(out?.links).toHaveLength(BOARD_LIMITS.links);
    expect(out?.createdBy).toMatchObject({ kind: "person", name: "N".repeat(200) });
  });

  it("keeps a whole mission when only the text the runner owes an agent is too long", () => {
    const runner = { answer: { botId: "dev", text: "r".repeat(BOARD_LIMITS.runnerText + 700) } };
    const out = fit(storedMission, mission({ runner }));
    expect(out?.runner.answer?.text).toHaveLength(BOARD_LIMITS.runnerText);
    expect(out?.id).toBe("m1");
  });

  it("drops an optional part it cannot repair instead of the whole row", () => {
    const out = fit(storedTask, task({ source: { threadId: "has a space" } }));
    expect(out).toBeDefined();
    expect(out).not.toHaveProperty("source");
  });

  it("drops one bad item from a list and keeps the others", () => {
    const out = fit(storedTask, task({ links: [{ url: 7 }, { url: "https://exemplo.com/" }] }));
    expect(out?.links).toEqual([{ url: "https://exemplo.com/" }]);
  });

  it("gives up when something the row cannot do without is wrong", () => {
    expect(fit(storedTask, task({ status: "weird" }))).toBeUndefined();
    expect(fit(storedTask, task({ title: "" }))).toBeUndefined();
    expect(fit(storedTask, "not a row")).toBeUndefined();
  });

  it("never changes the row it was given", () => {
    const row: Record<string, unknown> = task({ description: "x".repeat(BOARD_LIMITS.description + 10) });
    fit(storedTask, row);
    expect(row.description).toHaveLength(BOARD_LIMITS.description + 10);
  });
});
