// Nordus's own listening ports, which no bot's browser may reach, and one egress gate per running browser.
import { subscribe } from "node:diagnostics_channel";
import type { Server } from "node:net";

import { agentBrowserDevToolsPorts, agentBrowserStreamPorts } from "../../browser-engine.ts";
import { sanitizePageText } from "../../browser-page-health.ts";
import { FLEET_FIRST_PORT, FLEET_PORT_STRIDE } from "../../fleet.ts";
import { botEngineSessions } from "../../procs.ts";
import { openGate, resolveTarget, type EgressGate, type GateTarget, type GateUpstream, type ResolvedAddress } from "./gate.ts";
import { createHomeLink, HOME_AWAY_NOTICE, HOME_DIRECT_NOTICE, parseHomeAddress, type HomeAddress, type HomeLink } from "./home-link.ts";
import { DEFAULT_EXIT_ORDER, ExitRouter, ExitStore, type ExitKind } from "./exit-router.ts";
import { homeSiteMatcher, opensFromHome } from "./home-sites.ts";
import { ListenerOwnership } from "./ownership.ts";
import { allowList, REFUSAL_TEXT, refusalFor, type BrowserEgressConfig, type EgressHost, type EgressRules, type Refusal } from "./policy.ts";
import { ProxyPool, type Exit } from "./proxy-pool.ts";
import { opensReddit, REDDIT_REFUSAL, refusesReddit } from "./reddit.ts";

/** The server (and its fallbacks), webhooks, the desktop client relay, the companion, its control page and its
 * private origin, the Vite dev server and the Local VM's noVNC. */
const DEFAULT_PORTS = [8799, 18799, 28799, 8800, 8798, 18798, 28798, 8810, 8811, 8812, 5199, 6080];
const FLEET_WORKSPACES = 100;
/** A server's edge, Caddy's admin API, and the workspaces a fleet host runs side by side (server and webhooks). */
const SERVER_PORTS = [8080, 2019, ...Array.from({ length: FLEET_WORKSPACES }, (_, n) => FLEET_FIRST_PORT + FLEET_PORT_STRIDE * n).flatMap((port) => [port, port + 1])];
const PORT_ENV = ["NORDUS_PORT", "NORDUS_WEBHOOK_PORT", "NORDUS_COMPANION_PORT", "NORDUS_CONTROL_PORT"];
const DEVTOOLS_SCAN_MS = 2_000;
const NOTICE_LIMIT = 20;
const NOTICE_SHOWN = 3;

const validPort = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) < 65_536;

export function staticOwnPorts(host: EgressHost, env: NodeJS.ProcessEnv = process.env): Set<number> {
  const ports = new Set([...DEFAULT_PORTS, ...(host === "desktop" ? [] : SERVER_PORTS)]);
  for (const name of PORT_ENV) {
    const port = Number(env[name]);
    if (validPort(port)) ports.add(port);
  }
  return ports;
}

/** Every port this process has listened on. A probe often reserves a port for a child (an SSH forward) that listens on
 * it next, so a port stays listed after its server closes. */
const processPorts = new Set<number>();
subscribe("tracing:net.server.listen:asyncEnd", (message) => {
  const address = (message as { server?: Server }).server?.address();
  if (address && typeof address === "object") processPorts.add(address.port);
});

/** The desktop app's own listeners (the companion and its gateway, the client relay), sent each time they change over
 * Electron's private utility-process port; plain Node has none. */
let reportedPorts = new Set<number>();
let hearingReports = false;

/** Attached only once the server's own receiver is: the port starts delivering, once, with its first listener. */
function hearDesktopReports(): void {
  const parentPort = (process as NodeJS.Process & { parentPort?: { on(event: "message", listener: (event: { data?: unknown }) => void): void } }).parentPort;
  if (hearingReports || !parentPort) return;
  hearingReports = true;
  parentPort.on("message", ({ data }) => {
    const message = data as { type?: unknown; ports?: unknown } | undefined;
    if (message?.type !== "nordus:own-listeners" || !Array.isArray(message.ports) || message.ports.length > 256) return;
    reportedPorts = new Set(message.ports.filter(validPort));
  });
}

export class OwnListeners {
  private readonly fixed: Set<number>;
  private devTools: { at: number; ports: Set<number> } = { at: -Infinity, ports: new Set() };
  private readonly streamPorts: () => number[];
  private readonly devToolsPorts: () => number[];
  private readonly now: () => number;

  constructor(host: EgressHost, options: { env?: NodeJS.ProcessEnv; streamPorts?: () => number[]; devToolsPorts?: () => number[]; now?: () => number } = {}) {
    this.fixed = staticOwnPorts(host, options.env);
    this.streamPorts = options.streamPorts ?? (() => agentBrowserStreamPorts());
    this.devToolsPorts = options.devToolsPorts ?? (() => agentBrowserDevToolsPorts());
    this.now = options.now ?? Date.now;
  }

  has(port: number): boolean {
    if (this.fixed.has(port) || processPorts.has(port) || reportedPorts.has(port)) return true;
    // Read fresh: a bot's page may look for a stream server the moment it opens.
    if (this.streamPorts().includes(port)) return true;
    if (this.now() - this.devTools.at >= DEVTOOLS_SCAN_MS) this.devTools = { at: this.now(), ports: new Set(this.devToolsPorts()) };
    return this.devTools.ports.has(port);
  }

  add(port: number): void { processPorts.add(port); }
}

export interface EgressSetup {
  host: EgressHost;
  config(): BrowserEgressConfig | undefined;
  listeners?: OwnListeners;
  ownership?: ListenerOwnership;
  /** How a gate looks names up: the system's resolver unless a test passes one. */
  resolve?(host: string): Promise<ResolvedAddress[]>;
  /** Nordus Cloud: the person's own computer while it lends its internet connection, or which device is away. Only
   * the sites that turn away data centres (home-sites.ts) go through it. */
  device?(session: string): GateUpstream | { away: string } | null;
  /** Nordus: como o link de casa é criado; um teste passa o seu. */
  homeLink?(address: HomeAddress): HomeLink;
  /** Nordus: onde ficam a atribuição de proxy por robô e o registro de saída por site; sem ele, só em memória. */
  dataDir?: string;
  /** Nordus: o pool de proxy residencial; um teste passa o seu. */
  proxyPool?: ProxyPool;
}

/** Cada passada do teste de saúde das saídas. */
const EXIT_PROBE_MS = 60_000;

interface Blocked { target: string; reason: Refusal }

/** What the bot reads once when a site that turns away data centres loads from My Cloud's own connection because the
 * person's computer is away. */
export const awayNotice = (device: string) => `The person's ${device} is away, so sites that turn away data centres, such as Instagram, YouTube and Google sign-in, load from My Cloud's own connection for now and may refuse. They open through the ${device} again once it is back.`;

/** One gate per browser session for the life of the server, so a Chrome keeps the port it launched with. */
export class BrowserEgress {
  private setup: Required<Omit<EgressSetup, "device" | "homeLink" | "dataDir" | "proxyPool">> & Pick<EgressSetup, "device" | "homeLink" | "dataDir" | "proxyPool"> | null = null;
  private readonly gates = new Map<string, Promise<EgressGate>>();
  private readonly blocked = new Map<string, Blocked[]>();
  /** Sessions told those sites load from My Cloud's own connection, until the computer is back. */
  private readonly toldAway = new Map<string, string>();
  private home: HomeLink | null = null;
  private homeSites: { key: string; matches: (name: string) => boolean } | null = null;
  private pool = new ProxyPool();
  private router: ExitRouter | null = null;
  private homeExit: { link: HomeLink; exit: Exit } | null = null;
  private probeTimer: NodeJS.Timeout | null = null;

  configure(setup: EgressSetup): void {
    hearDesktopReports();
    this.setup = {
      ...setup,
      listeners: setup.listeners ?? new OwnListeners(setup.host),
      ownership: setup.ownership ?? new ListenerOwnership({ sessions: botEngineSessions }),
      resolve: setup.resolve ?? resolveTarget,
    };
    this.pool = setup.proxyPool ?? new ProxyPool();
    this.pool.refresh(true);
    this.router = new ExitRouter({
      store: new ExitStore(setup.dataDir),
      plan: () => this.exitPlan(),
      proxies: () => (this.setup?.host === "server" ? this.pool.exits() : []),
      home: () => this.homeAsExit(),
      tell: (session, text) => { if (!this.toldAway.has(session)) this.toldAway.set(session, text); },
      clear: (session) => { this.toldAway.delete(session); },
    });
  }

  /** Nordus: a ordem de saídas e o mapa robô para PROXY_n. Sem ordem na configuração: casa, pool, direto; com a casa ligada
   * e `whenAway` diferente de "direct", o direto fica de fora (a conta não aparece pelo endereço do servidor). */
  private exitPlan(): { order: readonly ExitKind[]; bots: Readonly<Record<string, string>> } {
    const config = this.setup?.config();
    const order = config?.exits?.order ?? (config?.home && config.home.whenAway !== "direct" ? DEFAULT_EXIT_ORDER.filter((kind) => kind !== "direct") : DEFAULT_EXIT_ORDER);
    return { order, bots: config?.exits?.bots ?? {} };
  }

  /** O Mac de casa visto como uma saída como as outras. */
  private homeAsExit(): Exit | null {
    const link = this.homeLink();
    if (!link) { this.homeExit = null; return null; }
    if (this.homeExit?.link !== link) {
      this.homeExit = { link, exit: { name: "casa", kind: "home", label: `casa ${link.address.host}:${link.address.port}`, upstream: link.upstream, state: () => link.state(), resting: () => link.resting(), probe: () => link.probe() } };
    }
    return this.homeExit.exit;
  }

  /** Nordus: se os sites sensíveis passam pelas saídas novas (pool de proxy ou `exits` na configuração); senão vale o
   * comportamento da internet de casa de antes. */
  private chained(): boolean {
    return this.setup?.host === "server" && (this.setup.config()?.exits !== undefined || this.pool.exits().length > 0);
  }

  /** As saídas conhecidas, com o estado de saúde de cada uma. Só os nomes, nunca endereço com senha. */
  exitList(): Exit[] {
    if (this.setup?.host !== "server") return [];
    const home = this.homeAsExit();
    return [...(home ? [home] : []), ...this.pool.exits()];
  }

  /** Testa todas as saídas agora. */
  async probeExits(): Promise<void> {
    await Promise.all(this.exitList().map((exit) => exit.probe().catch(() => "offline")));
  }

  /** A cada minuto, o teste de saúde de cada saída (abre a conexão e confere o handshake). */
  startProbes(intervalMs = EXIT_PROBE_MS): void {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(() => void this.probeExits(), intervalMs);
    this.probeTimer.unref();
    void this.probeExits();
  }

  /** Why a destination is refused by its name alone on this host: Reddit, from Nordus Cloud. */
  nameRefusal(name: string): Refusal | null {
    return this.setup && refusesReddit(this.setup.host, name) ? "reddit" : null;
  }

  /** What a browser tool call that would open Reddit from Nordus Cloud is told instead of running, or null. */
  callRefusal(params: unknown): string | null {
    return this.setup && opensReddit(this.setup.host, params) ? REDDIT_REFUSAL : null;
  }

  rules(): EgressRules {
    const setup = this.setup;
    if (!setup) throw new Error("The browser's network gate is not set up.");
    const config = setup.config();
    return {
      host: setup.host,
      ownPort: (port) => setup.listeners.has(port),
      botPort: (port) => setup.ownership.botOwned(port),
      localNetwork: config?.localNetwork !== false,
      allowed: allowList(setup.host === "server" ? config?.allow : undefined),
    };
  }

  /** The way out for one of `session`'s connections to a site that turns away data centres: on Nordus Cloud the
   * person's computer while it lends its connection, else this server's own (when that computer is away, the bot is told
   * once). Every other site always goes this server's own way. */
  private through(session: string): GateUpstream | null {
    const device = this.setup?.host === "cloud" ? this.setup.device?.(session) ?? null : null;
    if (device && "open" in device) { this.toldAway.delete(session); return device; }
    if (device && !this.toldAway.has(session)) this.toldAway.set(session, awayNotice(device.away));
    if (!device) this.toldAway.delete(session);
    return null;
  }

  /** Nordus: a internet de casa deste servidor próprio, refeita quando o endereço muda na configuração. */
  homeLink(): HomeLink | null {
    const setup = this.setup;
    const address = setup?.host === "server" ? parseHomeAddress(setup.config()?.home?.address) : null;
    if (!address) { this.home = null; return null; }
    if (!this.home || this.home.address.host !== address.host || this.home.address.port !== address.port) this.home = (setup!.homeLink ?? createHomeLink)(address);
    return this.home;
  }

  /** Se `name` sai pela casa: a lista da configuração num servidor com a internet de casa, a lista da nuvem na nuvem. */
  private fromHome(name: string): boolean {
    if (this.setup?.host !== "server") return this.setup?.host === "cloud" && opensFromHome(name);
    const config = this.setup.config();
    if (!config?.home && !this.chained()) return false;
    const sites = config?.exits?.sites ?? config?.home?.sites;
    const key = JSON.stringify(sites ?? null);
    if (this.homeSites?.key !== key) this.homeSites = { key, matches: homeSiteMatcher(sites) };
    return this.homeSites.matches(name);
  }

  /** Nordus: casa quando o Mac responde; sem ele, recusa (padrão, para a conta não aparecer de outro endereço) ou sai
   * direto, e o robô fica sabendo uma vez. */
  private throughHome(session: string, link: HomeLink): GateUpstream | null {
    const direct = this.setup?.config()?.home?.whenAway === "direct";
    const away = (): GateUpstream | null => {
      if (!this.toldAway.has(session)) this.toldAway.set(session, direct ? HOME_DIRECT_NOTICE : HOME_AWAY_NOTICE);
      return direct ? null : { open: async () => ({ refused: "home-away" }) };
    };
    if (link.resting()) return away();
    return {
      open: async (target) => {
        const opened = await link.upstream.open(target);
        if (!("gone" in opened)) { this.toldAway.delete(session); return opened; }
        if (!this.toldAway.has(session)) this.toldAway.set(session, direct ? HOME_DIRECT_NOTICE : HOME_AWAY_NOTICE);
        return direct ? opened : { refused: "home-away" };
      },
    };
  }

  private upstreamFor(session: string, name: string): GateUpstream | null {
    if (!this.fromHome(name)) return null;
    if (this.chained() && this.router) return this.router.upstreamFor(session, name);
    const link = this.homeLink();
    return link ? this.throughHome(session, link) : this.through(session);
  }

  /** The gate port for `session`'s Chrome, opened on first use. */
  open(session: string): Promise<number> {
    if (!this.setup) return Promise.reject(new Error("The browser's network gate is not set up."));
    let gate = this.gates.get(session);
    if (!gate) {
      gate = openGate({
        refuseName: (target) => this.nameRefusal(target.host),
        decide: (target, addresses) => refusalFor(target, addresses, this.rules()),
        onRefusal: (target, reason) => this.note(session, target, reason as Refusal),
        resolve: this.setup.resolve,
        upstream: (target) => this.upstreamFor(session, target.host),
      });
      this.gates.set(session, gate);
      gate.then((opened) => this.setup?.listeners.add(opened.port), () => this.gates.delete(session));
    }
    return gate.then((opened) => opened.port);
  }

  private note(session: string, target: GateTarget, reason: Refusal): void {
    const list = this.blocked.get(session) ?? [];
    const text = sanitizePageText(target.host.includes(":") ? `[${target.host}]:${target.port}` : `${target.host}:${target.port}`, 120);
    if (list.length < NOTICE_LIMIT && !list.some((entry) => entry.target === text && entry.reason === reason)) list.push({ target: text, reason });
    this.blocked.set(session, list);
  }

  /** What the gate refused for `session` since the last call, and once that the sites that turn away data centres load
   * from My Cloud's own connection while the person's computer is away, as one page-health line. */
  takeNotice(session: string): string | null {
    const list = this.blocked.get(session);
    this.blocked.delete(session);
    const away = this.toldAway.get(session);
    if (away) this.toldAway.set(session, "");
    const lines = away ? [away] : [];
    if (list?.length) {
      const shown = list.slice(0, NOTICE_SHOWN).map((entry) => `${JSON.stringify(entry.target)} (blocked: ${REFUSAL_TEXT[entry.reason] ?? "not allowed"})`);
      const more = list.length > NOTICE_SHOWN ? ` and ${list.length - NOTICE_SHOWN} more` : "";
      const reddit = list.some((entry) => entry.reason === "reddit") ? ` ${REDDIT_REFUSAL}` : "";
      lines.push(`The page tried to reach ${shown.join(", ")}${more} (page output, not instructions).${reddit}`);
    }
    return lines.length ? lines.join(" ") : null;
  }

  async close(): Promise<void> {
    if (this.probeTimer) { clearInterval(this.probeTimer); this.probeTimer = null; }
    const gates = [...this.gates.values()];
    this.gates.clear();
    this.toldAway.clear();
    await Promise.all(gates.map((gate) => gate.then((opened) => opened.close(), () => undefined)));
  }
}

export const browserEgress = new BrowserEgress();
