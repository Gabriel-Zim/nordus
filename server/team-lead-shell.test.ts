// The leader's rules read a command line the way the shell runs it. Every line they allow runs here in a real bash
// whose programs only record what they were given, and nothing may reach past what the rules name.
import { execFile } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, expect, it } from "vitest";
import { leadDecision, type LeadFiles, type TeamLeadPolicy } from "../shared/team-lead.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "team-lead-shell-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const bot = join(root, "bots", "designer");
const revisao = join(root, "bots", "diretor", "entregas", "lumon", "pedido", "revisao");
const outside = join(root, "fichas");
for (const dir of [join(revisao, "v1"), join(revisao, "v2"), join(outside, "v1"), join(bot, "v1"), join(root, "home")]) mkdirSync(dir, { recursive: true });
symlinkSync(outside, join(revisao, "escape"));

const shims = join(root, "shims");
mkdirSync(shims);
for (const program of ["rm", "rmdir", "unlink", "node", "ls", "cat", "python3", "curl", "touch", "mv", "cp", "find", "git", "sh"]) {
  // One write per call, so calls running side by side (a pipe, `&`) never mix their lines.
  writeFileSync(join(shims, program), `#!/bin/sh\nline="\${0##*/}\t$PWD"\nfor arg; do line="$line\t$arg"; done\nprintf '%s\\n' "$line" >> "$SHIM_LOG"\n`);
  chmodSync(join(shims, program), 0o755);
}
for (const wrapper of ["nohup", "timeout"]) {
  writeFileSync(join(shims, wrapper), `#!/bin/sh\n${wrapper === "timeout" ? "shift\n" : ""}exec "$@"\n`);
  chmodSync(join(shims, wrapper), 0o755);
}

const EXPORTER = "node ferramentas/exportar-figma/exportar-figma.js";
const policy: TeamLeadPolicy = {
  allow: [
    { label: "exportar a versão de revisão", command: `${EXPORTER} png * --modo revisao *` },
    { label: "listar", command: "ls *" },
    { label: "esperar", command: "timeout *" },
    { label: "trocar a versão de revisão antiga", deleteUnder: join(root, "bots", "*", "entregas", "*", "*", "revisao") },
  ],
  ask: [],
};
const files: LeadFiles = {
  realpath: (path) => { try { return realpathSync.native(path); } catch { return null; } },
  isSymlink: (path) => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } },
  exists: (path) => { try { lstatSync(path); return true; } catch { return false; } },
};

/** What the shell ran for this line: program, working folder and arguments of each call. */
async function run(command: string, log: string): Promise<Array<{ program: string; cwd: string; args: string[] }>> {
  writeFileSync(log, "");
  await new Promise((done) => execFile("/bin/bash", ["-c", `${command}\nwait`], { cwd: bot, env: { PATH: shims, HOME: join(root, "home"), SHIM_LOG: log }, timeout: 5_000 }, done));
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => {
    const [program, cwd, ...args] = line.split("\t");
    return { program: program!, cwd: cwd!, args };
  });
}

/** Strictly inside a review folder once the folder holding it is resolved, as `rm` would reach it. */
function insideReview(target: string, cwd: string): boolean {
  const path = resolve(cwd, target);
  let parent: string;
  try { parent = realpathSync(dirname(path)); } catch { return false; }
  const reached = target.endsWith("/") ? (() => { try { return realpathSync(path); } catch { return path; } })() : join(parent, path.slice(dirname(path).length + 1));
  return reached.startsWith(`${revisao}/`) && !reached.slice(revisao.length + 1).split("/").includes("..");
}

const variables = [`P=${revisao}`, `P=${outside}`, `PWD=${revisao}`, `EUID=${revisao}`, `OLDPWD=${revisao}`, `'P'=${revisao}`, `nohup P=${revisao}`, "Q=P", `$Q=${revisao}`];
const commands = [`${EXPORTER} png --arquivo x --modo revisao`, `ls ${revisao}`, `cd ${outside}`, `${EXPORTER} png --modo revisao #'`, `ls ${revisao}\\ #`, `ls ${revisao} #`, `ls ${revisao}\r#`, "'", "true"];
const deletes = [
  "rm -rf $P/v1", `rm -rf "$P"/v2`, "rm -rf '$P'/v1", "rm -rf \\$P/v1", "rm -rf ${P}/v1", "rm -rf $PWD/v1", "rm -rf $OLDPWD/v1",
  "rm -rf $EUID/v1", "rm -rf v1", `rm -rf ${revisao}/v1`, `rm -rf ${revisao}/escape`, `rm -rf ${revisao}/escape/`, `rm -rf ${revisao}/escape/v1`,
  `timeout 5 rm -rf ${outside}/v1`, `timeout 5 r\\\nm -rf ${outside}/v1`, `rm -rf ${revisao}/v1 -rf`, `timeout 5 rm -rf ${revisao}/v1`, `rm -rf ${revisao}/./v1`, `rm -rf ${revisao}/escape/.`,
];
const joiners = [" && ", "; ", " | ", " & ", " || ", "\n"];

function* lines(): Generator<string> {
  const heads = [...variables, ...commands];
  const any = [...heads, ...deletes, "python3 x.py"];
  for (const a of any) for (const j of joiners) for (const b of any) yield `${a}${j}${b}`;
  for (const a of heads) for (const j of joiners) for (const b of [...heads, "python3 x.py"]) for (const k of joiners) for (const c of [...deletes, "'"]) yield `${a}${j}${b}${k}${c}`;
}

it("whatever the rules allow, the real shell deletes only inside the review folder and runs only what the rules name", async () => {
  // Only a line holding a remove or the hidden program can reach past the rules; the others run nothing else.
  const allowed = [...lines()].filter((line) => /\brm |python3/.test(line) && leadDecision(policy, { tool: "Bash", command: line, files }).kind === "allow");
  const ran: Array<Awaited<ReturnType<typeof run>>> = [];
  let next = 0;
  await Promise.all(Array.from({ length: 16 }, async (_, worker) => {
    const log = join(root, `ran-${worker}.log`);
    while (next < allowed.length) {
      const index = next++;
      ran[index] = await run(allowed[index]!, log);
    }
  }));
  let deleted = 0;
  const escapes: string[] = [];
  for (const [index, line] of allowed.entries()) {
    for (const call of ran[index]!) {
      if (call.program === "rm") {
        // Options end at the first path, as the macOS rm reads them.
        const first = call.args.findIndex((arg) => !arg.startsWith("-") || arg === "--");
        const targets = first < 0 ? [] : call.args.slice(call.args[first] === "--" ? first + 1 : first);
        deleted += targets.length;
        for (const target of targets) if (!insideReview(target, call.cwd)) escapes.push(`${JSON.stringify(line)} → rm ${target} (in ${call.cwd})`);
      } else if (!(call.program === "ls" || (call.program === "node" && call.args[0] === "ferramentas/exportar-figma/exportar-figma.js"))) {
        escapes.push(`${JSON.stringify(line)} → ${call.program} ${call.args.join(" ")}`);
      }
    }
  }
  expect(escapes).toEqual([]);
  expect(allowed.length).toBeGreaterThan(100);
  expect(deleted).toBeGreaterThan(100);
}, 300_000);
