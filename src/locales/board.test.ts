import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { listNames } from "../../shared/place-view";
import { setLocale, t } from "@/lib/i18n";
import en from "./en.json";
import pt from "./pt-br.json";

const english = en as Record<string, string>;
const portuguese = pt as Record<string, string>;
const src = fileURLToPath(new URL("..", import.meta.url));

const sourceFiles = [
  "components/BoardPage.tsx",
  "components/SidebarFooterNav.tsx",
  "components/message-menu.tsx",
  "lib/board.ts",
  "lib/board-text.ts",
  "lib/board-compose.ts",
  "state/board.ts",
  ...readdirSync(join(src, "components/board")).filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name)).map((name) => `components/board/${name}`),
];
const FRAME_KINDS = new Set(["board.task", "board.task.deleted", "board.mission", "board.mission.deleted"]);
const OWNED = /^(?:board|missions)\.|^sidebar\.nav\.board$/;

const used = new Set(
  sourceFiles.flatMap((file) => [...readFileSync(join(src, file), "utf8").matchAll(/"((?:board|missions)\.[A-Za-z0-9.]+|sidebar\.nav\.board)"/g)].map((match) => match[1]!)),
);
for (const kind of FRAME_KINDS) used.delete(kind);
const owned = Object.keys(english).filter((key) => OWNED.test(key));
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

afterEach(() => setLocale("en"));

describe("the board's words", () => {
  it("has English and Brazilian Portuguese copy for every key the board screens read", () => {
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((key) => !Object.hasOwn(english, key))).toEqual([]);
    expect([...used].filter((key) => !Object.hasOwn(portuguese, key))).toEqual([]);
  });

  it("keeps no board or missions copy that nothing reads", () => {
    expect(owned.filter((key) => !used.has(key))).toEqual([]);
  });

  it("fills the same blanks in both languages", () => {
    expect(owned.filter((key) => placeholders(english[key]!).join() !== placeholders(portuguese[key]!).join())).toEqual([]);
  });

  it("is translated: Portuguese differs from English except for words that are the same in both", () => {
    const same = new Set(["board.panel.links", "board.panel.status", "missions.receipt.total"]);
    expect(owned.filter((key) => english[key] === portuguese[key] && !same.has(key))).toEqual([]);
  });

  it("never uses a long dash, or the technical words a simple screen avoids", () => {
    const technical = /\b(?:CLI|MCP|API|token|tokens|provedor|provedores|driver|terminal|JSON|endpoint)\b/i;
    const offenders = owned.flatMap((key) => [english[key]!, portuguese[key]!]
      .filter((text) => /[\u2013\u2014]/.test(text) || technical.test(text.replace(/\{\w+\}/g, " ")))
      .map((text) => `${key}: ${text}`));
    expect(offenders).toEqual([]);
  });
});

describe("the board in Brazilian Portuguese", () => {
  const say = (key: Parameters<typeof t>[0], params?: Parameters<typeof t>[1]) => {
    setLocale("pt-br");
    return t(key, params);
  };

  it("names the four columns and the six mission states in plain words", () => {
    expect(["todo", "doing", "review", "done"].map((status) => say(`board.column.${status}` as "board.column.todo"))).toEqual(["A fazer", "Em andamento", "Em revisão", "Feito"]);
    expect(["planning", "running", "waiting", "paused", "done", "failed"].map((status) => say(`missions.status.${status}` as "missions.status.done")).map((word) => word.toLowerCase()))
      .toEqual(["planejando", "em andamento", "aguardando você", "pausada", "concluída", "falhou"]);
  });

  it("says what happened to the agent that got a task", () => {
    expect(say("board.dispatch.sent", { name: "Dev" })).toBe("Enviado para Dev");
    expect(say("board.dispatch.queued", { name: "Dev" })).toBe("Na fila de Dev");
    expect(say("board.dispatch.skipped", { name: "Dev", reason: "está offline" })).toBe("Não foi possível avisar Dev: está offline");
  });

  it("writes the mission's subtitle, the feed's day and time, and the new task notice", () => {
    expect(say("missions.subtitle", { opener: "Rafael", agents: listNames(["Dev", "Atlas", "Nina"], "pt-br") })).toBe("Missão · aberta por Rafael · Dev, Atlas e Nina");
    expect(say("missions.feed.stamp", { day: 1, time: "09:12" })).toBe("Dia 1 · 09:12");
    expect(say("missions.feed.title")).toBe("Andamento");
    expect(say("board.created", { id: 88 })).toBe("Tarefa #88 criada");
    expect(say("board.card.moveTo")).toBe("Mover para");
    expect(say("board.menu.createTask")).toBe("Criar tarefa");
    expect(say("missions.done.end")).toBe("Missão concluída.");
  });
});
