import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ReplyDraftSnapshot } from "../../shared/runtime-events.ts";
import type { WireBot, WireGroup } from "../../shared/wire.ts";
import {
  ATTACHMENTS_DIR, completeFileParts, extensionForMime, FILE_PART_MAX_BYTES, fileMaxBytes, IMAGE_MAX_BYTES, parseByteRange, readAttachment, saveFile, saveFilePart, saveImageUpload,
  validateAttachmentUploadId, type SavedAttachment,
} from "../attachments.ts";
import { isConvertedAvatarName } from "../avatar-webp.ts";
import { deliveredCopy } from "../bot-attachment.ts";
import { readLimitedBody, transcribableAudioExtension, transcribeLocally } from "../html-transcribe.ts";
import { memberBot, memberGroup, type Viewer, type VisibleSet } from "../bot-visibility.ts";
import type { ComputerControl } from "../computer-control.ts";
import type { AppConfig } from "../config.ts";
import type { Coordinator } from "../coordinator.ts";
import type { WorkspaceAccess } from "../enterprise.ts";
import type { GroupUsageReader } from "../group-thread-usage.ts";
import { searchMessagesAsync } from "../message-db.ts";
import { presentedMessage } from "../host/message-pages.ts";
import {
  listMessageFolder, messageAttachmentName, messageFileDisposition, messageFileDownloadName, messageFolderEntryName,
  messageImageTargetAt, messageReferencesFile, openMessageFile, openMessageFolderEntry, referencedFileName,
  type OpenedMessageFile,
} from "../message-file.ts";
import { resolveRequestAuth, type RequestAuth, type ResolveOptions } from "../request-auth.ts";
import type { queuedSteerSnapshot } from "../steer-queue.ts";
import type { BotRecord, GroupRecord, Message, Store } from "../store.ts";
import { createJobRoutes } from "./jobs.ts";
import { TASK_WORKSPACES_DIR } from "../workspace.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

/** The bare generated name of a bot-attached HTML page (saveFile writes `${uuid}.html`). */
const HTML_ATTACHMENT_NAME = /^[A-Za-z0-9-]+\.html$/i;
/** The frame is the only way this page runs: an opaque origin (sandbox) with no network, so it can't touch the app, cookies or storage. */
export const HTML_FRAME_CSP = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob: https:",
  "media-src data: blob: https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");
const TRANSCRIBE_LIMIT = 10 * 1024 * 1024;
/**
 * A converted avatar is a picture picked for display: its name never changes, so the browser may keep it for good.
 * Every other attachment is decided per request, so the browser must never reuse one member's copy for another identity.
 */
export function attachmentCacheHeaders(name: string, mime: string): Record<string, string> {
  const base = { "content-type": mime, "accept-ranges": "bytes", "x-content-type-options": "nosniff" };
  if (isConvertedAvatarName(name)) {
    return { ...base, "cache-control": "private, max-age=31536000, immutable", etag: `"${name}"` };
  }
  return { ...base, "cache-control": "private, no-store" };
}

export function ifNoneMatchHits(header: string | string[] | undefined, etag: string): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  return value !== undefined && value.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || trimmed === etag || trimmed === `W/${etag}`;
  });
}

/** The bare generated name of a stored audio or video file; the only thing a stream URL carries. */
const STREAM_MEDIA_NAME = /^[A-Za-z0-9-]+\.(?:mp4|m4v|webm|mov|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;

/**
 * Streams an opened stored media file with Range support, never reading it into memory. The weak ETag lets the browser
 * revalidate on every request (so authorization is rechecked) for the price of a 304.
 */
async function streamStoredMedia(
  req: IncomingMessage,
  res: ServerResponse,
  file: OpenedMessageFile,
): Promise<void> {
  const info = await file.handle.stat();
  const size = file.bytes;
  const etag = `W/"${size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    "content-type": file.mime,
    "content-disposition": "inline",
    "accept-ranges": "bytes",
    "cache-control": "private, no-cache",
    "cdn-cache-control": "no-store",
    "cloudflare-cdn-cache-control": "no-store",
    vary: "Authorization, Cookie",
    etag,
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
  };
  const header = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  if (header("if-none-match")?.trim() === etag) {
    await file.handle.close();
    res.writeHead(304, headers);
    res.end();
    return;
  }
  // A validator that no longer matches means the bytes changed: a partial of the old file would be wrong.
  const ifRange = header("if-range")?.trim();
  const range = ifRange && ifRange !== etag ? { kind: "none" as const } : parseByteRange(header("range"), size);
  if (range.kind === "unsatisfiable") {
    await file.handle.close();
    res.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
    res.end();
    return;
  }
  const [start, end] = range.kind === "range" ? [range.start, range.end] : [0, size - 1];
  if (range.kind === "range") {
    res.writeHead(206, { ...headers, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` });
  } else {
    res.writeHead(200, { ...headers, "content-length": String(size) });
  }
  if (size === 0) {
    await file.handle.close();
    res.end();
    return;
  }
  const stream = file.handle.createReadStream({ start, end, autoClose: true });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

export type MessagePage = { messages: Array<Message | Record<string, unknown>>; hasMore?: boolean; activeLeafId: string | null };

export interface ThreadRouteDeps {
  store: Pick<Store,
    | "activeLeaf" | "activePath" | "bot" | "botByThread" | "bots" | "groupByThread" | "groupTaskByThread" | "groups" | "messagesFor"
    | "onChange" | "sections" | "taskByThread" | "tasks">;
  coordinator: Pick<Coordinator, "job">;
  groupThreadIsWorking(groupId: string, threadId: string): boolean;
  cfg: Pick<AppConfig, "profile">;
  sessions: ResolveOptions["sessions"];
  groupUsageReader: Pick<GroupUsageReader, "refresh">;
  hostedWorkspace: boolean;
  sessionCookie: string;
  loopback: { trust: ResolveOptions["loopbackTrust"]; localBrowsers: boolean };
  lendingEnabled(): boolean;
  workspaceAccess(): WorkspaceAccess | null;
  desktopMutationToken(): string | undefined;
  companionMutationToken(): string | undefined;
  cliOwnerToken(): string | undefined;
  defaultPage: number;
  pageSize(raw: string | null): number | null | undefined;
  messagePage(threadId: string, limit: number | undefined, before?: string | null): MessagePage;
  messageWindow(threadId: string, messageId: string, limit: number): { messages: Array<Message | Record<string, unknown>>; hasMore: boolean } | null;
  publicBotQueuedMessages(): ReturnType<typeof queuedSteerSnapshot>;
  publicGroupState(record: GroupRecord): WireGroup;
  wireBot(bot: BotRecord): WireBot;
  botComputerControlSnapshot(botId: string): ReturnType<ComputerControl["snapshot"]>;
  messageFileRootsForThread(senderId: string, threadId: string): string[];
  messageClientWorkRoots(senderId: string, threadId: string): string[];
  viewerFor(auth: RequestAuth): Viewer;
  visibleTo(viewer: Viewer): VisibleSet;
  /** The live stream's cursor right now: a snapshot built in the same tick reflects every frame up to it. */
  liveCursor(): string;
  /** Threads that changed after a device's cursor, or null when it needs everything. */
  snapshotChangedThreads(since: string | null, viewer: Viewer): Set<string> | null;
  /** The reply the conversation's bot is writing right now, for a phone that missed a piece. */
  replyDraft(threadId: string): ReplyDraftSnapshot | null;
}

export function createThreadRoutes(deps: ThreadRouteDeps): RouteHandler {
  const {
    store, cfg, sessions, groupUsageReader, lendingEnabled,
    hostedWorkspace: HOSTED_WORKSPACE, sessionCookie: SESSION_COOKIE, loopback: LOOPBACK, defaultPage: DEFAULT_PAGE,
    pageSize, messagePage, messageWindow, publicBotQueuedMessages, publicGroupState, wireBot,
    botComputerControlSnapshot, messageFileRootsForThread, messageClientWorkRoots, viewerFor, visibleTo,
  } = deps;
  const jobs = createJobRoutes({ store, coordinator: deps.coordinator, groupThreadIsWorking: deps.groupThreadIsWorking, viewerFor, visibleTo, sessions });
  const handle = async ({ req, res, url, path, method, auth, json, readBody }: RouteContext): Promise<unknown> => {
    let m: RegExpMatchArray | null = null;
    const viewer = viewerFor(auth);
    const visible = visibleTo(viewer);
    const workspaceAccess = deps.workspaceAccess();
    const desktopMutationToken = deps.desktopMutationToken();
    const companionMutationToken = deps.companionMutationToken();
    const cliOwnerToken = deps.cliOwnerToken();
    if (method === "GET" && path === "/api/bots") {
      try { groupUsageReader.refresh(); } catch { }
      const limit = pageSize(url.searchParams.get("messages"));
      if (limit === null) return json(res, 400, { error: "messages must be a non-negative whole number" });
      // A device back from a gap names its cursor and the conversations it holds: one it holds that did not change keeps its messages.
      const changed = deps.snapshotChangedThreads(url.searchParams.get("since"), viewer);
      const held = new Set(changed ? (url.searchParams.get("held") ?? "").split(",") : []);
      // A device that only needs the list names a shorter `preview` page: the conversations in `focus`, and any with
      // something unread (its divider needs the history), still get the full `messages` page.
      const preview = pageSize(url.searchParams.get("preview"));
      if (preview === null) return json(res, 400, { error: "preview must be a non-negative whole number" });
      const focus = new Set((url.searchParams.get("focus") ?? "").split(",").filter(Boolean));
      const page = (threadId: string, full: boolean) => changed && held.has(threadId) && !changed.has(threadId)
        ? {}
        : messagePage(threadId, full || preview === undefined || limit === undefined ? limit : Math.min(preview, limit));
      // tasks stays explicit: clients expect [] where wireBot() would omit the key.
      const shownBots = store.bots.filter((bot) => visible.bot(bot.id));
      const queued = publicBotQueuedMessages();
      return json(res, 200, {
        cursor: deps.liveCursor(),
        ...(changed ? { delta: true } : {}),
        bots: store.bots.filter((bot) => visible.botListed(bot.id)).map((bot) => {
          const wired = wireBot(bot);
          return memberBot({ ...wired, tasks: wired.tasks ?? [], ...page(bot.threadId, focus.has(bot.id) || Boolean(wired.unread)) }, visible);
        }),
        botQueuedMessages: visible.everything ? queued : Object.fromEntries(Object.entries(queued).filter(([threadId]) => visible.thread(threadId))),
        sections: visible.sections(store.sections),
        groups: store.groups.filter((g) => visible.group(g.id)).map((g) => {
          const state = publicGroupState(g);
          const room = { ...state, ...page(g.threadId, focus.has(g.id) || Boolean((state as { unread?: boolean }).unread)) };
          return visible.everything ? room : memberGroup(room);
        }),
        computerControl: Object.fromEntries(
          shownBots.map((bot) => {
            const snapshot = botComputerControlSnapshot(bot.id);
            return [bot.id, { held: snapshot.held, helpReason: snapshot.helpReason, ...(snapshot.help ? { help: snapshot.help } : {}) }];
          }),
        ),
      });
    }

    m = path.match(/^\/api\/threads\/([\w-]+)\/messages$/);
    if (m && method === "GET") {
      const threadId = m[1];
      if (!store.botByThread(threadId) && !store.groupByThread(threadId)) {
        return json(res, 404, { error: "no such conversation" });
      }
      const limit = pageSize(url.searchParams.get("limit"));
      if (limit === null) return json(res, 400, { error: "limit must be a non-negative whole number" });
      const before = url.searchParams.get("before");
      const around = url.searchParams.get("around");
      if (before && around) return json(res, 400, { error: "before and around cannot be combined" });
      if (around) {
        const window = messageWindow(threadId, around, limit ?? DEFAULT_PAGE);
        if (!window) return json(res, 404, { error: "no such message" });
        return json(res, 200, { ...window, activeLeafId: store.activeLeaf(threadId) });
      }
      // An unknown cursor must not answer with the newest page: the client would paginate in a circle.
      if (before && !store.messagesFor(threadId).some((msg) => msg.id === before)) {
        return json(res, 404, { error: "no such message" });
      }
      return json(res, 200, { ...messagePage(threadId, limit ?? DEFAULT_PAGE, before), activeLeafId: store.activeLeaf(threadId) });
    }

    m = path.match(/^\/api\/threads\/([\w-]+)\/reply-draft$/);
    if (m && method === "GET") {
      if (!store.botByThread(m[1]) && !store.groupByThread(m[1])) return json(res, 404, { error: "no such conversation" });
      return json(res, 200, { draft: deps.replyDraft(m[1]) });
    }

    m = path.match(/^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/image$/);
    if (m && method === "GET") {
      // messagesFor caches a ThreadState for any id it is handed, so unknown ids 404 first.
      if (!store.botByThread(m[1]) && !store.groupByThread(m[1])) {
        return json(res, 404, { error: "no such conversation" });
      }
      const message = store.messagesFor(m[1]).find((msg) => msg.id === m![2]);
      if (!message?.png) return json(res, 404, { error: "no image on that message" });
      const bytes = Buffer.from(message.png, "base64");
      res.writeHead(200, {
        "content-type": message.mime ?? "image/png",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
      });
      return res.end(bytes);
    }

    // A bot's HTML page may send a clip of the person's voice; it is transcribed on this machine and only the text goes back.
    m = path.match(/^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/transcribe$/);
    if (m && method === "POST") {
      const threadId = m[1]!;
      const attachmentName = url.searchParams.get("name") ?? "";
      const rawType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
      const refuse = (status: number, error: string) => { req.resume(); return json(res, status, { error }); };
      if (!store.botByThread(threadId) && !store.groupByThread(threadId)) return refuse(404, "no such conversation");
      const message = store.messagesFor(threadId).find((candidate) => candidate.id === m![2]);
      if (!message) return refuse(404, "no such message");
      if (!HTML_ATTACHMENT_NAME.test(attachmentName)) return refuse(400, "name must be a stored html file name");
      const granted = message.role === "bot" && message.attachments?.some((attachment) => attachment.kind === "file" && basename(attachment.path) === attachmentName);
      if (!granted) return refuse(403, "that message does not share this page");
      if (!transcribableAudioExtension(rawType)) return refuse(415, "content-type must be webm, ogg, mp4, mpeg or wav audio");
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > TRANSCRIBE_LIMIT) return refuse(413, "audio exceeds 10 MB");
      try {
        const bytes = await readLimitedBody(req);
        const text = await transcribeLocally(bytes, rawType!);
        return json(res, 200, { text });
      } catch (error) {
        req.resume();
        const status = (error as { status?: number }).status ?? 500;
        return json(res, status, { error: error instanceof Error ? error.message : "transcription failed" });
      }
    }

    // Only a file this exact stored message grants; deliberately not a general path reader.
    m = path.match(/^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/file$/);
    const streamsMessageImage = Boolean(
      m && method === "GET" && url.searchParams.get("preview") === "1",
    );
    // A <video> element cannot POST, so stored media streams over GET (with Range) under the same per-message grant.
    const streamsMessageMedia = Boolean(
      m && method === "GET" && url.searchParams.get("stream") === "1",
    );
    // Same grant for a bot-attached .html page, shown in a sandboxed iframe (a frame cannot POST either).
    const servesMessageHtml = Boolean(
      m && method === "GET" && url.searchParams.get("html") === "1",
    );
    if (m && (method === "POST" || streamsMessageImage || streamsMessageMedia || servesMessageHtml)) {
      if (method === "POST" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const threadId = m[1]!;
      const directBot = store.botByThread(threadId);
      const group = directBot ? undefined : store.groupByThread(threadId);
      if (!directBot && !group) return json(res, 404, { error: "no such conversation" });

      const message = store.messagesFor(threadId).find((candidate) => candidate.id === m![2]);
      if (!message) return json(res, 404, { error: "no such message" });
      if (message.kind !== "text" || (!message.text && !message.attachments?.length)) {
        return json(res, 403, { error: "that message does not share this file" });
      }
      const messageText = message.text ?? "";
      const body = method === "POST" ? await readBody(req) : null;
      const rawReference = streamsMessageImage ? url.searchParams.get("ref") : null;
      if (streamsMessageImage && (!rawReference || !/^\d+$/.test(rawReference))) {
        return json(res, 400, { error: "ref must identify a rendered image" });
      }
      // Stream mode names the file by its bare generated name; the host path never enters the URL.
      const namesStoredFile = streamsMessageMedia || servesMessageHtml;
      const mediaName = namesStoredFile ? url.searchParams.get("name") ?? "" : "";
      if (streamsMessageMedia && !STREAM_MEDIA_NAME.test(mediaName)) {
        return json(res, 400, { error: "name must be a stored audio or video file name" });
      }
      if (servesMessageHtml && !HTML_ATTACHMENT_NAME.test(mediaName)) {
        return json(res, 400, { error: "name must be a stored html file name" });
      }
      let href = namesStoredFile
        ? join(ATTACHMENTS_DIR, mediaName)
        : method === "POST"
          ? (typeof body.path === "string" ? body.path : "")
          : messageImageTargetAt(messageText, Number(rawReference));
      if (!href) return json(res, 400, { error: "path is required" });

      let roots: string[];
      let downloadName: string | undefined;
      const botAttachment = message.role === "bot"
        ? message.attachments?.find((attachment) => namesStoredFile
          ? attachment.kind === "file" && basename(attachment.path) === mediaName
          : attachment.path === href)
        : undefined;
      if (namesStoredFile && botAttachment) href = botAttachment.path;
      // Only a robot's own attach_file grants HTML; a person's message never does.
      if (servesMessageHtml && !botAttachment) {
        return json(res, 403, { error: "that message does not share this file" });
      }
      if (streamsMessageMedia && message.role !== "user" && !botAttachment) {
        return json(res, 403, { error: "that message does not share this file" });
      }
      if (message.role === "user") {
        downloadName = messageAttachmentName(messageText, href) ?? undefined;
        if (!downloadName) {
          return json(res, 403, { error: "that message does not share this file" });
        }
        roots = [ATTACHMENTS_DIR];
      } else if (botAttachment) {
        downloadName = botAttachment.kind === "file" ? botAttachment.name : undefined;
        roots = [ATTACHMENTS_DIR];
      } else {
        if (!messageReferencesFile(messageText, href)) {
          return json(res, 403, { error: "that bot message does not link to this file" });
        }
        const senderId = directBot?.id ?? message.from?.botId;
        // Membership is not consulted: removing a bot must not break files it already shared.
        if (!senderId) {
          return json(res, 403, { error: "the file's bot author could not be verified" });
        }
        const runThread = message.automation?.executionThreadId;
        const fromRun = runThread && store.botByThread(runThread)?.id === senderId ? messageFileRootsForThread(senderId, runThread) : [];
        // The bot's skills (its design kit, brand folders) are files it works from and points the person to.
        roots = [...new Set([...messageFileRootsForThread(senderId, threadId), ...fromRun, ...messageClientWorkRoots(senderId, threadId), join(homedir(), ".claude", "skills")])];
        // A teammate's request in this bot's chat names files from the teammate's own conversations.
        const author = message.from?.botId;
        if (author && author !== senderId && /^[\w-]+$/.test(author)) {
          roots = [...roots, ...messageFileRootsForThread(author, threadId), join(TASK_WORKSPACES_DIR, author)];
        }
      }

      const folderEntry = method === "POST" && body.entry !== undefined
        ? messageFolderEntryName(body.entry)
        : undefined;
      if (folderEntry === null) return json(res, 400, { error: "entry must be one file name" });
      let file: Awaited<ReturnType<typeof openMessageFile>>;
      try {
        file = folderEntry
          ? await openMessageFolderEntry(href, folderEntry, roots)
          : await openMessageFile(href, roots);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        const status = (error as { status?: unknown } | null)?.status;
        const name = message.role === "bot" && !botAttachment && !folderEntry && (code === "outside_workspace" || status === 404)
          ? referencedFileName(href)
          : null;
        const copy = name ? deliveredCopy(store.messagesFor(threadId), message, name) : null;
        if (copy) {
          file = await openMessageFile(copy.path, [ATTACHMENTS_DIR]);
          downloadName = copy.name;
        } else {
          // Only a client that asks for listings gets one; older clients keep the 400.
          if (body?.listFolder !== true || folderEntry || code !== "directory") throw error;
          const listing = await listMessageFolder(href, roots);
          res.setHeader("x-nordus-folder", "1");
          res.setHeader("cache-control", "private, no-store");
          return json(res, 200, listing);
        }
      }
      if ((streamsMessageImage || botAttachment?.kind === "image") && !file.mime.startsWith("image/")) {
        await file.handle.close();
        return json(res, 415, { error: "only images can be previewed here" });
      }
      if (streamsMessageMedia) {
        if (!file.mime.startsWith("video/") && !file.mime.startsWith("audio/")) {
          await file.handle.close();
          return json(res, 415, { error: "only audio and video can be streamed here" });
        }
        return streamStoredMedia(req, res, file);
      }
      if (servesMessageHtml) {
        if (!file.mime.startsWith("text/html")) {
          await file.handle.close();
          return json(res, 415, { error: "only html pages can be framed here" });
        }
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(file.bytes),
          "content-disposition": messageFileDisposition(messageFileDownloadName(downloadName, file.name), "inline"),
          "content-security-policy": HTML_FRAME_CSP,
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "cross-origin-resource-policy": "same-origin",
          "cache-control": "private, no-store",
          "cdn-cache-control": "no-store",
          "cloudflare-cdn-cache-control": "no-store",
          pragma: "no-cache",
          vary: "Authorization",
        });
        if (file.bytes === 0) {
          await file.handle.close();
          return res.end();
        }
        const htmlStream = file.handle.createReadStream({ start: 0, end: file.bytes - 1, autoClose: true });
        htmlStream.on("error", () => res.destroy());
        res.on("close", () => htmlStream.destroy());
        htmlStream.pipe(res);
        return;
      }
      res.writeHead(200, {
        "content-type": file.mime,
        "content-length": String(file.bytes),
        ...(streamsMessageImage
          ? { "content-disposition": "inline" }
          : { "content-disposition": messageFileDisposition(messageFileDownloadName(downloadName, file.name)) }),
        "cache-control": streamsMessageImage ? "private, max-age=3600" : "private, no-store",
        "cdn-cache-control": "no-store",
        "cloudflare-cdn-cache-control": "no-store",
        pragma: "no-cache",
        vary: "Authorization",
        "x-content-type-options": "nosniff",
        // Defence in depth: should an HTML page ever be served here, it downloads, and never runs in the app's origin.
        ...(file.mime.startsWith("text/html") || file.mime === "application/octet-stream" ? { "content-security-policy": "sandbox" } : {}),
        ...(streamsMessageImage
          ? {
              "cross-origin-resource-policy": "same-origin",
              "referrer-policy": "no-referrer",
            }
          : {}),
      });
      if (file.bytes === 0) {
        await file.handle.close();
        return res.end();
      }
      const stream = file.handle.createReadStream({ start: 0, end: file.bytes - 1, autoClose: true });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
      return;
    }

    // Raw bytes, not base64 JSON; retrying a UUID uploadId returns the same committed path.
    if (method === "POST" && path === "/api/attachments") {
      let uploadId: string | undefined;
      try {
        uploadId = validateAttachmentUploadId(url.searchParams.get("uploadId") ?? undefined);
      } catch (error) {
        req.resume();
        throw error;
      }
      const rawType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
      const mime = rawType?.split(";")[0]?.trim().toLowerCase();
      if (!mime || !extensionForMime(mime)) {
        return json(res, 400, { error: "content-type must be an image type" });
      }
      const rawLength = Array.isArray(req.headers["content-length"])
        ? req.headers["content-length"][0]
        : req.headers["content-length"];
      const declaredLength = rawLength === undefined ? undefined : Number(rawLength);
      if (declaredLength !== undefined && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
        req.resume();
        return json(res, 400, { error: "content-length must be a non-negative integer" });
      }
      if (declaredLength !== undefined && declaredLength > IMAGE_MAX_BYTES) {
        req.resume();
        return json(res, 413, { error: `image exceeds ${IMAGE_MAX_BYTES} bytes` });
      }
      const saved = await new Promise<SavedAttachment>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;
        const fail = (status: number, msg: string) => {
          if (settled) return;
          settled = true;
          reject(Object.assign(new Error(msg), { status }));
        };
        req.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.byteLength;
          if (received > IMAGE_MAX_BYTES) return fail(413, `image exceeds ${IMAGE_MAX_BYTES} bytes`);
          chunks.push(chunk);
        });
        req.on("end", async () => {
          if (settled) return;
          settled = true;
          try {
            resolve(await saveImageUpload(Buffer.concat(chunks), mime, uploadId));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
        req.on("error", (e) => fail(400, e instanceof Error ? e.message : String(e)));
      });
      return json(res, 201, saved);
    }

    // Raw bytes; a UUID uploadId is stable across retries, and the quota rejects rather than delete files old prompts reference.
    if (method === "POST" && path === "/api/files") {
      let uploadId: string | undefined;
      try {
        uploadId = validateAttachmentUploadId(url.searchParams.get("uploadId") ?? undefined);
      } catch (error) {
        req.resume();
        throw error;
      }
      const name = url.searchParams.get("name");
      if (!name) {
        req.resume();
        return json(res, 400, { error: "name is required" });
      }
      const rawType = Array.isArray(req.headers["content-type"])
        ? req.headers["content-type"][0]
        : req.headers["content-type"];
      const rawLength = Array.isArray(req.headers["content-length"])
        ? req.headers["content-length"][0]
        : req.headers["content-length"];
      const declaredLength = rawLength === undefined ? undefined : Number(rawLength);
      if (declaredLength !== undefined && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
        req.resume();
        return json(res, 400, { error: "content-length must be a non-negative integer" });
      }
      if (declaredLength !== undefined && declaredLength > fileMaxBytes(rawType)) {
        req.resume();
        return json(res, 413, { error: `file exceeds ${fileMaxBytes(rawType)} bytes` });
      }
      try {
        // Returning must not destroy the socket: the caller still sends the 4xx when the byte count crosses the limit.
        const chunks = req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>;
        const saved = await saveFile(chunks, name, rawType ?? "", { uploadId, expectedBytes: declaredLength });
        return json(res, 201, saved);
      } catch (error) {
        req.resume();
        throw error;
      }
    }

    // A big file in pieces, each under Cloudflare's 100 MB body limit: parts in order, then a completing call.
    // POST /api/files/parts?uploadId=&name=&offset=&total=  (content-type = the file's mime, body = the bytes from offset)
    // POST /api/files/parts/complete?uploadId=&name=&total= (content-type = the file's mime, empty body)
    if (method === "POST" && (path === "/api/files/parts" || path === "/api/files/parts/complete")) {
      const complete = path === "/api/files/parts/complete";
      const name = url.searchParams.get("name");
      const number = (key: string) => {
        const raw = url.searchParams.get(key);
        return raw !== null && /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;
      };
      const rawType = Array.isArray(req.headers["content-type"])
        ? req.headers["content-type"][0]
        : req.headers["content-type"];
      const rawLength = Array.isArray(req.headers["content-length"])
        ? req.headers["content-length"][0]
        : req.headers["content-length"];
      const declaredLength = rawLength === undefined ? undefined : Number(rawLength);
      if (!name) {
        req.resume();
        return json(res, 400, { error: "name is required" });
      }
      if (declaredLength !== undefined && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
        req.resume();
        return json(res, 400, { error: "content-length must be a non-negative integer" });
      }
      if (declaredLength !== undefined && declaredLength > FILE_PART_MAX_BYTES) {
        req.resume();
        return json(res, 413, { error: `part exceeds ${FILE_PART_MAX_BYTES} bytes` });
      }
      try {
        const uploadId = url.searchParams.get("uploadId") ?? undefined;
        if (complete) {
          req.resume();
          return json(res, 201, await completeFileParts(name, rawType ?? "", { uploadId, total: number("total") }));
        }
        const chunks = req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>;
        const progress = await saveFilePart(chunks, name, rawType ?? "", {
          uploadId,
          offset: number("offset"),
          total: number("total"),
        });
        return json(res, 200, progress);
      } catch (error) {
        req.resume();
        const received = (error as { received?: unknown }).received;
        const status = (error as { status?: unknown }).status;
        if (typeof received === "number" && typeof status === "number") {
          return json(res, status, { error: error instanceof Error ? error.message : String(error), received });
        }
        throw error;
      }
    }

    // Name-locked to the attachments dir: readAttachment refuses anything but a bare generated filename.
    m = path.match(/^\/api\/attachments\/([\w.-]+)$/);
    if (m && method === "GET") {
      const attachment = readAttachment(m[1]!);
      if (!attachment) return json(res, 404, { error: "no such attachment" });
      const size = attachment.bytes.byteLength;
      const headers = attachmentCacheHeaders(m[1]!, attachment.mime);
      if (headers.etag && ifNoneMatchHits(req.headers["if-none-match"], headers.etag)) {
        res.writeHead(304, { etag: headers.etag, "cache-control": headers["cache-control"] });
        return res.end();
      }
      {
        const rawRange = Array.isArray(req.headers.range) ? req.headers.range[0] : req.headers.range;
        const range = parseByteRange(rawRange, size);
        if (range.kind === "unsatisfiable") {
          res.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
          return res.end();
        }
        if (range.kind === "range") {
          res.writeHead(206, {
            ...headers,
            "content-length": String(range.end - range.start + 1),
            "content-range": `bytes ${range.start}-${range.end}/${size}`,
          });
          return res.end(attachment.bytes.subarray(range.start, range.end + 1));
        }
      }
      res.writeHead(200, { ...headers, "content-length": String(size) });
      return res.end(attachment.bytes);
    }

    if (method === "GET" && path === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit ? Math.min(Math.max(Number(rawLimit) || 0, 1), 100) : 40;
      const threadId = url.searchParams.get("threadId")?.trim() || undefined;
      if (threadId && ((!store.botByThread(threadId) && !store.groupByThread(threadId)) || !visible.thread(threadId))) {
        return json(res, 404, { error: "no such conversation" });
      }
      const activePaths = new Map<string, Set<string>>();
      const onActivePath = (threadId: string, messageId: string) => {
        let ids = activePaths.get(threadId);
        if (!ids) activePaths.set(threadId, (ids = new Set(store.activePath(threadId).map((m) => m.id))));
        return ids.has(messageId);
      };
      const found = await searchMessagesAsync(q, visible.everything ? limit : Math.min(limit * 10, 1_000), threadId);
      // A scan may outlive a revocation or audience edit: authorize again after the await.
      if (HOSTED_WORKSPACE && auth.kind === "session") {
        const failure = workspaceAccess ? await workspaceAccess.authorize(req, auth)
          : { status: 503, error: "Workspace sign-in is unavailable." };
        if (failure) return json(res, failure.status, { error: failure.error });
      }
      const current = resolveRequestAuth(req, {
        sessions, cookieName: SESSION_COOKIE, streamPath: "/api/events", url,
        loopbackMutationToken: desktopMutationToken, companionMutationToken,
        features: { sharedComputers: lendingEnabled() }, loopbackTrust: LOOPBACK.trust, cliOwnerToken, trustLocalBrowser: LOOPBACK.localBrowsers,
      });
      if (!current.auth) return json(res, current.status, { error: current.error, ...(current.code ? { code: current.code } : {}) });
      const currentVisible = visibleTo(viewerFor(current.auth));
      if (threadId && !currentVisible.thread(threadId)) return json(res, 404, { error: "no such conversation" });
      const hits = found
        .filter((hit) => currentVisible.thread(hit.threadId))
        .slice(0, limit)
        .map((hit) => {
          const bot = store.botByThread(hit.threadId);
          const group = bot ? undefined : store.groupByThread(hit.threadId);
          if (!bot && !group) return null;
          const active = onActivePath(hit.threadId, hit.messageId);
          if (bot) {
            const task = store.taskByThread(bot.id, hit.threadId);
            return { ...hit, botId: bot.id, name: bot.name, task: task?.title, onActivePath: active };
          }
          if (group) {
            const task = store.groupTaskByThread(group.id, hit.threadId);
            return { ...hit, groupId: group.id, name: group.name, task: task?.title, onActivePath: active };
          }
          return null;
        })
        .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
      return json(res, 200, { hits });
    }

    m = path.match(/^\/api\/threads\/([\w-]+)\/export$/);
    if (m && method === "GET") {
      const threadId = m[1];
      const bot = store.botByThread(threadId);
      const group = bot ? undefined : store.groupByThread(threadId);
      if (!bot && !group) return json(res, 404, { error: "no such conversation" });
      const format = url.searchParams.get("format") ?? "markdown";
      if (format !== "markdown" && format !== "json") {
        return json(res, 400, { error: "format must be markdown or json" });
      }
      const title = bot
        ? (store.taskByThread(bot.id, threadId)?.title || bot.name)
        : (store.groupTaskByThread(group!.id, threadId)?.title || group!.name);
      const filename = (title.replace(/[^\w\- ]+/g, "").trim() || "conversation").slice(0, 60);
      const messages = store.activePath(threadId).map((message) => presentedMessage(message, cfg.profile));
      if (format === "json") {
        const slim = messages.map(({ png: _png, mime: _mime, ...rest }) => rest);
        res.writeHead(200, {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="${filename}.json"`,
        });
        return res.end(JSON.stringify({ name: title, threadId, messages: slim }, null, 2));
      }
      const userName = cfg.profile?.name?.trim() || "User";
      const lines: string[] = [`# ${title}`, ""];
      for (const msg of messages) {
        const sentBy = msg.sender?.name ?? userName;
        const who = msg.role === "user"
          ? msg.via === "api" ? `${sentBy} (via the local API)` : sentBy
          : (msg.from?.name ?? bot?.name ?? "Bot");
        if ((msg.kind === "text" || msg.kind === "widget") && msg.text) lines.push(`**${who}:**`, "", msg.text, "");
        else if (msg.kind === "activity" && msg.tool) lines.push(`> ${msg.tool.name}`, "");
        else if (msg.kind === "screen") lines.push("> [screen capture]", "");
        else if (msg.kind === "options" && msg.card) {
          lines.push(`> ${msg.card.title}${msg.card.answered ? ` — answered: ${msg.card.answered}` : ""}`, "");
        }
      }
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.md"`,
      });
      return res.end(lines.join("\n"));
    }
    return PASS;
  };
  return async (ctx) => (await jobs(ctx) !== PASS || await handle(ctx) !== PASS ? undefined : PASS);
}
