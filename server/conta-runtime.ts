// The Nordus account from inside a running server: Settings connects it (the desktop app has no terminal) and, when
// `serve --tunnel` is not already serving the address, the server runs the tunnel itself.
import { hostname } from "node:os";

import {
  connectAccount,
  contaOrigin,
  contaTunnelAccess,
  readContaLink,
  releaseContaAddress,
  removeContaLink,
  saveContaLink,
  type ContaLink,
} from "./conta-nordus.ts";
import {
  cleanupTunnelOrigin,
  createTunnelOrigin,
  ensureCloudflared,
  guardianEntry,
  platformName,
  startTunnel,
  type ManagedTunnelState,
  type RunningTunnel,
} from "./tunnel.ts";

export type ContaStatus =
  | { state: "off" }
  | { state: "waiting"; url: string; code: string; expiresAt: number }
  | { state: "starting"; address: string; email: string | null }
  | { state: "live"; address: string; email: string | null; managedBy: "server" | "serve" }
  | { state: "error"; error: string; address?: string; email?: string | null };

export interface ContaRuntime {
  status(): ContaStatus;
  boot(): void;
  connect(): ContaStatus;
  disconnect(): Promise<ContaStatus>;
  stop(): Promise<void>;
}

export function createContaRuntime(deps: {
  dataDir: string;
  version: string;
  /** NORDUS_TUNNEL_SOCKET: `serve --tunnel` already serves the address from outside this process. */
  externalTunnel: boolean;
  /** Serves the server's requests on the tunnel's socket; returns how to close it. */
  listen: (socketPath: string) => Promise<() => Promise<void>>;
  /** The link is saved: the Google sign-in goes through the account and its owner gets full access. */
  linked: (link: ContaLink) => void;
  unlinked: () => void;
  log?: (line: string) => void;
  connectImpl?: typeof connectAccount;
}): ContaRuntime {
  const log = deps.log ?? ((line: string) => console.log(`conta: ${line}`));
  let current: ContaStatus = { state: "off" };
  let tunnel: RunningTunnel | null = null;
  let closeListener: (() => Promise<void>) | null = null;
  let origin: ReturnType<typeof createTunnelOrigin> | null = null;
  let connecting = false;

  const readLink = (): ContaLink | null => {
    try {
      return readContaLink(deps.dataDir);
    } catch (error) {
      current = { state: "error", error: error instanceof Error ? error.message : String(error) };
      return null;
    }
  };

  const onTunnel = (link: ContaLink) => (state: ManagedTunnelState) => {
    if (state.status === "ready") current = { state: "live", address: link.address, email: link.email, managedBy: "server" };
    else if (state.status === "starting" || state.status === "retrying") current = { state: "starting", address: link.address, email: link.email };
    else if (state.status !== "stopped") current = { state: "error", error: state.error ?? "the tunnel stopped", address: link.address, email: link.email };
  };

  async function bringDown(): Promise<void> {
    const running = tunnel;
    tunnel = null;
    await running?.stop().catch(() => undefined);
    await closeListener?.().catch(() => undefined);
    closeListener = null;
    if (origin) cleanupTunnelOrigin(origin);
    origin = null;
  }

  async function bringUp(link: ContaLink): Promise<void> {
    if (deps.externalTunnel) {
      current = { state: "live", address: link.address, email: link.email, managedBy: "serve" };
      return;
    }
    current = { state: "starting", address: link.address, email: link.email };
    try {
      const access = await contaTunnelAccess(link, { version: deps.version });
      const binary = await ensureCloudflared({ dataDir: deps.dataDir, log });
      const guardian = guardianEntry();
      if (!guardian) throw new Error("the tunnel guardian is missing from this install");
      await bringDown();
      origin = createTunnelOrigin();
      closeListener = await deps.listen(origin.socketPath);
      tunnel = startTunnel({ dataDir: deps.dataDir, access, originTarget: { pid: process.pid, socketPath: origin.socketPath }, binaryPath: binary, guardian, onState: onTunnel(link) });
      log(`serving ${link.address}`);
    } catch (error) {
      await bringDown();
      current = { state: "error", error: error instanceof Error ? error.message : String(error), address: link.address, email: link.email };
      log(`could not serve ${link.address}: ${current.error}`);
    }
  }

  return {
    status: () => current,
    boot() {
      const link = readLink();
      if (link) void bringUp(link);
    },
    connect() {
      if (connecting) return current;
      const existing = readLink();
      if (existing) {
        if (current.state === "off" || current.state === "error") void bringUp(existing);
        return current;
      }
      connecting = true;
      void (deps.connectImpl ?? connectAccount)({
        origin: contaOrigin(),
        machine: hostname(),
        platform: platformName(),
        appVersion: deps.version,
        onCode: (activation) => {
          current = { state: "waiting", url: activation.verificationUrl, code: activation.userCode, expiresAt: Date.now() + activation.expiresInSeconds * 1000 };
        },
      }).then(async (link) => {
        saveContaLink(deps.dataDir, link);
        deps.linked(link);
        await bringUp(link);
      }).catch((error: unknown) => {
        current = { state: "error", error: error instanceof Error ? error.message : String(error) };
      }).finally(() => {
        connecting = false;
      });
      return current;
    },
    async disconnect() {
      const link = readLink();
      await bringDown();
      if (link) {
        await releaseContaAddress(link).catch((error: unknown) => log(`could not release ${link.address}: ${error instanceof Error ? error.message : String(error)}`));
        removeContaLink(deps.dataDir);
        deps.unlinked();
      }
      current = { state: "off" };
      return current;
    },
    stop: bringDown,
  };
}
