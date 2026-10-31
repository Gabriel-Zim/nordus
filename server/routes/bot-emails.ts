// A bot's own inbox on its profile: list, open, attachments and "read". Each call checks the mail belongs to that bot.
import { MAILBOXES, mailboxAddresses, mailbotAvailable, mailbotFetch, MailbotError, mailOf, summaryOf } from "../mailbot.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotEmailRouteDeps {
  botExists: (botId: string) => boolean;
  mailboxes: { get(botId: string): string | null; set(botId: string, slug: string | null): void };
  fetcher?: typeof fetch;
}

/** Every mailbox a bot can be given, by its addresses, for the picker on the profile. */
const mailboxChoices = () => Object.keys(MAILBOXES).map((slug) => ({ id: slug, addresses: mailboxAddresses(slug) }));

const UNREACHABLE = "Não deu para abrir os e-mails agora. Tente de novo.";

export function createBotEmailRoutes({ botExists, mailboxes, fetcher = fetch }: BotEmailRouteDeps): RouteHandler {
  return async ({ req, res, path, method, url, json, readBody }) => {
    const choose = /^\/api\/bots\/([\w-]+)\/emails\/mailbox$/.exec(path);
    if (choose && method === "PUT") {
      if (!botExists(choose[1]!)) return json(res, 404, { error: "Bot não encontrado." });
      const body = await readBody(req, 4_096).catch(() => null) as { mailbox?: unknown } | null;
      const slug = body?.mailbox === null || body?.mailbox === "" ? null : typeof body?.mailbox === "string" && MAILBOXES[body.mailbox] ? body.mailbox : undefined;
      if (slug === undefined) return json(res, 400, { error: "Escolha uma das caixas." });
      mailboxes.set(choose[1]!, slug);
      return json(res, 200, { mailbox: slug, addresses: slug ? mailboxAddresses(slug) : [] });
    }
    const match = /^\/api\/bots\/([\w-]+)\/emails(?:\/([\w-]+)(?:\/(read|attachments\/(\d+)))?)?$/.exec(path);
    if (!match) return PASS;
    if (!botExists(match[1]!)) return json(res, 404, { error: "Bot não encontrado." });
    const slug = mailboxes.get(match[1]!);
    const emailId = match[2];
    if (!emailId && method === "GET") {
      const choice = { mailbox: slug, mailboxes: mailboxChoices() };
      if (!slug || !mailbotAvailable()) return json(res, 200, { ...choice, addresses: [], emails: [] });
      const query = new URLSearchParams({ bot: slug, limite: "100" });
      const search = url.searchParams.get("busca")?.trim();
      if (search) query.set("busca", search.slice(0, 200));
      if (url.searchParams.get("nao_lidos") === "1") query.set("nao_lidos", "1");
      try {
        const body = await (await mailbotFetch(`/emails?${query}`, {}, fetcher)).json() as { emails?: Record<string, unknown>[] };
        return json(res, 200, { ...choice, addresses: mailboxAddresses(slug), emails: (body.emails ?? []).filter((raw) => raw.bot === slug).map(summaryOf) });
      } catch {
        return json(res, 200, { ...choice, addresses: mailboxAddresses(slug), emails: [], error: UNREACHABLE });
      }
    }
    if (!emailId || !slug) return json(res, 404, { error: "E-mail não encontrado." });
    try {
      const raw = await (await mailbotFetch(`/emails/${encodeURIComponent(emailId)}`, {}, fetcher)).json() as Record<string, unknown>;
      const email = (raw.email ?? raw) as Record<string, unknown>;
      if (email.bot !== slug) return json(res, 404, { error: "E-mail não encontrado." });
      if (!match[3] && method === "GET") return json(res, 200, { email: mailOf(email) });
      if (match[3] === "read" && method === "POST") {
        await mailbotFetch(`/emails/${encodeURIComponent(emailId)}/lido`, { method: "POST" }, fetcher);
        return json(res, 200, { ok: true });
      }
      if (match[4] !== undefined && method === "GET") {
        const file = await mailbotFetch(`/emails/${encodeURIComponent(emailId)}/anexos/${match[4]}`, {}, fetcher);
        const attachment = mailOf(email).attachments.find((item) => item.n === Number(match[4]));
        const type = attachment?.type ?? file.headers.get("content-type") ?? "application/octet-stream";
        const filename = (attachment?.name ?? "anexo").replace(/["\r\n]/g, "");
        const bytes = Buffer.from(await file.arrayBuffer());
        res.writeHead(200, {
          // Shown inline only when it is an image; everything else downloads, so a mailed page never runs here.
          "content-type": type.startsWith("image/") && type !== "image/svg+xml" ? type : "application/octet-stream",
          "content-disposition": `${type.startsWith("image/") && type !== "image/svg+xml" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "content-length": String(bytes.length),
          "cache-control": "private, max-age=300",
          "x-content-type-options": "nosniff",
        });
        res.end(bytes);
        return;
      }
      return PASS;
    } catch (error) {
      return json(res, error instanceof MailbotError && error.status === 404 ? 404 : 502, { error: UNREACHABLE });
    }
  };
}
