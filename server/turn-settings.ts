import { lstatSync, mkdirSync, readdirSync, readlinkSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { claudeUserMcpEnabled, mcpCallTimeoutMinutes, type AppConfig } from "./config.ts";
import { correctiveRounds } from "./host/loop-guard.ts";
import { CLIENT_SLUG } from "../shared/wire.ts";

export function claudeUserSkillsEnabled(cfg: AppConfig): boolean {
  return cfg.features?.claudeUserSkills === true;
}

/** A folder whose `.claude/skills` links to the person's own `~/.claude/skills`, for Claude Code's `--add-dir`: each skill
 * loads as it is on disk, scripts and references included, and edits arrive live. Null when there is nothing to link. */
export function claudeUserSkillsDir(dataDir: string, home = homedir()): string | null {
  const source = join(home, ".claude", "skills");
  try {
    if (!statSync(source).isDirectory()) return null;
  } catch {
    return null;
  }
  const root = join(dataDir, "claude-user-skills");
  const link = join(root, ".claude", "skills");
  try {
    if (resolve(readlinkSync(link)) === resolve(source)) return root;
  } catch {}
  try {
    mkdirSync(join(root, ".claude"), { recursive: true, mode: 0o700 });
    try {
      if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
    } catch {}
    symlinkSync(source, link, process.platform === "win32" ? "junction" : "dir");
    return root;
  } catch {
    return null;
  }
}

/** The link and its folders, once the switch is off; only the link itself, never what it points to. */
export function forgetClaudeUserSkillsDir(dataDir: string): void {
  const root = join(dataDir, "claude-user-skills");
  const link = join(root, ".claude", "skills");
  try {
    if (lstatSync(link).isSymbolicLink()) {
      try {
        unlinkSync(link);
      } catch {
        // A Windows junction is removed as a folder.
        rmdirSync(link);
      }
    }
  } catch {}
  for (const folder of [join(root, ".claude"), root]) {
    try {
      rmdirSync(folder);
    } catch {}
  }
}

/** A skill keeps each client's brand material in `marcas/<client>`. */
const BRANDS = "marcas";
/** How deep under the skills folder a `marcas` folder is looked for (skills/<skill>/marcas, synced/<id>/<skill>/marcas). */
const BRANDS_DEPTH = 3;
const linkType = (dir: boolean) => process.platform === "win32" ? (dir ? "junction" : "file") : (dir ? "dir" : "file");

/** The person's own skills as a client's bot may see them: the same skills, linked in place, except that every
 * `marcas` folder keeps only that client's own brand. A bot with no client gets no brand at all. Rebuilt on each
 * turn, so a skill added or removed shows up at the next one. Null when there is nothing to show. */
export function clientSkillsDir(dataDir: string, client: string | undefined, home = homedir()): string | null {
  const source = join(home, ".claude", "skills");
  try {
    if (!statSync(source).isDirectory()) return null;
  } catch {
    return null;
  }
  const brand = client && CLIENT_SLUG.test(client) ? client : undefined;
  const root = join(dataDir, "claude-client-skills", brand ?? "_sem-marca");
  try {
    mirror(source, join(root, ".claude", "skills"), brand, BRANDS_DEPTH);
    return root;
  } catch {
    return null;
  }
}

function isDir(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function holdsBrands(dir: string, depth: number): boolean {
  if (depth <= 0) return false;
  return readdirSync(dir).some((name) => isDir(join(dir, name)) && (name === BRANDS || holdsBrands(join(dir, name), depth - 1)));
}

function realDir(path: string): void {
  try { if (lstatSync(path).isSymbolicLink()) unlinkSync(path); } catch {}
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

/** Removes a link without following it (rmSync skips a link whose target is gone), or a folder this view built. */
function remove(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
    else rmSync(path, { recursive: true, force: true });
  } catch {}
}

function linkTo(target: string, path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink() && resolve(readlinkSync(path)) === resolve(target)) return;
  } catch {}
  remove(path);
  try {
    symlinkSync(target, path, linkType(isDir(target)));
  } catch (error) {
    // Another turn of the same client built it a moment ago.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function prune(dir: string, keep: ReadonlySet<string>): void {
  for (const name of readdirSync(dir)) if (!keep.has(name)) remove(join(dir, name));
}

function mirror(source: string, target: string, brand: string | undefined, depth: number): void {
  realDir(target);
  const keep = new Set<string>();
  for (const name of readdirSync(source)) {
    const from = join(source, name), to = join(target, name);
    keep.add(name);
    if (name === BRANDS && isDir(from)) {
      realDir(to);
      const own = brand !== undefined && isDir(join(from, brand));
      if (own) linkTo(join(from, brand!), join(to, brand!));
      prune(to, new Set(own ? [brand!] : []));
    } else if (isDir(from) && holdsBrands(from, depth)) {
      mirror(from, to, brand, depth - 1);
    } else {
      linkTo(from, to);
    }
  }
  prune(target, keep);
}

/** The fields of an engine turn that come from Settings. This machine's own Claude Code MCP servers reach internal bots
 * only, whatever the switches say, and never a bot with a tool selection, which they would reach past. Its skills reach
 * every bot, a client's bot seeing only its own client's brand. An internal bot in native mode gets the person's skills
 * whatever the switch says, as their own terminal would; a client's bot never runs native. */
export function settingsTurnFields(cfg: AppConfig, dataDir: string, bot: { restrictsMcp: boolean; internal: boolean; scopesTools: boolean; client?: string; nativeMode?: boolean }, home = homedir()): {
  mcpFromUserConfig: boolean;
  userSkillsDir?: string;
  nativeMode?: true;
  mcpCallTimeoutMs: number;
  toolErrorCorrectiveRounds: number;
} {
  const native = bot.nativeMode === true && bot.internal;
  const userSkillsDir = native ? claudeUserSkillsDir(dataDir, home)
    : !claudeUserSkillsEnabled(cfg) ? null
      : bot.internal ? claudeUserSkillsDir(dataDir, home) : clientSkillsDir(dataDir, bot.client, home);
  if (!userSkillsDir && !claudeUserSkillsEnabled(cfg)) forgetClaudeUserSkillsDir(dataDir);
  return {
    mcpFromUserConfig: bot.internal && claudeUserMcpEnabled(cfg) && !bot.restrictsMcp && !bot.scopesTools,
    ...(userSkillsDir ? { userSkillsDir } : {}),
    ...(native ? { nativeMode: true as const } : {}),
    mcpCallTimeoutMs: mcpCallTimeoutMinutes(cfg) * 60_000,
    toolErrorCorrectiveRounds: correctiveRounds(cfg),
  };
}
