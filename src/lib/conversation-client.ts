import { useEffect, useState } from "react";

import { api } from "@/state/store";

/** Nordus: a ZORG client as the server lists it, by its folder name under marcas/ and the name people know. */
export interface ClientChoice {
  slug: string;
  name: string;
}

// The client list changes with the skills, not during a session: asked once, then every room and chat reads it.
let cached: ClientChoice[] | null = null;
let request: Promise<ClientChoice[]> | null = null;

function parseClients(body: unknown): ClientChoice[] {
  const list = (body as { clients?: unknown } | null)?.clients;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is ClientChoice =>
    typeof entry?.slug === "string" && entry.slug !== "" && typeof entry?.name === "string");
}

/** The clients the server knows; empty for a member, or when it could not be asked (asked again next time). */
export function preloadClients(): Promise<ClientChoice[]> {
  if (cached) return Promise.resolve(cached);
  if (request) return request;
  request = api("/api/clients")
    .then((body) => (cached = parseClients(body)))
    .catch(() => [] as ClientChoice[])
    .finally(() => {
      request = null;
    });
  return request;
}

export function forgetClients(): void {
  cached = null;
  request = null;
}

export function useClients(): ClientChoice[] {
  const [clients, setClients] = useState<ClientChoice[]>(cached ?? []);
  useEffect(() => {
    let cancelled = false;
    void preloadClients().then((result) => {
      if (!cancelled) setClients(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return clients;
}

/** A client's name as people read it; a slug the list does not know reads in caps, as the server titles its rules. */
export function clientName(slug: string, clients: readonly ClientChoice[]): string {
  return clients.find((client) => client.slug === slug)?.name ?? slug.toUpperCase();
}

/** The room's own client wins over the ones its conversation named; a direct chat has only the conversation's. */
export function activeClientSlugs({ group, groupTask, task }: {
  group?: { client?: string | null };
  groupTask?: { clients?: string[] };
  task?: { clients?: string[] };
}): string[] {
  if (group) return group.client ? [group.client] : (groupTask?.clients ?? []).filter(Boolean);
  return (task?.clients ?? []).filter(Boolean);
}

/** The composer chip's text, or null when the conversation works for no client. */
export function activeClientLabel(scope: Parameters<typeof activeClientSlugs>[0], clients: readonly ClientChoice[]): string | null {
  const slugs = [...new Set(activeClientSlugs(scope))];
  return slugs.length ? `Cliente: ${slugs.map((slug) => clientName(slug, clients)).join(" + ")}` : null;
}

/** The room panel's choices: the listed clients, plus the room's own when the list does not have it. */
export function roomClientOptions(current: string | null | undefined, clients: readonly ClientChoice[]): ClientChoice[] {
  return current && !clients.some((client) => client.slug === current)
    ? [...clients, { slug: current, name: current.toUpperCase() }]
    : [...clients];
}
