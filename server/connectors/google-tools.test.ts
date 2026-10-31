import { describe, expect, it } from "vitest";

import { buildMime, createGoogleClient, docText, googleErrorMessage, googleTools, messageBody } from "./google-tools.ts";

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const { status = 200, body = {}, headers = {} } = handler(call);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return { fetcher, calls };
}
const env = { account: "member@example.com", clientId: "cid", clientSecret: "csec", refresh: "r1" };
const auth = (call: Call) => new Headers(call.init?.headers).get("authorization");
const tool = (tools: ReturnType<typeof googleTools>, name: string) => tools.find((entry) => entry.name === name)!;

describe("Google client", () => {
  it("renews an expired access token from the refresh token once, then reuses it", async () => {
    const { fetcher, calls } = fakeFetch((call) => call.url.startsWith("https://oauth2")
      ? { body: { access_token: "fresh", expires_in: 3600 } }
      : { body: { ok: true } });
    const client = createGoogleClient({ ...env, access: "old", expiresAt: Date.now() - 1000 }, fetcher);
    await Promise.all([client.json("GET", "https://gmail.googleapis.com/x"), client.json("GET", "https://gmail.googleapis.com/y")]);
    expect(calls.filter((call) => call.url.startsWith("https://oauth2"))).toHaveLength(1);
    expect(String(calls[0]!.init?.body)).toContain("grant_type=refresh_token");
    expect(calls.filter((call) => !call.url.startsWith("https://oauth2")).map(auth)).toEqual(["Bearer fresh", "Bearer fresh"]);
  });

  it("renews and retries once when Google says the token is no longer valid", async () => {
    let first = true;
    const { fetcher, calls } = fakeFetch((call) => {
      if (call.url.startsWith("https://oauth2")) return { body: { access_token: "fresh", expires_in: 3600 } };
      if (first) { first = false; return { status: 401, body: { error: { message: "Invalid Credentials" } } }; }
      return { body: { ok: true } };
    });
    const client = createGoogleClient({ ...env, access: "valid", expiresAt: Date.now() + 3_600_000 }, fetcher);
    expect(await client.json("GET", "https://gmail.googleapis.com/x")).toEqual({ ok: true });
    expect(calls.map(auth)).toEqual(["Bearer valid", null, "Bearer fresh"]);
  });

  it("asks to connect again when the refresh token was revoked", async () => {
    const { fetcher } = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    const client = createGoogleClient(env, fetcher);
    await expect(client.json("GET", "https://gmail.googleapis.com/x")).rejects.toThrow(/Conecte a conta de novo/);
  });

  it("says which API is off in Google Cloud", () => {
    expect(googleErrorMessage(403, { error: { message: "Gmail API has not been used in project 1 before or it is disabled." } }, "https://gmail.googleapis.com/gmail/v1/users/me/messages"))
      .toBe("O Google ainda não liberou esse serviço para o app da Nordus: falta ativar a Gmail API no Google Cloud.");
  });
});

describe("Google tools", () => {
  it("lists e-mails with sender, subject and unread flag", async () => {
    const { fetcher, calls } = fakeFetch((call) => {
      if (call.url.includes("/messages?")) return { body: { messages: [{ id: "m1" }], resultSizeEstimate: 1 } };
      return { body: { id: "m1", threadId: "t1", labelIds: ["INBOX", "UNREAD"], snippet: "Oi", payload: { headers: [
        { name: "From", value: "Ana <ana@x.com>" }, { name: "Subject", value: "Proposta" }, { name: "Date", value: "Fri, 16 Oct 2026" },
      ] } } };
    });
    const tools = googleTools(createGoogleClient({ ...env, access: "a", expiresAt: Date.now() + 3_600_000 }, fetcher), env.account);
    const result = await tool(tools, "gmail_search").run({ query: "is:unread" }) as { messages: Array<Record<string, unknown>> };
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe("is:unread");
    expect(result.messages[0]).toMatchObject({ id: "m1", from: "Ana <ana@x.com>", subject: "Proposta", unread: true });
    expect(tool(tools, "gmail_search").description).toContain("member@example.com");
  });

  it("lists the next 7 days of events by default", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: { timeZone: "America/Sao_Paulo", items: [{ id: "e1", summary: "Reunião", start: { dateTime: "2026-10-17T10:00:00-03:00" } }] } }));
    const tools = googleTools(createGoogleClient({ ...env, access: "a", expiresAt: Date.now() + 3_600_000 }, fetcher), env.account);
    const result = await tool(tools, "calendar_list_events").run({}) as { events: Array<{ title: string }> };
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(Date.parse(url.searchParams.get("timeMax")!) - Date.parse(url.searchParams.get("timeMin")!)).toBe(7 * 86_400_000);
    expect(result.events[0]!.title).toBe("Reunião");
  });

  it("creates events without e-mailing guests unless asked", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: { id: "e1", summary: "Call" } }));
    const tools = googleTools(createGoogleClient({ ...env, access: "a", expiresAt: Date.now() + 3_600_000 }, fetcher), env.account);
    await tool(tools, "calendar_create_event").run({ title: "Call", start: "2026-10-20", end: "2026-10-21", attendees: ["a@x.com"] });
    expect(new URL(calls[0]!.url).searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ start: { date: "2026-10-20" }, attendees: [{ email: "a@x.com" }] });
  });

  it("takes a Google link where an id is expected", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ body: { documentId: "1AbCdEfGhIjK", title: "Roteiro", body: { content: [] } } }));
    const tools = googleTools(createGoogleClient({ ...env, access: "a", expiresAt: Date.now() + 3_600_000 }, fetcher), env.account);
    await tool(tools, "docs_read").run({ document_id: "https://docs.google.com/document/d/1AbCdEfGhIjK/edit" });
    expect(calls[0]!.url).toBe("https://docs.googleapis.com/v1/documents/1AbCdEfGhIjK");
  });
});

describe("Google helpers", () => {
  it("builds a UTF-8 message Gmail accepts", () => {
    const raw = Buffer.from(buildMime({ to: ["a@x.com"], subject: "Orçamento", body: "Olá, tudo bem?" }), "base64url").toString("utf8");
    expect(raw).toContain("To: a@x.com");
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("Orçamento").toString("base64")}?=`);
    expect(Buffer.from(raw.split("\r\n\r\n")[1]!, "base64").toString("utf8")).toBe("Olá, tudo bem?");
  });

  it("keeps header injection out of a subject", () => {
    const raw = Buffer.from(buildMime({ to: ["a@x.com"], subject: "Oi\r\nBcc: evil@x.com", body: "" }), "base64url").toString("utf8");
    expect(raw).not.toMatch(/\r\nBcc:/);
  });

  it("reads the plain text and attachment names of a message", () => {
    const data = (value: string) => Buffer.from(value).toString("base64url");
    const body = messageBody({ mimeType: "multipart/mixed", parts: [
      { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: data("Texto") } }, { mimeType: "text/html", body: { data: data("<p>HTML</p>") } }] },
      { mimeType: "application/pdf", filename: "nota.pdf", body: { attachmentId: "x", size: 10 } },
    ] });
    expect(body).toEqual({ text: "Texto", attachments: [{ name: "nota.pdf", mimeType: "application/pdf", size: 10 }] });
    expect(messageBody({ mimeType: "text/html", body: { data: data("<p>Oi&nbsp;Ana</p><br>tchau") } }).text).toBe("Oi Ana\n\ntchau");
  });

  it("flattens a document's paragraphs and tables", () => {
    expect(docText([
      { paragraph: { elements: [{ textRun: { content: "Título\n" } }] } },
      { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "A\n" } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: "B\n" } }] } }] }] }] } },
    ])).toBe("Título\nA | B\n");
  });
});
