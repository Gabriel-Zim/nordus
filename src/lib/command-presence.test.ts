import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { commandPresence, detailsCommand, elapsedSince, presenceLine } from "./command-presence";
import { humanElapsed } from "./human-elapsed";
import type { Message } from "@/state/store";
import en from "@/locales/en.json";
import ptBr from "@/locales/pt-br.json";
import { COMMAND_KINDS } from "../../shared/command-words";

const bash = (command: string, extra: Partial<NonNullable<Message["tool"]>> = {}, at = 1_000): Message => ({
  id: `bash-${at}`,
  at,
  role: "bot",
  kind: "activity",
  tool: { name: "Bash", summary: command, ...extra },
});

describe("commandPresence", () => {
  beforeEach(() => setLocale("pt-br"));

  it("says what the command is in words, with when it began", () => {
    expect(commandPresence([bash("cd /home/nordus/projetos/wt-junta && npm exec vitest run 2>&1 | tail -40")])).toEqual({
      phrases: ["Rodando todos os testes"],
      phase: "command:allTests",
      since: 1_000,
    });
  });

  it("tells a narrowed test run from the whole suite", () => {
    expect(commandPresence([bash("pnpm exec vitest run server/foo.test.ts")])?.phrases).toEqual(["Rodando alguns testes"]);
  });

  it("says a known command from the table, whatever the bot's own sentence", () => {
    const steps = [{ at: 1, text: "Juntando o trabalho dos diretores" }, { at: 2, tool: "Bash" }];
    expect(commandPresence([bash("npm test")], steps)?.phrases).toEqual(["Rodando todos os testes"]);
  });

  it("uses the bot's sentence for a command the table does not know, only when it opens with a gerund", () => {
    expect(commandPresence([bash("./deploy.sh")], [{ at: 1, text: "Publicando a versão nova" }])?.phrases).toEqual(["Publicando a versão nova"]);
    expect(commandPresence([bash("./deploy.sh")], [{ at: 1, text: "Vou rodar os testes" }])?.phrases).toEqual(["Rodando um comando"]);
    expect(commandPresence([bash("./deploy.sh")], [{ at: 1, text: "checking the build" }])?.phrases).toEqual(["Rodando um comando"]);
  });

  it("falls back to the same plain line the bot's notice uses", () => {
    expect(commandPresence([bash("./deploy.sh --fast")])?.phrases).toEqual(["Rodando um comando"]);
  });

  it("never shows the raw command", () => {
    const line = commandPresence([bash("rm -rf node_modules && pnpm i")]);
    expect(JSON.stringify(line)).not.toContain("rm -rf");
  });

  it("is null once the command settled or when the tool is not a shell", () => {
    expect(commandPresence([bash("npm test", { ok: true })])).toBeNull();
    const read: Message = { id: "r", at: 1, role: "bot", kind: "activity", tool: { name: "Read" } };
    expect(commandPresence([read])).toBeNull();
    expect(commandPresence([])).toBeNull();
  });

  it("keeps the command while the person's message is still on its way to the server", () => {
    const messages: Message[] = [bash("npm test"), { id: "optimistic-s1", at: 2_000, role: "user", kind: "text", text: "qual status" }];
    expect(commandPresence(messages)?.phrases).toEqual(["Rodando todos os testes"]);
    expect(detailsCommand(messages, { showToolCalls: true, advanced: false })).toBe("npm test");
  });

  it("keeps the command after the person typed and a notice was posted meanwhile", () => {
    const messages: Message[] = [
      bash("npm test"),
      { id: "u", at: 2_000, role: "user", kind: "text", text: "qual status", steered: true },
      { id: "n", at: 3_000, role: "bot", kind: "text", text: "Ainda estou rodando", quickAck: true },
    ];
    expect(commandPresence(messages)?.since).toBe(1_000);
  });
});

describe("presenceLine", () => {
  beforeEach(() => setLocale("pt-br"));
  const START = 1_000_000;

  it("shows no time under a minute", () => {
    expect(presenceLine({ name: "PROGRAMADOR", doing: "Rodando todos os testes", since: START, now: START + 59_000 })).toBe("PROGRAMADOR está rodando todos os testes…");
  });

  it("shows how long from a minute on, with no ellipsis", () => {
    expect(presenceLine({ name: "PROGRAMADOR", doing: "Rodando todos os testes", since: START, now: START + 21 * 60_000 + 5_000 })).toBe(
      "PROGRAMADOR está rodando todos os testes · há 21 min",
    );
    expect(presenceLine({ name: "PROGRAMADOR", doing: "Rodando todos os testes", since: START, now: START + 65 * 60_000 })).toBe(
      "PROGRAMADOR está rodando todos os testes · há 1 h 05 min",
    );
  });

  it("keeps proper names in the bot's sentence and lowers only a leading gerund", () => {
    expect(presenceLine({ name: "PROGRAMADOR", doing: "Enviando o código para o Nordus", since: START, now: START })).toBe("PROGRAMADOR está enviando o código para o Nordus…");
    expect(presenceLine({ name: "PROGRAMADOR", doing: "Reason ao vivo com o Nordus", since: START, now: START })).toBe("PROGRAMADOR está Reason ao vivo com o Nordus…");
  });

  it("is the old line when no command is running", () => {
    expect(presenceLine({ name: "PROGRAMADOR", doing: "Pensando", now: START })).toBe("PROGRAMADOR está pensando…");
  });
});

describe("elapsedSince", () => {
  beforeEach(() => setLocale("pt-br"));

  it("is null below a minute and a phrase above", () => {
    expect(elapsedSince(0, 59_999)).toBeNull();
    expect(elapsedSince(0, 60_000)).toBe("há 1 min");
  });
});

describe("humanElapsed", () => {
  beforeEach(() => setLocale("pt-br"));

  it("reads seconds, minutes, then hours and minutes", () => {
    expect(humanElapsed(16_000)).toBe("há 16 s");
    expect(humanElapsed(3 * 60_000)).toBe("há 3 min");
    expect(humanElapsed(65 * 60_000)).toBe("há 1 h 05 min");
  });
});

describe("the words for each kind of command", () => {
  it.each(COMMAND_KINDS)("%s has a line in English and in Portuguese", (kind) => {
    const key = `command.kind.${kind}`;
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((ptBr as Record<string, string>)[key]).toBeTruthy();
  });
});

describe("detailsCommand", () => {
  const visible = { showToolCalls: true, advanced: false };

  it("shows the raw command only to someone who asked to see tool calls or uses the advanced view", () => {
    expect(detailsCommand([bash("pnpm test")], visible)).toBe("pnpm test");
    expect(detailsCommand([bash("pnpm test")], { showToolCalls: false, advanced: true })).toBe("pnpm test");
    expect(detailsCommand([bash("pnpm test")], { showToolCalls: false, advanced: false })).toBeUndefined();
    expect(detailsCommand([bash("pnpm test", { ok: true })], visible)).toBeUndefined();
  });

  it("keeps only the scheme and host of a web address, so a password, a path or a query never shows", () => {
    expect(detailsCommand([bash("curl -s 'https://ana:segredo@api.example.com/v1/x?token=abc' -o out.json")], visible))
      .toBe("curl -s 'https://api.example.com' -o out.json");
  });
});
