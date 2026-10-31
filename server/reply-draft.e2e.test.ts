import { createServer, type ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { launchVerificationServer, runControlNordus } from "../scripts/control-nordus.ts";
import { openSse } from "./testing/sse.ts";
import { STOPPED_TURN_NAME } from "../shared/client-cancel.ts";

type ChatRequest = { messages: Array<{ role: string; content?: unknown }> };

const frame = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const lastUser = (request: ChatRequest) => {
  const content = request.messages.filter((message) => message.role === "user").at(-1)?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
};
const WORDS = Array.from({ length: 24 }, (_, i) => `palavra${i} `);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("streams a reply piece by piece, saves it under the draft's id, and keeps the partial text on Stop", async () => {
  const open = new Set<ServerResponse>();
  const upstream = createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const user = lastUser(JSON.parse(body) as ChatRequest);
    res.writeHead(200, { "content-type": "text/event-stream" });
    open.add(res);
    res.on("close", () => open.delete(res));
    const endless = user.includes("Escreva sem parar.");
    for (let i = 0; endless || i < WORDS.length; i++) {
      if (res.destroyed) return;
      res.write(frame({ content: WORDS[i % WORDS.length] }, null));
      await sleep(60);
    }
    res.end(frame({}, "stop") + "data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("fixture provider address missing");
  const fixture = await launchVerificationServer();
  const control = (args: string[]) => runControlNordus([...args, "--url", fixture.info.url]) as Promise<any>;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect(response.ok, JSON.stringify(result)).toBe(true);
    return result;
  };
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const stream = await openSse(`${fixture.info.url}/api/events`, { origin: fixture.info.url });
  const drafts = (threadId: string) => stream.frames
    .filter((candidate) => candidate.kind === "runtime" && candidate.event?.type === "content.delta" &&
      candidate.event.threadId === threadId && candidate.event.streamKind === "assistant_text")
    .map((candidate) => candidate.event.draft)
    .filter(Boolean);
  try {
    await api("PATCH", "/api/config", { openaiCompat: { key: "synthetic-fixture-key", url: `http://127.0.0.1:${address.port}/v1`, model: "fixture-model" } });
    const { bot } = await control(["new-bot", "--name", "Escritor"]);
    await control(["set-model", "--bot", bot.id, "--instance", "openaiCompat", "--model", "fixture-model"]);
    const threadId = bot.activeTaskId;

    expect((await control(["send", "--bot", bot.id, "--task", threadId, "--text", "Escreva devagar."])).success).toBe(true);
    const midway = await vi.waitFor(async () => {
      const { draft } = await api("GET", `/api/threads/${threadId}/reply-draft`);
      if (!draft?.text) throw new Error("waiting for the draft");
      return draft;
    }, { timeout: 15_000, interval: 50 });
    await control(["wait", "--bot", bot.id, "--task", threadId, "--timeout", "30"]);
    const pieces = drafts(threadId);
    expect(pieces.length).toBeGreaterThan(3);
    expect(new Set(pieces.map((piece) => piece.streamId))).toEqual(new Set([midway.streamId]));
    let text = "";
    for (const piece of pieces) {
      expect(piece.offset).toBe(text.length);
      text += piece.delta;
    }
    const reply = (await messages(threadId)).filter((message) => message.role === "bot" && message.kind === "text" && message.turnId);
    expect(reply).toHaveLength(1);
    expect(reply[0].streamId).toBe(midway.streamId);
    expect(text.length).toBeGreaterThan(0);
    expect(reply[0].text.startsWith(text)).toBe(true);
    expect((await api("GET", `/api/threads/${threadId}/reply-draft`)).draft).toBeNull();

    expect((await control(["send", "--bot", bot.id, "--task", threadId, "--text", "Escreva sem parar."])).success).toBe(true);
    const running = await vi.waitFor(async () => {
      const { draft } = await api("GET", `/api/threads/${threadId}/reply-draft`);
      if (!draft || draft.text.length < 40) throw new Error("waiting for some text");
      return draft;
    }, { timeout: 15_000, interval: 50 });
    await api("POST", `/api/bots/${bot.id}/interrupt`, { threadId });
    const kept = await vi.waitFor(async () => {
      const found = (await messages(threadId)).find((message) => message.streamId === running.streamId);
      if (!found) throw new Error("waiting for the kept reply");
      return found;
    }, { timeout: 15_000, interval: 100 });
    expect(kept).toMatchObject({ role: "bot", kind: "text", interrupted: true });
    expect(kept.text.startsWith(running.text.trim())).toBe(true);
    const after = await messages(threadId);
    expect(after.filter((message) => message.streamId === running.streamId)).toHaveLength(1);
    const keptIndex = after.findIndex((message) => message.streamId === running.streamId);
    const stoppedIndex = after.findIndex((message) => message.tool?.name === STOPPED_TURN_NAME);
    if (stoppedIndex >= 0) expect(stoppedIndex).toBeGreaterThan(keptIndex);
  } finally {
    stream.close();
    for (const res of open) res.destroy();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await fixture.close();
  }
}, 90_000);
