import { describe, expect, it } from "vitest";

import { commandKind, commandText, isShellTool, lowerGerund, runningCommand, type CommandKind } from "./command-words";

describe("commandKind", () => {
  const cases: Array<[string, CommandKind | null]> = [
    ["cd /home/nordus/projetos/wt-junta && npm exec vitest run 2>&1 | tail -40", "allTests"],
    ["pnpm test > /tmp/x.log 2>&1", "allTests"],
    ["pnpm test &> /tmp/x.log", "allTests"],
    ["npm test &>> run.log", "allTests"],
    ["pnpm vitest run a.test.ts |& tee log", "someTests"],
    ["pnpm -w test", "allTests"],
    ["npm -w app test", "allTests"],
    ["npm --workspace app run test src/a.test.ts", "someTests"],
    ["pnpm --filter app exec vitest run", "allTests"],
    ["pnpm --filter app exec vitest run src/a.test.ts", "someTests"],
    ["yarn workspace app test", "allTests"],
    ["yarn workspace app jest src/a.test.ts", "someTests"],
    ["npm test 2> /tmp/err.log", "allTests"],
    ["pnpm vitest run a.test.ts", "someTests"],
    ["pnpm vitest", "allTests"],
    ["yarn jest", "allTests"],
    ["bun vitest run", "allTests"],
    ["pnpm --filter app test", "allTests"],
    ["pnpm -C app test", "allTests"],
    ["npm --prefix app test", "allTests"],
    ["timeout -s KILL 600 pnpm test", "allTests"],
    ["timeout --signal=KILL 10m pnpm test src/a.test.ts", "someTests"],
    ["cat > notes.md <<'EOF'\nnpm test\nEOF", null],
    ["cat <<EOF > run.sh\npnpm test\nEOF\nchmod +x run.sh", null],

    ["pnpm exec vitest run server/foo.test.ts", "someTests"],
    ["npx vitest", "allTests"],
    ["vitest run -t 'sends the ack'", "someTests"],
    ["vitest run --testNamePattern foo", "someTests"],
    ["vitest run --reporter dot", "allTests"],
    ["vitest run --config vite.config.ts", "allTests"],
    ["jest", "allTests"],
    ["jest src/a.test.ts", "someTests"],
    ["mocha", "allTests"],
    ["python -m pytest -q", "allTests"],
    ["pytest tests/test_x.py::test_one", "someTests"],
    ["pytest -k login", "someTests"],
    ["pnpm exec playwright test", "allTests"],
    ["playwright test e2e/login.spec.ts", "someTests"],
    ["npm test", "allTests"],
    ["pnpm test", "allTests"],
    ["yarn test", "allTests"],
    ["npm run test", "allTests"],
    ["npm run test:unit", "allTests"],
    ["pnpm test -- src/a.test.ts", "someTests"],
    ["go test ./...", "allTests"],
    ["go test ./pkg/auth", "someTests"],
    ["cargo test", "allTests"],
    ["cargo test parser::", "someTests"],
    ["timeout 3600 npm exec vitest run", "allTests"],
    ["CI=1 vitest run", "allTests"],
    ["/bin/zsh -lc 'cd app && pnpm test'", "allTests"],
    ["tsc --noEmit", "typeCheck"],
    ["corepack pnpm exec tsc -b", "typeCheck"],
    ["pnpm typecheck", "typeCheck"],
    ["eslint src", "lint"],
    ["biome check .", "lint"],
    ["pnpm lint", "lint"],
    ["npm install", "install"],
    ["pnpm i", "install"],
    ["pnpm install --frozen-lockfile", "install"],
    ["yarn add left-pad", "install"],
    ["npm ci", "install"],
    ["pip install -r requirements.txt", "install"],
    ["npm run build", "build"],
    ["pnpm build", "build"],
    ["vite build", "build"],
    ["docker build -t app .", "build"],
    ["electron-builder --mac", "build"],
    ["git push origin main", "gitPush"],
    ["git -C /repo push", "gitPush"],
    ["git pull --rebase", "gitPull"],
    ["git fetch origin", "gitPull"],
    ["git clone https://github.com/a/b", "gitPull"],
    ["git merge nordus", "gitMerge"],
    ["git rebase main", "gitMerge"],
    ["git cherry-pick abc123", "gitMerge"],
    ["git commit -m 'x'", "gitCommit"],
    ["ffmpeg -i in.mov out.mp4", "video"],
    ["ffprobe in.mov", "video"],
    ["whisper audio.mp3 --model small", "transcribe"],
    ["curl -s https://example.com", "web"],
    ["wget https://example.com/a.zip", "web"],
    ["rsync -av a/ b/", "copyFiles"],
    ["scp a.txt host:/tmp", "copyFiles"],
    ["rclone copy a b", "copyFiles"],
    ["cp -r a b", "copyFiles"],
    ["ssh prod 'ls /home'", "remote"],
    ["sleep 600", "wait"],
    ["export FOO=1 && tail -f log.txt | head -5", null],
    ["ls -la", null],
    ["cat vitest.config.ts", null],
    ["cp a.txt b.txt", null],
    ["", null],
  ];

  it.each(cases)("%s", (command, kind) => {
    expect(commandKind(command)).toBe(kind);
  });

  it("takes the first piece that the table knows, skipping cd, export and tail", () => {
    expect(commandKind("cd x && export A=1 && git pull && npm test")).toBe("gitPull");
  });
});

describe("isShellTool", () => {
  it.each(["Bash", "bash", "shell", "Terminal", "exec", "execute", "run_command", "computer_exec", "vm_exec", "mcp__x__Bash", "Running Bash"])("%s", (name) => {
    expect(isShellTool(name)).toBe(true);
  });

  it.each(["Read", "Edit", "mcp__zorg__gerar_video", "grep", "bashful"])("%s is not one", (name) => {
    expect(isShellTool(name)).toBe(false);
  });
});

describe("commandText", () => {
  it("prefers the summary", () => {
    expect(commandText({ summary: "npm test", input: '{"command":"other"}' })).toBe("npm test");
  });

  it("falls back to the command in the JSON input", () => {
    expect(commandText({ input: '{"command":"npm test","description":"x"}' })).toBe("npm test");
  });

  it("is undefined when neither carries a command", () => {
    expect(commandText({ input: '{"path":"a"}' })).toBeUndefined();
    expect(commandText({ input: "not json" })).toBeUndefined();
    expect(commandText({ summary: "  " })).toBeUndefined();
    expect(commandText({})).toBeUndefined();
  });
});

describe("runningCommand", () => {
  const bash = (at: number, extra: Record<string, unknown> = {}) => ({
    role: "bot" as const,
    kind: "activity" as const,
    at,
    tool: { name: "Bash", summary: "npm exec vitest run", ...extra },
  });

  it("is the command that has not finished, with when it began", () => {
    expect(runningCommand([{ role: "user", kind: "text", at: 1 }, bash(5)])).toEqual({ command: "npm exec vitest run", since: 5 });
  });

  it("is null once the command has an outcome", () => {
    expect(runningCommand([bash(5, { ok: true })])).toBeNull();
    expect(runningCommand([bash(5, { ok: false })])).toBeNull();
  });

  it("is null when the bot said or did something else after the command", () => {
    expect(runningCommand([bash(5), { role: "bot", kind: "text", at: 6 }])).toBeNull();
    expect(runningCommand([bash(5), { role: "bot", kind: "activity", at: 6, tool: { name: "Read", ok: true, itemId: "t2" } }])).toBeNull();
  });

  it("still finds the command under what the person typed and the notices posted while it runs", () => {
    expect(runningCommand([bash(5), { role: "user", kind: "text", at: 6, steered: true }, { role: "bot", kind: "text", at: 7, quickAck: true }, { role: "user", kind: "text", at: 8, aside: true }]))
      .toEqual({ command: "npm exec vitest run", since: 5 });
  });

  it("ends at the person's message that opened a new turn, so a command stopped without an outcome is not running", () => {
    expect(runningCommand([bash(5), { role: "user", kind: "text", at: 6 }, { role: "bot", kind: "text", at: 7, quickAck: true }])).toBeNull();
  });

  it("looks past an approval chip and an answered permission card, but not past a failure or an open card", () => {
    const chip = { role: "bot", kind: "activity", at: 6, tool: { name: "approved Bash", ok: true, approved: true } };
    const answered = { role: "bot", kind: "options", at: 6, card: { answered: "allow" } };
    expect(runningCommand([bash(5), chip, answered])?.command).toBe("npm exec vitest run");
    expect(runningCommand([bash(5), { role: "bot", kind: "activity", at: 6, tool: { name: "denied", ok: false } }])).toBeNull();
    expect(runningCommand([bash(5), { role: "bot", kind: "options", at: 6, card: {} }])).toBeNull();
  });

  it("is null for a tool that is not a shell", () => {
    expect(runningCommand([{ role: "bot", kind: "activity", at: 5, tool: { name: "Read", input: '{"command":"x"}' } }])).toBeNull();
  });

  it("follows a request that waited on the team's leader or went to the person, once it was allowed", () => {
    const waiting = (at: number, name: string) => ({ role: "bot", kind: "activity", at, tool: { name, ok: true, awaitingApproval: true } });
    const allowed = (at: number, name: string) => ({ role: "bot", kind: "activity", at, tool: { name, ok: true, approved: true } });
    expect(runningCommand([bash(5), waiting(6, "Esperando DESIGNERGRAFICO decidir"), allowed(30, "DESIGNERGRAFICO liberou: conferir a pasta")])).toEqual({ command: "npm exec vitest run", since: 30 });
    expect(runningCommand([bash(5), waiting(6, "DESIGNERGRAFICO levou este pedido a você"), allowed(40, "Você liberou")])?.since).toBe(40);
    expect(runningCommand([bash(5), waiting(6, "Approve for me: the automatic reviewer is not available"), allowed(9, "Aprovado")])?.since).toBe(9);
  });

  it("is null while the request still waits for a yes: the command has not started", () => {
    expect(runningCommand([bash(5), { role: "bot", kind: "activity", at: 6, tool: { name: "Esperando DESIGNERGRAFICO decidir", ok: true, awaitingApproval: true } }])).toBeNull();
  });

  it("ends at a stop, a restart or a retry, which also finish with ok and no tool call of their own", () => {
    for (const name of ["Stopped", "Resuming after a restart", "retrying (attempt 2/3 in 5s, overloaded)"]) {
      expect(runningCommand([bash(5), { role: "bot", kind: "activity", at: 6, tool: { name, ok: true } }]), name).toBeNull();
    }
  });

  it("counts the time from the approval, so a long wait for the person is not the command running", () => {
    expect(runningCommand([bash(5), { role: "bot", kind: "options", at: 6, card: { answered: "allow", answeredAt: 50 } }])?.since).toBe(50);
    expect(runningCommand([bash(5), { role: "bot", kind: "activity", at: 40, tool: { name: "approved Bash", ok: true, approved: true } }])?.since).toBe(40);
    expect(runningCommand([bash(5), { role: "bot", kind: "options", at: 6, card: { answered: "allow" } }])?.since).toBe(6);
  });

  it("is null when no command can be read", () => {
    expect(runningCommand([bash(5, { summary: undefined })])).toBeNull();
  });

  it("reads the command from the input when there is no summary", () => {
    expect(runningCommand([bash(5, { summary: undefined, input: '{"command":"sleep 9"}' })])).toEqual({ command: "sleep 9", since: 5 });
  });

  it("counts an engine that names the tool by the command itself, because only a command carries a summary", () => {
    expect(runningCommand([{ role: "bot", kind: "activity", at: 5, tool: { name: "npm test", summary: "npm test" } }])).toEqual({ command: "npm test", since: 5 });
  });

  it("ignores messages from the person", () => {
    expect(runningCommand([{ role: "user", kind: "activity", at: 5, tool: { name: "Bash", summary: "ls" } }])).toBeNull();
  });
});

describe("lowerGerund", () => {
  it("lowers a leading gerund only", () => {
    expect(lowerGerund("Rodando todos os testes")).toBe("rodando todos os testes");
    expect(lowerGerund("Running all tests")).toBe("running all tests");
    expect(lowerGerund("Reason ao vivo")).toBe("Reason ao vivo");
    expect(lowerGerund("GitHub")).toBe("GitHub");
    expect(lowerGerund("Fernando pediu os testes")).toBe("Fernando pediu os testes");
    expect(lowerGerund("Orlando revisou")).toBe("Orlando revisou");
    expect(lowerGerund("Fernando, roda os testes")).toBe("Fernando, roda os testes");
    expect(lowerGerund("Fernando: revisar")).toBe("Fernando: revisar");
  });
});
