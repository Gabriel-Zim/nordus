import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.ts";
import { claudeUserSkillsDir, clientSkillsDir, settingsTurnFields } from "./turn-settings.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "nordus-turn-settings-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the person's own Claude Code skills", () => {
  it("links the whole folder, so a skill's scripts and later edits come along", () => {
    const home = temp(), data = temp();
    mkdirSync(join(home, ".claude", "skills", "deploy", "scripts"), { recursive: true });
    writeFileSync(join(home, ".claude", "skills", "deploy", "SKILL.md"), "v1");
    const root = claudeUserSkillsDir(data, home)!;
    expect(root).toBe(join(data, "claude-user-skills"));

    writeFileSync(join(home, ".claude", "skills", "deploy", "SKILL.md"), "v2");
    writeFileSync(join(home, ".claude", "skills", "deploy", "scripts", "run.sh"), "echo");
    expect(readFileSync(join(root, ".claude", "skills", "deploy", "SKILL.md"), "utf8")).toBe("v2");
    expect(existsSync(join(root, ".claude", "skills", "deploy", "scripts", "run.sh"))).toBe(true);
    expect(claudeUserSkillsDir(data, home)).toBe(root);
  });

  it("has nothing to add without a skills folder", () => {
    expect(claudeUserSkillsDir(temp(), temp())).toBeNull();
  });

  it("follows the skills folder when it is somewhere else now", () => {
    const data = temp(), first = temp(), second = temp();
    for (const home of [first, second]) mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    claudeUserSkillsDir(data, first);
    const root = claudeUserSkillsDir(data, second)!;
    expect(resolve(readlinkSync(join(root, ".claude", "skills")))).toBe(resolve(join(second, ".claude", "skills")));
  });
});

const internal = { restrictsMcp: false, internal: true, scopesTools: false };

describe("the skills a client's bot sees", () => {
  const brandSkills = (home: string) => {
    const skills = join(home, ".claude", "skills");
    for (const brand of ["evergreen", "fabrikam", "lumon"]) {
      mkdirSync(join(skills, "design-premium", "marcas", brand), { recursive: true });
      writeFileSync(join(skills, "design-premium", "marcas", brand, "cores.md"), brand);
      mkdirSync(join(skills, "synced", "id-1", "gerentedeoperacao-designer", "marcas", brand), { recursive: true });
    }
    writeFileSync(join(skills, "design-premium", "SKILL.md"), "v1");
    mkdirSync(join(skills, "caixa-de-email"), { recursive: true });
    writeFileSync(join(skills, "caixa-de-email", "SKILL.md"), "mail");
    return skills;
  };
  const listing = (dir: string) => readdirSync(dir).sort();

  it("keeps every skill and only the client's own brand, however deep the brands folder sits", () => {
    const data = temp(), home = temp();
    const skills = brandSkills(home);
    const view = join(clientSkillsDir(data, "evergreen", home)!, ".claude", "skills");
    expect(listing(view)).toEqual(["caixa-de-email", "design-premium", "synced"]);
    expect(listing(join(view, "design-premium", "marcas"))).toEqual(["evergreen"]);
    expect(listing(join(view, "synced", "id-1", "gerentedeoperacao-designer", "marcas"))).toEqual(["evergreen"]);
    expect(readFileSync(join(view, "design-premium", "marcas", "evergreen", "cores.md"), "utf8")).toBe("evergreen");
    expect(readFileSync(join(view, "caixa-de-email", "SKILL.md"), "utf8")).toBe("mail");
    writeFileSync(join(skills, "design-premium", "SKILL.md"), "v2");
    expect(readFileSync(join(view, "design-premium", "SKILL.md"), "utf8")).toBe("v2");
  });

  it("shows no brand to a client's bot without a client, or with a name that is not a folder name", () => {
    const data = temp(), home = temp();
    brandSkills(home);
    for (const client of [undefined, "../fabrikam"]) {
      const view = join(clientSkillsDir(data, client, home)!, ".claude", "skills");
      expect(listing(join(view, "design-premium", "marcas"))).toEqual([]);
      expect(listing(view)).toContain("caixa-de-email");
    }
  });

  it("follows skills added and removed since the last turn, and never touches the person's own files", () => {
    const data = temp(), home = temp();
    const skills = brandSkills(home);
    clientSkillsDir(data, "fabrikam", home);
    mkdirSync(join(skills, "nova"), { recursive: true });
    rmSync(join(skills, "caixa-de-email"), { recursive: true });
    mkdirSync(join(skills, "design-premium", "marcas", "nova-marca"), { recursive: true });
    const view = join(clientSkillsDir(data, "fabrikam", home)!, ".claude", "skills");
    expect(listing(view)).toEqual(["design-premium", "nova", "synced"]);
    expect(listing(join(view, "design-premium", "marcas"))).toEqual(["fabrikam"]);
    expect(listing(join(skills, "design-premium", "marcas"))).toEqual(["evergreen", "fabrikam", "lumon", "nova-marca"]);
  });
});

describe("turn fields from Settings", () => {
  it("never gives a client's bot this machine's Claude Code MCP servers, and gives it the skills without other brands", () => {
    const data = temp(), home = temp();
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const both = { features: { claudeUserMcp: true, claudeUserSkills: true } } as AppConfig;
    const clientTurn = settingsTurnFields(both, data, { restrictsMcp: false, internal: false, scopesTools: false, client: "evergreen" }, home);
    expect(clientTurn.mcpFromUserConfig).toBe(false);
    expect(clientTurn.userSkillsDir).toBe(join(data, "claude-client-skills", "evergreen"));
    const internalTurn = settingsTurnFields(both, data, internal, home);
    expect(internalTurn.mcpFromUserConfig).toBe(true);
    expect(internalTurn.userSkillsDir).toBe(join(data, "claude-user-skills"));
  });

  it("adds the skills folder only when its switch is on", () => {
    const data = temp(), home = temp();
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    expect(settingsTurnFields({} as AppConfig, data, internal, home)).not.toHaveProperty("userSkillsDir");
    expect(settingsTurnFields({ features: { claudeUserSkills: true } } as AppConfig, data, internal, home).userSkillsDir).toBe(join(data, "claude-user-skills"));
  });

  it("takes the link away once the switch is off, never what it points to", () => {
    const data = temp(), home = temp();
    mkdirSync(join(home, ".claude", "skills", "deploy"), { recursive: true });
    writeFileSync(join(home, ".claude", "skills", "deploy", "SKILL.md"), "mine");
    settingsTurnFields({ features: { claudeUserSkills: true } } as AppConfig, data, internal, home);
    expect(existsSync(join(data, "claude-user-skills", ".claude", "skills"))).toBe(true);
    settingsTurnFields({} as AppConfig, data, internal, home);
    expect(existsSync(join(data, "claude-user-skills"))).toBe(false);
    expect(readFileSync(join(home, ".claude", "skills", "deploy", "SKILL.md"), "utf8")).toBe("mine");
  });

  it("keeps the MCP switch its own, and an organization's MCP limit wins", () => {
    const on = { features: { claudeUserMcp: true } } as AppConfig;
    expect(settingsTurnFields(on, temp(), internal, temp()).mcpFromUserConfig).toBe(true);
    expect(settingsTurnFields(on, temp(), { restrictsMcp: true, internal: true, scopesTools: false }, temp()).mcpFromUserConfig).toBe(false);
    expect(settingsTurnFields(on, temp(), internal, temp())).not.toHaveProperty("userSkillsDir");
  });

  it("keeps this machine's MCP servers from an internal bot whose tool selection is closed", () => {
    const on = { features: { claudeUserMcp: true } } as AppConfig;
    expect(settingsTurnFields(on, temp(), { ...internal, scopesTools: true }, temp()).mcpFromUserConfig).toBe(false);
    expect(settingsTurnFields(on, temp(), internal, temp()).mcpFromUserConfig).toBe(true);
  });
});

describe("native mode", () => {
  it("gives an internal bot the person's skills whatever the switch says, and marks the turn native", () => {
    const data = temp(), home = temp();
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const turn = settingsTurnFields({} as AppConfig, data, { ...internal, nativeMode: true }, home);
    expect(turn.userSkillsDir).toBe(join(data, "claude-user-skills"));
    expect(turn.nativeMode).toBe(true);
    expect(settingsTurnFields({} as AppConfig, data, internal, home)).not.toHaveProperty("nativeMode");
  });

  it("never runs a client's bot native", () => {
    const data = temp(), home = temp();
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const turn = settingsTurnFields({} as AppConfig, data, { restrictsMcp: false, internal: false, scopesTools: false, client: "evergreen", nativeMode: true }, home);
    expect(turn).not.toHaveProperty("nativeMode");
    expect(turn).not.toHaveProperty("userSkillsDir");
  });
});
