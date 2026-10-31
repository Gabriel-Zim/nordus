import { describe, expect, it } from "vitest";

import { applySecretEnv, botEnvForBot, botEnvSummary, cleanEnvSecretValue, ENV_SECRET_TARGET, envSecretNameRefusal, isEnvSecretName, mergeBotEnvPatch, type BotEnvSection } from "../shared/env-secret.ts";
import { auditValues, configChangeRows } from "./admin-activity.ts";
import { PROVIDER_CREDENTIAL_ENV, WORKSPACE_CREDENTIAL_ENV } from "./config.ts";
import {
  buildEnvSecretRequest,
  envSecretCardConfigured,
  envSecretUpdateText,
  isPendingEnvSecretCard,
} from "./env-secret-requests.ts";

const VALUE = "cf-SEGREDO-9f8e7d6c5b4a3210";
const atlas = { id: "atlas", name: "Atlas", internal: true };
const client = { id: "cliente", name: "Robô do cliente", internal: false };

describe("env secret names", () => {
  it("accepts the variable a service's tool reads", () => {
    for (const name of ["CLOUDFLARE_API_TOKEN", "MERCADO_PAGO_ACCESS_TOKEN", "META_ACCESS_TOKEN", "PEXELS_API_KEY", "CLIENTE_X_TOKEN", "AB"]) {
      expect(envSecretNameRefusal(name), name).toBeUndefined();
    }
  });

  it("refuses malformed names", () => {
    for (const name of ["", "A", "lowercase_key", "1KEY", "_KEY", "KEY-NAME", "KEY NAME", "KEY=VALUE", `K${"A".repeat(64)}`, "CHAVE\n", "__proto__", 42, null, undefined, { toString: () => "PEXELS_API_KEY" }]) {
      expect(isEnvSecretName(name), String(name)).toBe(false);
    }
  });

  it("refuses names the system, the runtime and the engines read", () => {
    for (const name of ["PATH", "HOME", "SHELL", "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "BASH_ENV", "ENV",
      "PYTHONPATH", "HTTPS_PROXY", "GIT_SSH_COMMAND", "SSL_CERT_FILE", "CLAUDE_CONFIG_DIR", "NORDUS_COMMS_TOKEN", "NORDUS_CHATGPT_TOKEN",
      "ELECTRON_RUN_AS_NODE", "NPM_CONFIG_REGISTRY", "LC_ALL", "XDG_CONFIG_HOME", "CODEX_HOME"]) {
      expect(envSecretNameRefusal(name), name).toMatch(/reserved/);
    }
  });

  it("refuses every provider and workspace key the engine keeps for itself", () => {
    for (const name of [...PROVIDER_CREDENTIAL_ENV, ...WORKSPACE_CREDENTIAL_ENV]) {
      expect(isEnvSecretName(name), name).toBe(false);
    }
  });

  it("keeps a value to one clean line within the size limit", () => {
    expect(cleanEnvSecretValue(`  ${VALUE}\n`)).toBe(VALUE);
    expect(cleanEnvSecretValue("")).toBeNull();
    expect(cleanEnvSecretValue("   ")).toBeNull();
    expect(cleanEnvSecretValue("a\nb")).toBeNull();
    expect(cleanEnvSecretValue("a\u0000b")).toBeNull();
    expect(cleanEnvSecretValue("x".repeat(8_193))).toBeNull();
    expect(cleanEnvSecretValue(123)).toBeNull();
  });

  it("adds only valid names and clean values to an environment", () => {
    const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
    applySecretEnv(env, { PEXELS_API_KEY: VALUE, PATH: "/tmp/evil", LD_PRELOAD: "/tmp/x.so", BAD_VALUE: "a\nb" });
    expect(env).toEqual({ PATH: "/usr/bin", PEXELS_API_KEY: VALUE });
    applySecretEnv(env, undefined);
    expect(env).toEqual({ PATH: "/usr/bin", PEXELS_API_KEY: VALUE });
  });
});

describe("bot keys in the settings", () => {
  const merge = (current: BotEnvSection | undefined, patch: BotEnvSection) => {
    const merged = mergeBotEnvPatch(current, patch);
    if (!merged.ok) throw new Error(merged.error);
    return merged.section;
  };

  it("merges only the named keys; an empty value deletes one with its scope and purpose", () => {
    let section = merge(undefined, { env: { APIFY_TOKEN: ` ${VALUE} ` }, bots: { APIFY_TOKEN: ["atlas"] }, purposes: { APIFY_TOKEN: " Raspar  perfis " } });
    section = merge(section, { env: { PEXELS_API_KEY: "p" } });
    expect(section).toEqual({ env: { APIFY_TOKEN: VALUE, PEXELS_API_KEY: "p" }, bots: { APIFY_TOKEN: ["atlas"] }, purposes: { APIFY_TOKEN: "Raspar perfis" } });
    section = merge(section, { bots: { APIFY_TOKEN: [] } });
    expect(section.bots).toEqual({});
    section = merge(section, { env: { APIFY_TOKEN: "" } });
    expect(section).toEqual({ env: { PEXELS_API_KEY: "p" }, bots: {}, purposes: {} });
  });

  it("refuses a reserved name, a dirty value or a bad bot list without changing anything", () => {
    const patches: BotEnvSection[] = [{ env: { PATH: "x" } }, { env: { NODE_OPTIONS: "--require x" } }, { env: { LD_PRELOAD: "x" } }, { env: { APIFY_TOKEN: "a\nb" } }, { env: { APIFY_TOKEN: "x" }, bots: { APIFY_TOKEN: ["../x"] } }];
    for (const patch of patches) {
      expect(mergeBotEnvPatch({ env: { PEXELS_API_KEY: "p" } }, patch).ok, JSON.stringify(patch)).toBe(false);
    }
  });

  it("gives a limited key to those bots only, and any other key to internal bots only", () => {
    const section = merge(undefined, { env: { APIFY_TOKEN: "a", META_ACCESS_TOKEN: "m", CLIENTE_TOKEN: "c" }, bots: { APIFY_TOKEN: ["atlas"], CLIENTE_TOKEN: ["cliente"] } });
    expect(botEnvForBot(section, atlas)).toEqual({ APIFY_TOKEN: "a", META_ACCESS_TOKEN: "m" });
    expect(botEnvForBot(section, { id: "pixel", internal: true })).toEqual({ META_ACCESS_TOKEN: "m" });
    expect(botEnvForBot(section, client)).toEqual({ CLIENTE_TOKEN: "c" });
    // A hand-edited file with a reserved name never reaches a process.
    expect(botEnvForBot({ env: { PATH: "/tmp/evil", APIFY_TOKEN: "a" } }, atlas)).toEqual({ APIFY_TOKEN: "a" });
  });

  it("shows Settings names, purposes and who gets each key, never a value", () => {
    const section = merge(undefined, { env: { APIFY_TOKEN: VALUE }, bots: { APIFY_TOKEN: ["atlas"] }, purposes: { APIFY_TOKEN: "Raspar perfis" } });
    expect(botEnvSummary(section)).toEqual([{ name: "APIFY_TOKEN", purpose: "Raspar perfis", bots: ["atlas"] }]);
    expect(JSON.stringify(botEnvSummary(section))).not.toContain(VALUE);
  });

  it("keeps the value out of the settings activity log", () => {
    const rows = configChangeRows({}, { botEnv: { env: { CLOUDFLARE_ACCOUNT: VALUE } } });
    const logged = JSON.stringify(rows.map((row) => ({ ...row, before: auditValues(row.before as Record<string, unknown>), after: auditValues(row.after as Record<string, unknown>) })));
    expect(logged).toContain("botEnv.env.CLOUDFLARE_ACCOUNT");
    expect(logged).not.toContain(VALUE);
  });
});

describe("env secret requests", () => {
  let section: BotEnvSection = {};
  const vault = { has: (name: string, bot: { id: string; internal: boolean }) => Object.hasOwn(botEnvForBot(section, bot), name) };

  it("refuses an invalid or reserved name before any card exists", () => {
    expect(buildEnvSecretRequest(vault, atlas, { envName: "node_options" })).toMatchObject({ ok: false, status: 400 });
    expect(buildEnvSecretRequest(vault, atlas, { envName: "NODE_OPTIONS" })).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/reserved/) });
    expect(buildEnvSecretRequest(vault, atlas, { envName: "ANTHROPIC_API_KEY" })).toMatchObject({ ok: false, status: 400 });
    expect(buildEnvSecretRequest(vault, client, { envName: "PEXELS_API_KEY", scope: "shared" })).toMatchObject({ ok: false, status: 403 });
  });

  it("builds a card in Portuguese that names the key and carries no value", () => {
    const asked = buildEnvSecretRequest(vault, atlas, { envName: "CLOUDFLARE_API_TOKEN", purpose: "Publicar o site no Cloudflare." });
    expect(asked).toMatchObject({ ok: true, alreadyConfigured: false, name: "CLOUDFLARE_API_TOKEN" });
    if (!asked.ok || asked.alreadyConfigured) throw new Error("expected a card");
    expect(asked.secret).toMatchObject({ target: ENV_SECRET_TARGET, envName: "CLOUDFLARE_API_TOKEN", envScope: "bot", label: "CLOUDFLARE_API_TOKEN" });
    expect(asked.secret.description).toBe("Publicar o site no Cloudflare. Fica salva nas Configurações, só para Atlas. Ninguém lê a chave de volta, nem a conversa.");
    expect(asked.text).toContain("CLOUDFLARE_API_TOKEN");
    expect(`${asked.text} ${asked.secret.description} ${asked.secret.placeholder}`).not.toMatch(/—|servidor\.? *falta|falta no servidor/);
  });

  it("tells the bot a saved key is already there instead of asking again", () => {
    section = { env: { PEXELS_API_KEY: VALUE }, bots: { PEXELS_API_KEY: ["atlas"] } };
    expect(buildEnvSecretRequest(vault, atlas, { envName: "PEXELS_API_KEY" })).toEqual({ ok: true, alreadyConfigured: true, name: "PEXELS_API_KEY" });
    // The saved key failed a real call: a new card replaces it.
    expect(buildEnvSecretRequest(vault, atlas, { envName: "PEXELS_API_KEY", replace: true })).toMatchObject({ ok: true, alreadyConfigured: false });
    section = {};
    expect(buildEnvSecretRequest(vault, { ...atlas, id: "pixel" }, { envName: "PEXELS_API_KEY" })).toMatchObject({ alreadyConfigured: false });
  });

  it("is ready once the settings hold the key, and the resume note never carries the value", () => {
    const asked = buildEnvSecretRequest(vault, atlas, { envName: "PEXELS_API_KEY", purpose: "Buscar vídeos" });
    if (!asked.ok || asked.alreadyConfigured) throw new Error("expected a card");
    expect(asked.secret.envPurpose).toBe("Buscar vídeos");
    expect(envSecretCardConfigured(vault, asked.secret, atlas)).toBe(false);
    section = { env: { PEXELS_API_KEY: VALUE }, bots: { PEXELS_API_KEY: ["atlas"] } };
    expect(envSecretCardConfigured(vault, asked.secret, atlas)).toBe(true);
    section = {};
    const resumed = envSecretUpdateText("PEXELS_API_KEY", "provided");
    expect(resumed).toContain("$PEXELS_API_KEY");
    expect(resumed).toContain("never print");
    expect(resumed).toContain("Build the integration yourself");
    expect(resumed).toContain("one real call");
    expect(resumed).not.toContain(VALUE);
    expect(JSON.stringify(asked.secret)).not.toContain(VALUE);
    expect(envSecretUpdateText("PEXELS_API_KEY", "dismissed")).toContain("Never ask them to paste");
  });

  it("supersedes only an open card for the same key, and in a room only the asking bot's", () => {
    const card = { kind: "secret", secret: { target: ENV_SECRET_TARGET, envName: "PEXELS_API_KEY" }, from: { botId: "atlas" } } as const;
    expect(isPendingEnvSecretCard(card, "PEXELS_API_KEY", "atlas", true)).toBe(true);
    expect(isPendingEnvSecretCard(card, "META_ACCESS_TOKEN", "atlas", true)).toBe(false);
    expect(isPendingEnvSecretCard(card, "PEXELS_API_KEY", "pixel", true)).toBe(false);
    expect(isPendingEnvSecretCard(card, "PEXELS_API_KEY", "pixel", false)).toBe(true);
    expect(isPendingEnvSecretCard({ ...card, secret: { ...card.secret, provided: true } }, "PEXELS_API_KEY", "atlas", true)).toBe(false);
    expect(isPendingEnvSecretCard({ kind: "secret", secret: { target: "xaiApiKey" } }, "PEXELS_API_KEY", "atlas", false)).toBe(false);
  });
});
