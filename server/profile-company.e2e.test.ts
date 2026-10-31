import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-nordus.ts";

type ProfileReply = { profile: { name: string; aboutMe: string; company?: string } };

it("keeps the company name beside the rest of the profile and reports it back", async () => {
  const fixture = await launchVerificationServer();
  const api = async (path: string, method = "GET", body?: unknown, status = 200): Promise<ProfileReply> => {
    const response = await fetch(fixture.info.url + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(status);
    return response.json() as Promise<ProfileReply>;
  };
  const stored = () => JSON.parse(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8")).profile;
  try {
    await api("/api/config", "PUT", { profile: { name: "Fixture user", aboutMe: "Short answers." } });
    expect((await api("/api/config")).profile.company).toBeUndefined();

    const saved = await api("/api/config", "PUT", { profile: { company: "  Alves Studio " } });
    expect(saved.profile).toMatchObject({ name: "Fixture user", aboutMe: "Short answers.", company: "Alves Studio" });
    expect((await api("/api/config")).profile.company).toBe("Alves Studio");
    expect(stored().company).toBe("Alves Studio");

    await api("/api/config", "PUT", { profile: { name: "Renamed fixture" } });
    expect((await api("/api/config")).profile).toMatchObject({ name: "Renamed fixture", company: "Alves Studio" });

    await api("/api/config", "PUT", { profile: { company: "x".repeat(121) } }, 400);
    expect((await api("/api/config")).profile.company).toBe("Alves Studio");

    await api("/api/config", "PUT", { profile: { company: "" } });
    expect((await api("/api/config")).profile.company).toBeUndefined();
  } finally {
    await fixture.close();
  }
}, 60_000);
