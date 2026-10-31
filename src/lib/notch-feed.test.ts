import { beforeEach, describe, expect, it } from "vitest";
import { parseNotchFeed } from "../../electron/notch-ipc.mjs";
import { pendingApprovals } from "@/components/PendingApproval";
import { setLocale } from "@/lib/i18n";
import { CRITTER_COLORS } from "@/lib/mascot";
import type { Bot, Message, Task } from "@/state/store";
import { answerableFromNotch, buildNotchFeed, decidableFromNotch, waitingElsewhere } from "./notch-feed";

const SENSITIVE_HOLD = "approval.held.sensitive";

const card = (extra: Partial<NonNullable<Message["card"]>> = {}): Message => ({
  id: "approval-1", role: "bot", kind: "options", at: 1,
  card: { title: "Approval needed", subtitle: "pnpm build", options: ["Allow", "Deny"], requestId: "req-1", tool: "Bash", intent: "publicar o carrossel", ...extra },
});
const task = (threadId: string, extra: Partial<Task> = {}): Task => ({ threadId, title: threadId, createdAt: 1, ...extra });
const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-main`, name: id[0]!.toUpperCase() + id.slice(1), title: "", description: "", color: "blue", notifications: false,
  unread: false, messages: [], modelSelection: { instanceId: "fake", model: "fake" }, tasks: [task(`${id}-main`)], ...extra,
});

beforeEach(() => setLocale("en"));

describe("who is working", () => {
  it("lists the bots whose conversation is working, newest first, with a short status in plain words", () => {
    const maya = bot("maya", { color: "pink", tasks: [task("maya-main", { activity: "working", turnStartedAt: 10, doing: "Gerando imagem" })] });
    const caio = bot("caio", { color: "green", tasks: [task("caio-main", { activity: "working", turnStartedAt: 20 })] });
    const idle = bot("rita");

    const { wire } = buildNotchFeed([maya, idle, caio]);

    expect(wire.agents.map((agent) => agent.id)).toEqual(["caio", "maya"]);
    expect(wire.agents[1]).toEqual({ id: "maya", name: "Maya", color: CRITTER_COLORS.pink.toLowerCase(), status: "Gerando imagem", botId: "maya", threadId: "maya-main" });
    expect(wire.agents[0]!.status).toBe("Working");
    expect(wire.approvals).toEqual([]);
  });

  it("finds the conversation that is working when it is not the open one", () => {
    const maya = bot("maya", { tasks: [task("maya-main"), task("maya-report", { busy: true })] });
    expect(buildNotchFeed([maya]).wire.agents[0]!.threadId).toBe("maya-report");
  });

  it("falls back to the bot's own flag when it has no conversation list", () => {
    expect(buildNotchFeed([bot("maya", { tasks: undefined, busy: true })]).wire.agents).toHaveLength(1);
    expect(buildNotchFeed([bot("maya", { tasks: undefined, busy: true, activity: "waiting-on-you" })]).wire.agents).toHaveLength(0);
  });

  it("leaves out hidden bots, and bots that only wait for the person", () => {
    const waiting = bot("maya", { busy: true, tasks: [task("maya-main", { activity: "waiting-on-you", busy: true })] });
    const quiet = bot("caio", { hidden: true, tasks: [task("caio-main", { activity: "working" })] });
    expect(buildNotchFeed([waiting, quiet]).wire.agents).toEqual([]);
  });
});

describe("what waits for the person", () => {
  const waiting = (messages: Message[], extra: Partial<Bot> = {}) =>
    bot("maya", { messages, tasks: [task("maya-main", { activity: "waiting-on-you", updatedAt: 5 })], ...extra });

  it("shows the plain sentence of an ordinary permission and lets the notch answer it", () => {
    const { wire, answers } = buildNotchFeed([waiting([card()])]);

    expect(wire.approvals).toEqual([{
      id: "maya-main:req-1",
      name: "Maya",
      color: CRITTER_COLORS.blue.toLowerCase(),
      header: "Maya asks for your approval",
      text: "I want to publicar o carrossel.",
      decidable: true,
      botId: "maya",
      threadId: "maya-main",
    }]);
    expect(answers.get("maya-main:req-1")).toEqual({ botId: "maya", threadId: "maya-main", requestId: "req-1" });
  });

  it("a critical action is shown but only the app can answer it", () => {
    const { wire, answers } = buildNotchFeed([waiting([card({ heldCode: SENSITIVE_HOLD })])]);
    expect(wire.approvals[0]!.decidable).toBe(false);
    expect(wire.approvals[0]!.text).toBe("I want to publicar o carrossel.");
    expect(answers.size).toBe(0);
  });

  it("a proposal that has to be reviewed is shown but never answered from the notch", () => {
    const proposal = card({ tool: "propose_routine", routineRequest: { operation: { action: "create" } } as never });
    const pending = pendingApprovals([proposal])[0]!;
    expect(answerableFromNotch(pending)).toBe(false);

    const { wire, answers } = buildNotchFeed([waiting([proposal])]);
    expect(wire.approvals[0]!.decidable).toBe(false);
    expect(answers.size).toBe(0);
  });

  it("an expired request is not answerable", () => {
    const pending = pendingApprovals([card()])[0]!;
    expect(answerableFromNotch(pending)).toBe(true);
    expect(answerableFromNotch({ ...pending, message: { ...pending.message, card: { ...pending.message.card!, expired: true } } })).toBe(false);
  });

  it("without the request in hand it says who needs the person and sends them to the app", () => {
    const { wire, answers } = buildNotchFeed([waiting([])]);
    expect(wire.approvals).toEqual([expect.objectContaining({ id: "maya-main:waiting", text: "Maya needs you", decidable: false })]);
    expect(answers.size).toBe(0);
  });

  it("reads the request of another conversation from what was fetched for it", () => {
    const other = bot("maya", { threadId: "maya-main", tasks: [task("maya-main", { activity: "working" }), task("maya-report", { activity: "waiting-on-you", updatedAt: 9 })] });
    const pending = pendingApprovals([card({ requestId: "req-9" })])[0];

    expect(waitingElsewhere([other])).toEqual([{ threadId: "maya-report", version: "9" }]);

    const found = buildNotchFeed([other], new Map([["maya-report", pending]]));
    expect(found.wire.approvals[0]).toMatchObject({ id: "maya-report:req-9", decidable: true, threadId: "maya-report" });
    expect(found.answers.get("maya-report:req-9")).toEqual({ botId: "maya", threadId: "maya-report", requestId: "req-9" });
    expect(found.wire.agents.map((agent) => agent.id)).toEqual(["maya"]);

    const unread = buildNotchFeed([other]);
    expect(unread.wire.approvals[0]).toMatchObject({ id: "maya-report:waiting", decidable: false });
  });

  it("a routine's own run never asks from the notch", () => {
    const run = bot("maya", { tasks: [task("maya-main"), task("maya-run", { activity: "waiting-on-you", routineRunId: "run-1" })] });
    expect(buildNotchFeed([run]).wire.approvals).toEqual([]);
    expect(waitingElsewhere([run])).toEqual([]);
  });

  it("the request waiting longest comes first", () => {
    const a = bot("maya", { messages: [card({ requestId: "a" })], tasks: [task("maya-main", { activity: "waiting-on-you", attentionAt: 50 })] });
    const b = bot("caio", { messages: [card({ requestId: "b" })], tasks: [task("caio-main", { activity: "waiting-on-you", attentionAt: 20 })] });
    expect(buildNotchFeed([a, b]).wire.approvals.map((entry) => entry.id)).toEqual(["caio-main:b", "maya-main:a"]);
  });
});

describe("what the notch may answer", () => {
  type CardData = NonNullable<Message["card"]>;
  const waiting = (messages: Message[]) => bot("maya", { messages, tasks: [task("maya-main", { activity: "waiting-on-you", updatedAt: 5 })] });
  const outbound = (extra: Partial<CardData> = {}) => card({
    title: "Send on your behalf?", subtitle: "Send an email to ana@example.com", requestId: "req-out", tool: "GMAIL_SEND_EMAIL", intent: undefined,
    held: "This sends something on your behalf, so it always asks first.", heldCode: "approval.held.outbound",
    outboundRequest: { tool: "GMAIL_SEND_EMAIL", app: "gmail" }, ...extra,
  });
  const memory = (extra: Partial<CardData> = {}) => card({
    title: "Remember this for the team?", subtitle: "Client: Lumon, prefers short emails", options: ["Remember", "Skip"], requestId: "mem-1", tool: "propose_team_memory", intent: undefined,
    teamMemoryRequest: { section: "clients", entryId: "mem-1", kind: "client" }, ...extra,
  });
  const onlyTheApp = (message: Message) => {
    const { wire, answers } = buildNotchFeed([waiting([message])]);
    expect(wire.approvals).toHaveLength(1);
    expect(wire.approvals[0]!.decidable).toBe(false);
    expect(answers.size).toBe(0);
    return wire.approvals[0]!;
  };

  it("an e-mail about to be sent is shown but only the app can send it", () => {
    onlyTheApp(outbound());
  });

  it("code run through a connected app is shown but only the app can allow it", () => {
    const row = onlyTheApp(outbound({
      subtitle: "COMPOSIO_PROXY_EXECUTE", requestId: "req-proxy", tool: "COMPOSIO_PROXY_EXECUTE",
      outboundRequest: { tool: "COMPOSIO_PROXY_EXECUTE", app: null },
    }));
    expect(row.text).toBe("Run code on Composio?");
  });

  it("a suggestion for the team's memory is shown but only the app can accept it", () => {
    onlyTheApp(memory());
  });

  it("the oldest card speaks for the row, so an old suggestion keeps an ordinary permission behind it out of the notch", () => {
    const { wire, answers } = buildNotchFeed([waiting([memory(), card({ requestId: "req-2" })])]);
    expect(wire.approvals.map((entry) => ({ id: entry.id, decidable: entry.decidable }))).toEqual([{ id: "maya-main:mem-1", decidable: false }]);
    expect(answers.size).toBe(0);
  });

  it("a request to loosen the safety limits is shown but only the app can allow it", () => {
    onlyTheApp(card({ heldCode: "approval.held.sandbox", held: "This loosens the AI's own safety limits, so only Full access can approve it automatically." }));
  });

  it("an approval that could not be delivered earlier is not answered from the notch", () => {
    onlyTheApp(card({ heldCode: "approval.held.undelivered", held: "Approve for me couldn't answer this one." }));
    onlyTheApp(card({ heldCode: "approval.held.undeliveredFull", held: "Full access couldn't deliver this approval." }));
  });

  it("a hold nobody here has met, or a reason without its code, stays with the app", () => {
    onlyTheApp(card({ heldCode: "approval.held.somethingNew" }));
    onlyTheApp(card({ held: "This conversation is from before this update." }));
  });

  it("a kind of request nobody here has met stays with the app", () => {
    onlyTheApp(card({ futureRequest: { version: 1 } } as Partial<CardData>));
  });

  it("a question is never an approval", () => {
    onlyTheApp(card({ requestType: "question", options: ["Yes", "No"] }));
  });

  it("an ordinary permission, with or without the provider's own requirement, can be answered", () => {
    for (const extra of [{}, { requestType: "permission" as const }, { heldCode: "approval.held.native", held: "The provider requires your approval for this action." }, { outboundRequest: undefined, questionRequest: undefined }]) {
      const { wire, answers } = buildNotchFeed([waiting([card(extra)])]);
      expect(wire.approvals[0]!.decidable).toBe(true);
      expect(answers.get("maya-main:req-1")).toEqual({ botId: "maya", threadId: "maya-main", requestId: "req-1" });
    }
  });

  describe("the rule on the card alone", () => {
    const decidable = (extra: Partial<CardData>) => decidableFromNotch(card(extra).card);

    it("lets an ordinary permission through and nothing without a card", () => {
      expect(decidable({})).toBe(true);
      expect(decidableFromNotch(undefined)).toBe(false);
    });

    it("lets the provider's own requirement through and turns every other hold away", () => {
      expect(decidable({ heldCode: "approval.held.native", held: "The provider requires your approval for this action." })).toBe(true);
      for (const heldCode of [SENSITIVE_HOLD, "approval.held.outbound", "approval.held.sandbox", "approval.held.undelivered", "approval.held.undeliveredFull", "approval.held.other"]) {
        expect(decidable({ heldCode })).toBe(false);
      }
      expect(decidable({ held: "Held for a reason with no code" })).toBe(false);
    });

    it("turns away anything that carries a payload to review, known or not", () => {
      const payloads = ["outboundRequest", "teamMemoryRequest", "routineRequest", "skillRequest", "profileRequest", "teamSetupRequest", "modelRequest", "lessonRequest", "appSettingRequest", "mcpServerRequest", "questionRequest", "webhookRequest", "appTriggerRequest", "futureRequest"];
      for (const key of payloads) expect(decidable({ [key]: { version: 1 } } as Partial<CardData>)).toBe(false);
      for (const key of payloads) expect(decidable({ [key]: undefined } as Partial<CardData>)).toBe(true);
    });

    it("turns away a critical action: it is approved by holding the button on its card", () => {
      for (const subtitle of ["pnpm publish", "git push origin main", "rm -rf /"]) expect(decidable({ subtitle }), subtitle).toBe(false);
    });

    it("turns away what has run out or is not a permission", () => {
      expect(decidable({ expired: true })).toBe(false);
      expect(decidable({ requestType: "question" })).toBe(false);
    });
  });
});

describe("the snapshot the desktop receives", () => {
  it("passes the desktop's own validation untouched", () => {
    const maya = bot("maya", { tasks: [task("maya-main", { activity: "working", turnStartedAt: 3, doing: "Gerando imagem" })] });
    const caio = bot("caio", { messages: [card()], tasks: [task("caio-main", { activity: "waiting-on-you" })] });
    const { wire } = buildNotchFeed([maya, caio]);

    const parsed = parseNotchFeed(wire);

    expect(parsed).not.toBeNull();
    expect(parsed!.agents).toEqual(wire.agents);
    expect(parsed!.approvals).toEqual(wire.approvals);
    expect(parsed!.labels).toEqual(wire.labels);
  });

  it("speaks the person's language and leaves the count to the desktop", () => {
    setLocale("pt-br");
    const { wire } = buildNotchFeed([]);
    expect(wire.labels).toEqual({ done: "Pronto", approve: "Aprovar", decline: "Recusar", open: "Abrir no app", several: "{count} agentes" });
  });

  it("is empty when nothing happens", () => {
    expect(buildNotchFeed([bot("maya")]).wire).toMatchObject({ agents: [], approvals: [] });
  });
});
