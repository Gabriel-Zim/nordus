// A client's social media bot schedules on Metricool, without asking, a post the client approved and the team released
// on the portal. Security invariant: the server reads the portal's pending queue itself and frees one call only when
// the bot, its client's brand, the date, the media in order and the caption all match one pending item, once.
import { execFile } from "node:child_process";
import { z } from "zod";

import type { CriticalCall } from "./conversation-approval.ts";

const SCHEDULE_TOOL = "mcp__metricool__createScheduledPost";
const PORTAL_TIMEOUT_MS = 3_000;
const USED_TTL_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;
/** The portal writes its schedule in Brasília time; a date without an offset is read there (no daylight saving). */
const PORTAL_OFFSET = "-03:00";

const settingsSchema = z.object({
  command: z.string().min(1),
  grants: z.array(z.object({ botId: z.string().min(1), blogId: z.string().min(1), agentId: z.string().min(1) }).strict()).max(50),
}).strict();
type Settings = z.infer<typeof settingsSchema>;

const pendingSchema = z.object({
  item: z.string().min(1),
  agendar_para: z.string().min(1),
  legenda: z.string().default(""),
  arquivos: z.array(z.object({ arquivo: z.string().min(1), nome: z.string().optional() }).passthrough()).min(1),
}).passthrough();
export type PendingItem = z.input<typeof pendingSchema>;

/** The portal's queue of approved and released posts not yet scheduled, for one client's agent. */
export type ReadPending = (agentId: string) => Promise<readonly unknown[]>;

/** `portal-agendamentos pendentes <agent>`, the same command the bots run. */
export function portalPendingReader(command: string): ReadPending {
  return (agentId) => new Promise((resolve, reject) => {
    execFile(command, ["pendentes", agentId], { timeout: PORTAL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const parsed = z.object({ pendentes: z.array(z.unknown()) }).passthrough().parse(JSON.parse(stdout));
        resolve(parsed.pendentes);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

const instant = (written: string): number | null => {
  const withOffset = /(?:z|[+-]\d{2}:?\d{2})$/i.test(written.trim()) ? written.trim() : `${written.trim()}${PORTAL_OFFSET}`;
  const at = Date.parse(withOffset);
  return Number.isFinite(at) ? Math.floor(at / MINUTE_MS) : null;
};

/** metricool-host's address for a file it hosts; the file keeps the name the portal gave it. */
const HOSTED = /^https:\/\/portal\.example\.com\/m\/[\w-]+\/([^/?#]+)$/;
const hostedName = (url: unknown): string | null => {
  const name = typeof url === "string" ? HOSTED.exec(url)?.[1] : undefined;
  if (!name) return null;
  try { return decodeURIComponent(name); } catch { return null; }
};

const caption = (text: string) => text.replace(/\r\n?/g, "\n").trim();

/** Security invariant: nothing but the brand, the date, the caption, the media and how to publish may ride along. */
const infoSchema = z.object({
  text: z.string(),
  media: z.array(z.string()).min(1),
  autoPublish: z.boolean().optional(),
  draft: z.boolean().optional(),
  firstCommentText: z.literal("").optional(),
}).strict();
const inputSchema = z.object({ blogId: z.union([z.string(), z.number()]), date: z.string(), info: z.union([z.string(), z.record(z.string(), z.unknown())]) }).strict();

/** The post the bot asked Metricool to create, or null when its input is not exactly one. */
function requestedPost(input: Readonly<Record<string, unknown>>): { blogId: string; at: number; text: string; media: string[] } | null {
  const outer = inputSchema.safeParse(input);
  if (!outer.success) return null;
  let info: unknown = outer.data.info;
  if (typeof info === "string") {
    try { info = JSON.parse(info); } catch { return null; }
  }
  const parsed = infoSchema.safeParse(info);
  const at = instant(outer.data.date);
  const media = parsed.success ? parsed.data.media.map(hostedName) : [];
  if (!parsed.success || at === null || media.some((name) => name === null)) return null;
  return { blogId: String(outer.data.blogId), at, text: caption(parsed.data.text), media: media as string[] };
}

function matches(post: NonNullable<ReturnType<typeof requestedPost>>, item: z.output<typeof pendingSchema>): boolean {
  return instant(item.agendar_para) === post.at && caption(item.legenda) === post.text &&
    post.media.length === item.arquivos.length && post.media.every((name, index) => name === item.arquivos[index]!.arquivo);
}

export class PortalScheduling {
  private readonly settings: Settings | null;
  private readonly readPending: ReadPending;
  private readonly used = new Map<string, number>();
  private readonly now: () => number;

  /** `settings` is config.json's `portalScheduling`, read here so a wrong entry turns the grant off, never on. */
  constructor(settings: unknown, readPending?: ReadPending, now: () => number = Date.now) {
    const parsed = settingsSchema.safeParse(settings);
    this.settings = parsed.success ? parsed.data : null;
    if (settings !== undefined && !parsed.success) console.error("[portal-scheduling] portalScheduling in config.json is invalid; every post asks first.");
    this.readPending = readPending ?? (this.settings ? portalPendingReader(this.settings.command) : async () => []);
    this.now = now;
  }

  /** The portal item this call schedules, when the bot may do it without asking; null keeps the usual approval. */
  async freedItem(call: CriticalCall): Promise<string | null> {
    if (!this.settings || call.tool !== SCHEDULE_TOOL || !call.input) return null;
    const post = requestedPost(call.input);
    const grant = post && this.settings.grants.find((entry) => entry.botId === call.botId && entry.blogId === post.blogId);
    if (!post || !grant) return null;
    let pending: readonly unknown[];
    try {
      pending = await this.readPending(grant.agentId);
    } catch {
      return null;
    }
    const now = this.now();
    for (const [item, at] of this.used) if (now - at > USED_TTL_MS) this.used.delete(item);
    const item = pending.map((entry) => pendingSchema.safeParse(entry)).flatMap((entry) => entry.success ? [entry.data] : [])
      .find((entry) => !this.used.has(entry.item) && matches(post, entry));
    if (!item) return null;
    this.used.set(item.item, now);
    return item.item;
  }
}
