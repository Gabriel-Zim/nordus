// The OpenAI key is never read or written here; without one a start answers 409 `needsKey`. A phone can never send device-revoked.
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { LiveSettings } from "../../shared/wire.ts";
import { LiveSessionError, MAX_SDP_BYTES } from "../live-call.ts";
import { isLiveVoice, MAX_PREVIEW_BYTES, previewMime, type VoicePreviews } from "../live-voice-preview.ts";
import { LiveCallBusyError, type LiveCallController } from "../live-call-controller.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

export interface LiveRouteDeps {
  calls: Pick<LiveCallController, "start" | "end" | "current" | "deviceRevoked">;
  resolveTarget(botId: string, threadId: string | undefined): { botId: string; botName: string; threadId: string } | null;
  settings(): LiveSettings;
  setBotVoice?(botId: string, choice: string): Promise<{ voice: string; source: "manual" | "auto" } | null>;
  /** The saved sample of each voice, recorded by the browser on the first listen. */
  voicePreviews?: VoicePreviews;
  saveSettings(patch: { voice?: string; readTypedReplies?: boolean; idleMinutes?: number }): Promise<LiveSettings>;
}

const id = z.string().regex(/^[\w-]{1,120}$/);
const sessionBody = z.object({
  botId: id,
  threadId: id.optional(),
  // Not trimmed: the SDP offer goes to OpenAI byte for byte.
  sdp: z.string().min(1).refine((sdp) => Buffer.byteLength(sdp) <= MAX_SDP_BYTES),
  client: z.enum(["desktop", "web", "ios", "android"]),
}).strict();
const endBody = z.object({ callId: z.string().min(1).max(120) }).strict();
// Strict, so `key` is refused rather than ignored: the key is saved only through the credential store or PUT /api/config.
const settingsBody = z.object({
  voice: z.string().trim().max(40).regex(/^[a-z]*$/).optional(),
  readTypedReplies: z.boolean().optional(),
  idleMinutes: z.number().int().min(1).max(60).optional(),
}).strict();

const botVoiceBody = z.object({ botId: id, voice: z.union([z.literal("auto"), z.string().regex(/^[a-z]{2,40}$/)]) }).strict();

const DEVICE_ID = /^[\w-]{1,128}$/;

/** The companion sends its own id for the phone that authenticated, never one the phone chose. */
function companionDevice(req: IncomingMessage): string | undefined {
  if (req.headers["x-nordus-companion"] !== "1") return undefined;
  const device = req.headers["x-nordus-companion-device"];
  return typeof device === "string" && DEVICE_ID.test(device) ? device : undefined;
}

async function bodyOf(req: IncomingMessage, readBody: RouteContext["readBody"]): Promise<unknown> {
  try {
    return await readBody(req);
  } catch {
    return undefined;
  }
}

export function createLiveRoutes(deps: LiveRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/live/")) return PASS;

    if (method === "POST" && path === "/api/live/session") {
      const parsed = sessionBody.safeParse(await bodyOf(req, readBody));
      if (!parsed.success) return json(res, 400, { error: "The call request was not valid." });
      const target = deps.resolveTarget(parsed.data.botId, parsed.data.threadId);
      if (!target) return json(res, 404, { error: "That bot or chat does not exist." });
      try {
        const device = companionDevice(req);
        const { call, sdp } = await deps.calls.start({ auth, ...(device ? { device } : {}), ...target, client: parsed.data.client, sdp: parsed.data.sdp });
        return json(res, 201, { call, transport: { type: "webrtc", sdp } });
      } catch (error) {
        if (error instanceof LiveCallBusyError) return json(res, 409, { error: error.message, activeCall: error.call });
        if (error instanceof LiveSessionError) {
          return json(res, error.status, error.status === 409 ? { error: error.message, needsKey: true } : { error: error.message });
        }
        throw error;
      }
    }

    if (method === "POST" && path === "/api/live/call/end") {
      const parsed = endBody.safeParse(await bodyOf(req, readBody));
      if (!parsed.success) return json(res, 400, { error: "The request was not valid." });
      const call = await deps.calls.end(parsed.data.callId);
      return call ? json(res, 200, { call }) : json(res, 404, { error: "That call is not running." });
    }

    if (method === "GET" && path === "/api/live/call") return json(res, 200, { call: deps.calls.current() });

    if (method === "POST" && path === "/api/live/device-revoked") {
      if (req.headers["x-nordus-companion"] !== "1") return json(res, 403, { error: "Only the phone companion can report an unpaired phone." });
      const device = companionDevice(req);
      if (!device) return json(res, 400, { error: "The unpaired phone was not named." });
      return json(res, 200, { call: deps.calls.deviceRevoked(device) });
    }

    if (method === "PUT" && path === "/api/live/bot-voice") {
      const parsed = botVoiceBody.safeParse(await bodyOf(req, readBody));
      if (!parsed.success) return json(res, 400, { error: "That voice was not valid." });
      const saved = await deps.setBotVoice?.(parsed.data.botId, parsed.data.voice);
      return saved ? json(res, 200, saved) : json(res, 404, { error: "That bot does not exist." });
    }

    const previewPath = /^\/api\/live\/voice-preview\/([^/]+)(\/session)?$/.exec(path);
    if (previewPath) {
      let voice = "";
      try { voice = decodeURIComponent(previewPath[1]!); } catch {}
      const previews = deps.voicePreviews;
      if (!isLiveVoice(voice) || !previews) return json(res, 404, { error: "That voice does not exist." });
      const fail = (error: unknown) => {
        if (error instanceof LiveSessionError) {
          return json(res, error.status, error.status === 409 ? { error: error.message, needsKey: true } : { error: error.message });
        }
        throw error;
      };

      if (method === "GET" && !previewPath[2]) {
        const saved = await previews.read(voice);
        if (!saved) return json(res, 404, { error: "That voice has not been heard yet.", missing: true });
        res.writeHead(200, { "content-type": saved.mime, "content-length": saved.data.length, "cache-control": "private, no-cache" });
        res.end(saved.data);
        return;
      }

      if (method === "POST" && previewPath[2]) {
        const body = z.object({ sdp: z.string().min(1).refine((sdp) => Buffer.byteLength(sdp) <= MAX_SDP_BYTES) }).strict().safeParse(await bodyOf(req, readBody));
        if (!body.success) return json(res, 400, { error: "The sample request was not valid." });
        try {
          const { sdp } = await previews.start(voice, body.data.sdp);
          return json(res, 201, { transport: { type: "webrtc", sdp } });
        } catch (error) {
          return fail(error);
        }
      }

      if (method === "PUT" && !previewPath[2]) {
        const mime = previewMime(req.headers["content-type"]);
        if (!mime) return json(res, 415, { error: "The sample must be audio/webm, audio/ogg or audio/mp4." });
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > MAX_PREVIEW_BYTES) return json(res, 413, { error: "The sample is too large." });
        const chunks: Buffer[] = [];
        let size = 0;
        let tooLarge = false;
        await new Promise<void>((done, reject) => {
          req.on("data", (chunk: Buffer | string) => {
            if (tooLarge) return;
            const part = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
            size += part.length;
            if (size > MAX_PREVIEW_BYTES) { tooLarge = true; chunks.length = 0; return; }
            chunks.push(part);
          });
          req.on("end", done);
          req.on("error", reject);
        });
        if (tooLarge) return json(res, 413, { error: "The sample is too large." });
        if (!size) return json(res, 400, { error: "The sample was empty." });
        try {
          await previews.save(voice, Buffer.concat(chunks), mime);
          return json(res, 200, { ok: true });
        } catch (error) {
          return fail(error);
        }
      }
    }

    if (method === "PATCH" && path === "/api/live/settings") {
      const parsed = settingsBody.safeParse(await bodyOf(req, readBody));
      if (!parsed.success) {
        return json(res, 400, { error: "Those Live settings are not valid." });
      }
      if (!Object.keys(parsed.data).length) return json(res, 400, { error: "nothing to save" });
      return json(res, 200, { live: await deps.saveSettings(parsed.data) });
    }

    return PASS;
  };
}
