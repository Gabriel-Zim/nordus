import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { COMMAND_KINDS } from "../shared/command-words.ts";
import { DATA_DIR } from "./config.ts";
import { isContextMessage } from "./delta-context.ts";
import { COMMAND_FALLBACK_PT, COMMAND_WORDS_PT, LongCommandNotices, LONG_COMMAND_NOTICE_MS, longCommandNotice, longCommandNoticeFor } from "./long-command.ts";
import { Store } from "./store.ts";
import type { ModelSelection } from "./contracts.ts";

const MIN = 60_000;
const NOW = 10_000_000_000;

describe("COMMAND_WORDS_PT", () => {
  it("says every kind exactly as the chat line does", () => {
    const pack = JSON.parse(readFileSync(fileURLToPath(new URL("../src/locales/pt-br.json", import.meta.url)), "utf8")) as Record<string, string>;
    for (const kind of COMMAND_KINDS) expect(COMMAND_WORDS_PT[kind], kind).toBe(pack[`command.kind.${kind}`]);
    expect(Object.keys(COMMAND_WORDS_PT).sort()).toEqual([...COMMAND_KINDS].sort());
    expect(COMMAND_FALLBACK_PT).toBe(pack["command.unknown"]);
  });
});

describe("longCommandNotice", () => {
  const base = { command: "cd /x && npm exec vitest run 2>&1 | tail -40", since: NOW - 21 * MIN, now: NOW };

  it("stays quiet under two minutes", () => {
    expect(LONG_COMMAND_NOTICE_MS).toBe(2 * MIN);
    expect(longCommandNotice({ ...base, since: NOW - (2 * MIN - 1), queued: false })).toBeNull();
    expect(longCommandNotice({ ...base, since: NOW - 2 * MIN, queued: false })).toContain("há 2 min");
  });

  it("tells a steered message when it will be read", () => {
    expect(longCommandNotice({ ...base, queued: false })).toBe(
      "Ainda estou rodando todos os testes, há 21 min. Leio sua mensagem assim que esse comando terminar. Se quiser interromper, use Parar.",
    );
  });

  it("tells a queued message when it will run", () => {
    expect(longCommandNotice({ ...base, queued: true })).toBe(
      "Ainda estou rodando todos os testes, há 21 min. Sua mensagem está na fila e entra quando eu terminar. Se quiser interromper, use Parar.",
    );
  });

  it("says a known command from the table, whatever the bot's own sentence", () => {
    expect(longCommandNotice({ ...base, step: "Juntando o trabalho dos diretores e o Reason ao vivo.", queued: false })).toMatch(
      /^Ainda estou rodando todos os testes, há 21 min\./,
    );
  });

  it("uses the bot's sentence for an unknown command only when it opens with a gerund", () => {
    const unknown = { ...base, command: "./deploy.sh", queued: false };
    expect(longCommandNotice({ ...unknown, step: "Publicando a versão nova." })).toMatch(/^Ainda estou publicando a versão nova, há 21 min\./);
    expect(longCommandNotice({ ...unknown, step: "Vou rodar os testes" })).toMatch(/^Ainda estou rodando um comando, há 21 min\./);
    expect(longCommandNotice({ ...unknown, step: "checking the build" })).toMatch(/^Ainda estou rodando um comando, há 21 min\./);
    expect(longCommandNotice({ ...unknown, step: "Reason ao vivo" })).toMatch(/^Ainda estou rodando um comando, há 21 min\./);
  });

  it("counts hours", () => {
    expect(longCommandNotice({ ...base, since: NOW - 65 * MIN, queued: false })).toContain("há 1 h 05 min");
  });

  it("never carries the command or a dash", () => {
    const text = longCommandNotice({ ...base, queued: true })!;
    expect(text).not.toContain("vitest");
    expect(text).not.toMatch(/[\u2014\u2013]/);
  });
});

describe("longCommandNoticeFor", () => {
  const bash = (at: number) => ({ role: "bot" as const, kind: "activity" as const, at, tool: { name: "Bash", summary: "pnpm test" } });
  const person = (at: number) => ({ role: "user" as const, kind: "text" as const, at, steered: true });

  it("answers at once while a command that began over two minutes ago runs", () => {
    const notice = longCommandNoticeFor({ busy: true, path: [bash(NOW - 21 * MIN), person(NOW)], now: NOW, queued: false });
    expect(notice?.since).toBe(NOW - 21 * MIN);
    expect(notice?.text).toMatch(/^Ainda estou rodando todos os testes, há 21 min\./);
  });

  it("says nothing under the limit", () => {
    expect(longCommandNoticeFor({ busy: true, path: [bash(NOW - MIN), person(NOW)], now: NOW, queued: false })).toBeNull();
  });

  it("says nothing when the bot is not busy, the command ended, or no command runs", () => {
    expect(longCommandNoticeFor({ busy: false, path: [bash(NOW - 21 * MIN)], now: NOW, queued: false })).toBeNull();
    expect(longCommandNoticeFor({ busy: true, path: [{ ...bash(NOW - 21 * MIN), tool: { name: "Bash", summary: "pnpm test", ok: true } }], now: NOW, queued: false })).toBeNull();
    expect(longCommandNoticeFor({ busy: true, path: [person(NOW)], now: NOW, queued: false })).toBeNull();
  });

  it("takes the bot's latest step for a command the table does not know", () => {
    const steps = [{ at: 1, text: "Conferindo a suíte" }, { at: 2, text: "Publicando a versão nova" }, { at: 3, tool: "Bash" }];
    const deploy = { ...bash(NOW - 5 * MIN), tool: { name: "Bash", summary: "./deploy.sh" } };
    expect(longCommandNoticeFor({ busy: true, path: [deploy], steps, now: NOW, queued: true })?.text).toMatch(/^Ainda estou publicando a versão nova, há 5 min\./);
  });
});

describe("LongCommandNotices in a real conversation", () => {
  const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  const setup = () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "PROGRAMADOR" });
    const threadId = bot.threadId;
    store.appendMessage(threadId, { role: "user", kind: "text", text: "roda os testes", at: NOW - 22 * MIN });
    store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: "Bash", summary: "cd /x && npm exec vitest run", itemId: "t1" }, at: NOW - 21 * MIN });
    const notices = new LongCommandNotices(store);
    const send = (now: number, queued: boolean, text: string) => {
      store.appendMessage(threadId, { role: "user", kind: "text", text, steered: true, at: now });
      notices.say(threadId, { busy: true, now, queued });
    };
    const texts = () => store.activePath(threadId).filter((m) => m.kind === "text").map((m) => m.text);
    return { store, threadId, send, texts };
  };

  it("answers under each message a few minutes apart, with the time moved on, hidden from the model", () => {
    const { store, threadId, send, texts } = setup();
    send(NOW, false, "qual status");
    send(NOW + 3 * MIN, true, "e ai???");
    expect(texts().slice(-5)).toEqual([
      "roda os testes",
      "qual status",
      expect.stringContaining("Ainda estou rodando todos os testes, há 21 min. Leio sua mensagem"),
      "e ai???",
      expect.stringContaining("Ainda estou rodando todos os testes, há 24 min. Sua mensagem está na fila"),
    ]);
    const quick = store.activePath(threadId).filter((m) => m.quickAck);
    expect(quick).toHaveLength(2);
    expect(quick.some(isContextMessage)).toBe(false);
  });

  it("rewrites the notice it just posted for this command instead of stacking another", () => {
    const { store, threadId, send } = setup();
    send(NOW, false, "qual status");
    send(NOW + 30_000, false, "?");
    send(NOW + 50_000, false, "??");
    const quick = store.activePath(threadId).filter((m) => m.quickAck);
    expect(quick).toHaveLength(1);
    expect(quick[0]!.text).toContain("há 21 min");
  });

  it("says nothing for a command under the limit or when the bot is not busy", () => {
    const { store, threadId } = setup();
    const notices = new LongCommandNotices(store);
    notices.say(threadId, { busy: false, now: NOW, queued: false });
    notices.say(threadId, { busy: true, now: NOW - 20 * MIN, queued: false });
    expect(store.activePath(threadId).some((m) => m.quickAck)).toBe(false);
  });
});
