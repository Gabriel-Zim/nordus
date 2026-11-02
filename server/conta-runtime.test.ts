import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readContaLink, type ContaLink } from "./conta-nordus.ts";
import { createContaRuntime } from "./conta-runtime.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const LINK: ContaLink = {
  installationId: "0b7f6c2e-6a43-4c1e-9d55-3f6f1c2b9a10",
  credential: `nordus_install_${"a".repeat(22)}.${"b".repeat(43)}`,
  address: "https://loja-da-ana.nordus.ai",
  email: "ana@example.com",
  controlPlane: "https://conta.nordus.ai",
};

describe("the Nordus account inside a running server", () => {
  it("shows the code while the person confirms, then saves the link and hands it to the server", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nordus-conta-runtime-"));
    dirs.push(dataDir);
    let confirm: (link: ContaLink) => void = () => {};
    const linked = vi.fn();
    const runtime = createContaRuntime({
      dataDir,
      version: "test",
      externalTunnel: true,
      listen: async () => async () => {},
      linked,
      unlinked: () => {},
      log: () => {},
      connectImpl: async (input) => {
        input.onCode({ deviceCode: "d".repeat(43), userCode: "BCDF-GHJK", verificationUrl: "https://conta.nordus.ai/ativar?codigo=BCDF-GHJK", intervalSeconds: 3, expiresInSeconds: 1800 }, 1);
        return new Promise<ContaLink>((resolve) => { confirm = resolve; });
      },
    });
    expect(runtime.status()).toEqual({ state: "off" });
    runtime.connect();
    expect(runtime.status()).toMatchObject({ state: "waiting", code: "BCDF-GHJK", url: "https://conta.nordus.ai/ativar?codigo=BCDF-GHJK" });
    runtime.connect();
    confirm(LINK);
    await vi.waitFor(() => expect(runtime.status().state).toBe("live"));
    expect(runtime.status()).toEqual({ state: "live", address: LINK.address, email: LINK.email, managedBy: "serve" });
    expect(linked).toHaveBeenCalledTimes(1);
    expect(readContaLink(dataDir)).toEqual(LINK);
  });

  it("reports a failed confirmation and can try again", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nordus-conta-runtime-"));
    dirs.push(dataDir);
    const runtime = createContaRuntime({
      dataDir, version: "test", externalTunnel: true, listen: async () => async () => {}, linked: () => {}, unlinked: () => {}, log: () => {},
      connectImpl: async () => { throw new Error("the code expired before it was confirmed"); },
    });
    runtime.connect();
    await vi.waitFor(() => expect(runtime.status()).toEqual({ state: "error", error: "the code expired before it was confirmed" }));
    expect(readContaLink(dataDir)).toBeNull();
  });
});
