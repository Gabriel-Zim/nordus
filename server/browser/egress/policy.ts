// What a bot's browser may connect to: every address a destination resolves to gets a class, and the host
// Nordus runs on decides which classes pass.
import { BlockList, isIP } from "node:net";
import { z } from "zod";

import { addressClass, ownAddresses, type AddressClass } from "../../../electron/egress-addresses.mjs";
import { parseHomeAddress } from "./home-link.ts";

export { addressClass, ownAddresses, type AddressClass };

/** `desktop`: the app on someone's computer. `server`: self-hosted (Docker, npm). `cloud`: a Nordus Cloud home. */
export type EgressHost = "desktop" | "server" | "cloud";

/** `home-network` and `port` come from the person's own computer when My Cloud's browsing goes out through it. */
export type Refusal = "nordus" | "this-computer" | "local-network" | "link-local" | "metadata" | "reserved" | "rebinding" | "reddit" | "home-network" | "port" | "home-away" | "exit-away";

/** How a refusal reads in the page-health line. */
export const REFUSAL_TEXT: Record<Refusal, string> = {
  nordus: "Nordus's own service",
  "this-computer": "a service on this computer that no bot started",
  "local-network": "the local network",
  "link-local": "a link-local address",
  metadata: "the cloud metadata service",
  reserved: "a reserved address",
  rebinding: "a web address that points at this computer",
  reddit: "Reddit",
  "home-network": "the person's own computer or home network",
  port: "a port other than 80 and 443, which the person's computer does not open for bots",
  "home-away": "a internet de casa, desligada agora",
  "exit-away": "a saída de internet deste robô, fora do ar agora",
};

const family = (address: string) => (isIP(address) === 6 ? "ipv6" : "ipv4");

/** An address literal, or a name RFC 6761 and Chrome resolve to loopback themselves. */
export function namesThisMachine(host: string): boolean {
  return isIP(host) !== 0 || /^(?:[^.]+\.)*localhost\.?$/i.test(host);
}

/** `browserEngine.egress` in config.json. */
export const browserEgressConfigSchema = z.object({
  /** Self-hosted servers only: local-network or this-computer destinations bots' browsers may reach, as
   * `10.0.0.5`, `192.168.1.0/24`, `10.0.0.5:8080`, `fd12::/48` or `[fd12::1]:443`. Nordus's own ports,
   * cloud metadata and link-local addresses stay closed. Nordus Cloud ignores it. */
  allow: z.array(z.string().trim().max(64).refine((entry) => parseAllowEntry(entry) !== null, {
    message: "must be an IP address or CIDR range, with an optional :port",
  })).max(64).optional(),
  /** Desktop only: false keeps bots' browsers off the local network (the default lets them reach it). */
  localNetwork: z.boolean().optional(),
  /** Nordus, servidor próprio: a internet de casa. `address` é o SOCKS5 do Mac no Tailscale (deploy/casa/socks-casa.mjs),
   * `sites` troca a lista padrão (home-sites.ts) e `whenAway` diz o que fazer com esses sites se o Mac sumir: "wait"
   * (padrão) não abre, "direct" abre pela internet do servidor. */
  home: z.object({
    address: z.string().trim().max(64).refine((value) => parseHomeAddress(value) !== null, {
      message: "must be this Mac's Tailscale address and port, like 100.64.0.20:1080",
    }),
    sites: z.array(z.string().trim().max(253)).max(200).optional(),
    whenAway: z.enum(["wait", "direct"]).optional(),
  }).optional(),
  /** Nordus, servidor próprio: as saídas dos sites sensíveis. `order` é a ordem de tentativa (padrão: casa, pool de proxy
   * residencial, direto); `bots` fixa o PROXY_n de cada robô (`{"<botId>": "PROXY_1"}`); `sites` troca a lista padrão
   * (a de `home.sites` vale quando esta falta). Os proxies vêm do arquivo de segredos (proxy-pool.ts), nunca daqui. */
  exits: z.object({
    order: z.array(z.enum(["proxy", "home", "direct"])).min(1).max(3).refine((order) => new Set(order).size === order.length, { message: "no repeated exit" }).optional(),
    bots: z.record(z.string().trim().min(1).max(96), z.string().regex(/^PROXY_\d{1,3}$/u)).optional(),
    sites: z.array(z.string().trim().max(253)).max(200).optional(),
  }).optional(),
});
export type BrowserEgressConfig = z.output<typeof browserEgressConfigSchema>;

interface AllowEntry { network: string; prefix: number; port: number | null }

export function parseAllowEntry(entry: string): AllowEntry | null {
  // A bare IPv6 address has colons of its own, so only its bracketed form takes a port.
  const match = /^\[([^\]]+)\](?:\/(\d{1,3}))?(?::(\d{1,5}))?$/.exec(entry)
    ?? (entry.split(":").length > 2 ? /^([^/]+)(?:\/(\d{1,3}))?()$/.exec(entry) : /^([^/:]+)(?:\/(\d{1,3}))?(?::(\d{1,5}))?$/.exec(entry));
  if (!match) return null;
  const [, network = "", prefixText, portText] = match;
  const kind = isIP(network);
  if (!kind) return null;
  const max = kind === 6 ? 128 : 32;
  const prefix = prefixText === undefined ? max : Number(prefixText);
  const port = portText ? Number(portText) : null;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65_535)) return null;
  return { network, prefix, port };
}

export function allowList(entries: readonly string[] | undefined): (address: string, port: number) => boolean {
  const rules = (entries ?? []).flatMap((entry) => {
    const parsed = parseAllowEntry(entry);
    if (!parsed) return [];
    const list = new BlockList();
    list.addSubnet(parsed.network, parsed.prefix, family(parsed.network));
    return [{ list, port: parsed.port }];
  });
  return (raw, port) => {
    const address = raw.split("%", 1)[0]!;
    return rules.some((rule) => (rule.port === null || rule.port === port) && rule.list.check(address, family(address)));
  };
}

export interface EgressRules {
  host: EgressHost;
  /** A port one of Nordus's own listeners holds on this machine. */
  ownPort(port: number): boolean;
  /** Whether every listener on this loopback port belongs to a bot's processes. */
  botPort(port: number): Promise<boolean>;
  /** Desktop: the person's local network. */
  localNetwork: boolean;
  /** Self-hosted servers: `browserEngine.egress.allow`. */
  allowed(address: string, port: number): boolean;
}

/**
 * Why a connection to `host:port`, resolved to `addresses`, is refused, or null when it may go ahead.
 * Every address must pass: the gate connects only to addresses checked here.
 */
export async function refusalFor(
  target: { host: string; port: number },
  addresses: readonly { address: string }[],
  rules: EgressRules,
  own: BlockList = ownAddresses(),
): Promise<Refusal | null> {
  const { host, port } = target;
  for (const { address } of addresses) {
    const kind = addressClass(address, own);
    if (kind === "public") continue;
    if (kind === "metadata" || kind === "link-local" || kind === "reserved") return kind;
    if (kind === "private") {
      const open = rules.host === "desktop" ? rules.localNetwork : rules.host === "server" && rules.allowed(address, port);
      if (open) continue;
      return "local-network";
    }
    if (rules.ownPort(port)) return "nordus";
    // Desktop dev servers are reached by name or address, never through a public name that points here.
    if (rules.host === "desktop") {
      if (namesThisMachine(host)) continue;
      return "rebinding";
    }
    if (rules.host === "server" && rules.allowed(address, port)) continue;
    if (await rules.botPort(port)) continue;
    return "this-computer";
  }
  return null;
}
