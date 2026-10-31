import { useState } from "react";
import { Blocks } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { brandIconSrc, brandSlugForHost } from "@/lib/brand-icons";
import { readCachedInventory, writeCachedInventory } from "@/lib/connected-apps-cache";
import type { ConnectorStatus } from "@/lib/connector-status";

// Kept apart from PluginsPanel so the bot panels and onboarding can use the icon and the inventory cache without
// pulling the whole Apps screen (and its MCP, keychain and browser panels) into the main bundle.

export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  noAuth?: boolean;
  domain: string | null;
  categories?: string[];
}

/** The last connected-apps inventory the app fetched, shared by the Apps screen and the bot panels. */
export const connectedAppsCache: { status: Record<string, ConnectorStatus> | null; at: number; authoritative: boolean } = { status: null, at: 0, authoritative: true };
let connectorStatusRequest: Promise<ConnectorInventory> | null = null;
const CONNECTOR_STATUS_CACHE_MS = 30_000;

export interface ConnectorInventory {
  services: Record<string, ConnectorStatus>;
  /** false when the server could not read the credential store: nothing may be cleared on the strength of it. */
  authoritative: boolean;
}

export function preloadConnectedApps(force = false): Promise<ConnectorInventory> {
  if (!force && connectedAppsCache.status !== null && Date.now() - connectedAppsCache.at < CONNECTOR_STATUS_CACHE_MS) {
    return Promise.resolve({
      services: connectedAppsCache.status,
      authoritative: connectedAppsCache.authoritative,
    });
  }
  if (connectorStatusRequest) return connectorStatusRequest;
  connectorStatusRequest = api("/api/connectors/connected")
    .then((response) => {
      const services: Record<string, ConnectorStatus> = response.services ?? {};
      if (response.credentialStore === "unavailable") {
        return { services: readCachedInventory()?.services ?? {}, authoritative: false };
      }
      connectedAppsCache.status = services;
      connectedAppsCache.at = Date.now();
      connectedAppsCache.authoritative = true;
      writeCachedInventory(services, Date.now());
      return { services, authoritative: true };
    })
    .catch(() => ({ services: readCachedInventory()?.services ?? {}, authoritative: false }))
    .finally(() => {
      connectorStatusRequest = null;
    });
  return connectorStatusRequest;
}


export function ServiceIcon({ card, className = "size-11" }: { card: Pick<ToolkitCard, "logo" | "domain" | "label"> & { slug?: string }; className?: string }) {
  const brand = brandIconSrc(card.slug) ?? (card.domain ? brandIconSrc(brandSlugForHost(card.domain)) : null);
  const [stage, setStage] = useState(brand ? -1 : card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === -1 && brand) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white", className)}>
        <img loading="lazy" decoding="async" src={brand} alt="" className="block h-[66%] w-[66%] min-w-0 object-contain" onError={() => setStage(card.logo ? 0 : card.domain ? 1 : 2)} />
      </span>
    );
  }
  if (stage === 0 && card.logo) {
    return (
      <img
        src={card.logo}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className={cn("flex items-center justify-center rounded-xl bg-raised text-ink-secondary", className)} title={card.label}>
      <Blocks size={18} aria-hidden="true" />
    </div>
  );
}

