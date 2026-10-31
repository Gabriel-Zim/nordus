import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR, loadConfig, saveConfig } from "./config.ts";

const path = join(DATA_DIR, "config.json");
const written = () => JSON.parse(readFileSync(path, "utf8")) as { signIn?: { admins?: string[]; members?: string[]; guests?: string[] } };
const GUEST_ENV = "NORDUS_SIGNIN_GUEST_EMAILS";
let before: string | undefined;

beforeEach(() => {
  before = process.env[GUEST_ENV];
  delete process.env[GUEST_ENV];
  mkdirSync(DATA_DIR, { recursive: true });
  rmSync(path, { force: true });
});
afterEach(() => {
  if (before === undefined) delete process.env[GUEST_ENV]; else process.env[GUEST_ENV] = before;
  rmSync(path, { force: true });
});

describe("guests on the sign-in list", () => {
  it("reads them from config.json beside the admins and members", () => {
    writeFileSync(path, JSON.stringify({ signIn: { admins: ["boss@x.test"], members: ["ana@x.test"], guests: ["gus@x.test"] } }));
    const when = new Date(Date.now() - 60_000);
    utimesSync(path, when, when);
    expect(loadConfig().signIn).toEqual({ admins: ["boss@x.test"], members: ["ana@x.test"], guests: ["gus@x.test"] });
  });

  it("takes them from the environment like the others, lowercased", () => {
    process.env[GUEST_ENV] = " Gus@X.test, @Clients.test\nother@x.test ";
    expect(loadConfig().signIn?.guests).toEqual(["gus@x.test", "@clients.test", "other@x.test"]);
  });

  it("keeps the saved guests when a save names only admins and members", () => {
    saveConfig({ signIn: { admins: ["boss@x.test"], members: ["ana@x.test"], guests: ["gus@x.test"] } });
    saveConfig({ signIn: { admins: ["boss@x.test"], members: ["ana@x.test", "bob@x.test"] } });
    expect(written().signIn).toEqual({ admins: ["boss@x.test"], members: ["ana@x.test", "bob@x.test"], guests: ["gus@x.test"] });
  });

  it("clears them only when the save says so", () => {
    saveConfig({ signIn: { admins: ["boss@x.test"], members: [], guests: ["gus@x.test"] } });
    saveConfig({ signIn: { admins: ["boss@x.test"], members: [], guests: [] } });
    expect(written().signIn?.guests).toEqual([]);
  });

  it("does not invent a guests list for a workspace that never had one", () => {
    saveConfig({ signIn: { admins: ["boss@x.test"], members: ["ana@x.test"] } });
    expect(written().signIn).toEqual({ admins: ["boss@x.test"], members: ["ana@x.test"] });
  });
});
