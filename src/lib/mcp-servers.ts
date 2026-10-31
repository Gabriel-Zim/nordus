import { useEffect, useSyncExternalStore } from "react";

import { api } from "@/state/store";
import { botMcpServerNames } from "../../shared/bot-mcp-servers";

export interface McpServerSummary {
  name: string;
  enabled: boolean;
  explicit?: boolean;
}

let cached: { servers: McpServerSummary[] | null; error: boolean } = { servers: null, error: false };
let inflight: Promise<McpServerSummary[]> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const snapshot = () => cached;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function updateMcpServers(servers: McpServerSummary[]): void {
  generation += 1;
  inflight = null;
  cached = { servers: servers.map(({ name, enabled, explicit }) => ({ name, enabled: Boolean(enabled), ...(explicit ? { explicit: true } : {}) })), error: false };
  for (const listener of listeners) listener();
}

export function loadMcpServers(force = false): Promise<McpServerSummary[]> {
  if (!force && cached.servers && !cached.error) return Promise.resolve(cached.servers);
  if (!force && inflight) return inflight;
  const requestGeneration = ++generation;
  inflight = api("/api/mcp/servers")
    .then((result) => {
      if (requestGeneration === generation) updateMcpServers(result.servers ?? []);
      return cached.servers ?? [];
    })
    .catch(() => {
      if (requestGeneration === generation) {
        cached = { ...cached, error: true };
        for (const listener of listeners) listener();
      }
      return cached.servers ?? [];
    })
    .finally(() => {
      if (requestGeneration === generation) inflight = null;
    });
  return inflight;
}

export function useMcpServers(): { servers: McpServerSummary[] | null; error: boolean; refresh: () => Promise<McpServerSummary[]> } {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void loadMcpServers(true);
  }, []);
  return { ...current, refresh: () => loadMcpServers(true) };
}

export function mcpServersForBot(all: McpServerSummary[], own: string[] | null | undefined, internal: boolean): McpServerSummary[] {
  const enabled = all.filter((server) => server.enabled);
  const names = botMcpServerNames(own, internal);
  return names ? enabled.filter((server) => names.includes(server.name)) : enabled.filter((server) => !server.explicit);
}

/** The list a bot saves after one server is turned on or off. A bot without a list gets one, so a server added later
 * never silently reaches it. */
export function toggledMcpServers(all: McpServerSummary[], own: string[] | null | undefined, internal: boolean, name: string): string[] {
  const current = botMcpServerNames(own, internal) ?? all.filter((server) => server.enabled && !server.explicit).map((server) => server.name);
  return current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
}
