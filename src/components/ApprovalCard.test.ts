import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApprovalCard } from "./ApprovalCard";
import { approvalNaturalText, pendingApprovals, spokenApprovalPrompt, toPending, type Pending } from "./PendingApproval";
import { StoreProvider, type Bot, type Message } from "@/state/store";
import { skillRequestBehavior } from "../../shared/skill-request";

const viewer = { ownerOrAdmin: null as boolean | null };
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => viewer.ownerOrAdmin }));

/** Everything the person sees before opening "Ver detalhes": the card up to its folded details. */
const visibleRow = (html: string) => (html.includes('id="approval-details-') ? html.slice(0, html.indexOf('id="approval-details-')) : html);
const detailsOf = (html: string) => html.slice(html.indexOf('id="approval-details-'));
const renderCard = (props: Parameters<typeof ApprovalCard>[0]) =>
  renderToStaticMarkup(createElement(StoreProvider, null, createElement(ApprovalCard, props)));

const routineRequest = {
  version: 1 as const,
  requestId: "routine-request",
  botId: "bot-1",
  threadId: "thread-1",
  createdAt: 1,
};

const createRoutineOperation = {
  action: "create" as const,
  routine: {
    name: "Backlog review",
    instructions: "Review every item in the backlog.",
    schedule: { type: "daily" as const, time: "09:00", weekdays: [1, 2, 3, 4, 5] },
    runOn: "nordus" as const,
    durationMinutes: 30,
  },
};

describe("ApprovalCard decided by voice", () => {
  const bash = (answered: string, via?: "call" | "reaction"): Message => ({
    id: "bash-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: "rm -rf build",
      options: ["Allow", "Deny"],
      requestId: "r1",
      tool: "Bash",
      answered,
      answeredBy: { kind: "loopback", ...(via ? { via } : {}) },
    },
  });

  it("says a card was decided by voice on a Live call", () => {
    const allowed = renderToStaticMarkup(createElement(ApprovalCard, { message: bash("allow", "call") }));
    expect(allowed).toContain("You allowed");
    expect(allowed).toContain("by voice");
    const denied = renderToStaticMarkup(createElement(ApprovalCard, { message: bash("deny", "call") }));
    expect(denied).toContain("You denied");
    expect(denied).toContain("by voice");
  });

  it("says a card was decided by a 👍 or 👎 on it", () => {
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message: bash("allow", "reaction") }))).toMatch(/You allowed.*by reaction/);
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message: bash("deny", "reaction") }))).toMatch(/You denied.*by reaction/);
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message: bash("allow", "reaction") }))).not.toContain("by voice");
  });

  it("says nothing extra for a tap", () => {
    const tapped = renderToStaticMarkup(createElement(ApprovalCard, { message: bash("allow") }));
    expect(tapped).not.toContain("by voice");
    expect(tapped).not.toContain("by reaction");
  });
});

describe("ApprovalCard routine proposals", () => {
  it("shows a routine card left open from before Triggers v2 as expired, with nothing to confirm", () => {
    const message: Message = {
      id: "routine-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Confirm routine",
        subtitle: "Weekdays at 09:00",
        options: ["Confirm", "Cancel"],
        requestId: "routine-request",
        tool: "schedule_routine",
        routineRequest: { ...routineRequest, operation: createRoutineOperation },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(visibleRow(markup)).toContain("Confirm this routine");
    expect(visibleRow(markup)).not.toContain("schedule_routine");
    expect(detailsOf(markup)).toContain("Weekdays at 09:00");
  });

  it("records the exact routine action after confirmation", () => {
    const message: Message = {
      id: "routine-delete-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Delete “Daily inbox”?",
        subtitle: "Delete “Daily inbox”?\nWhen: Weekdays at 09:00",
        options: ["Confirm", "Cancel"],
        answered: "allow",
        requestId: "routine-request",
        tool: "manage_routine",
        routineRequest: {
          ...routineRequest,
          operation: { action: "delete", routineId: "routine-1", expectedUpdatedAt: 1 },
        },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(markup).toContain("You allowed");
    expect(markup).toContain("Routine deleted");
    expect(markup).not.toContain("Daily inbox");
  });

  it("does not imply a run-now request has already started", () => {
    const message: Message = {
      id: "routine-run-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Run now “Daily inbox”?",
        subtitle: "Action: Run routine now\nName: Daily inbox",
        options: ["Confirm", "Cancel"],
        answered: "allow",
        requestId: "routine-request",
        tool: "manage_routine",
        routineRequest: {
          ...routineRequest,
          operation: { action: "run_now", routineId: "routine-1", expectedUpdatedAt: 1 },
        },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(markup).toContain("Routine run queued");
    expect(markup).not.toContain("Routine started");
  });
});

describe("ApprovalCard profile proposals", () => {
  const card = (answered?: string) => ({
    title: "Set up Scout?",
    subtitle: 'Why: you asked\nName: "Scout" → "Kiwi"\nSOUL.md (0 → 9 bytes):\n+Be brief.\nChanges what Scout is told on every turn. Nothing runs.',
    options: ["Confirm", "Cancel"],
    requestId: "req-p1",
    tool: "update_profile",
    answered,
    profileRequest: {
      version: 1 as const, requestId: "req-p1", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
      createdAt: 1, reason: "you asked", changes: { name: "Kiwi", soul: "Be brief." }, before: { name: "Scout", soul: "" }, expectedRevision: "r",
    },
  });

  const bot = { id: "bot-1", name: "Scout" } as never as Bot;

  it("describes a profile proposal as a profile update and shows the diff", () => {
    const message: Message = {
      id: "profile-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: card(),
    };

    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message }));
    expect(visibleRow(html)).toContain("I want to change my standing instructions.");
    expect(visibleRow(html)).not.toContain("update_profile");
    expect(visibleRow(html)).not.toContain("+Be brief.");
    expect(detailsOf(html)).toContain("+Be brief.");
    expect(detailsOf(html)).toContain("Nothing runs.");
  });

  it("records Profile updated after confirmation", () => {
    const message: Message = {
      id: "profile-card-answered",
      role: "bot",
      kind: "options",
      at: 1,
      card: card("allow"),
    };

    expect(renderToStaticMarkup(createElement(ApprovalCard, { bot, message }))).toContain("Profile updated");
  });

  it("names the actual target in the header when a Chief proposes for a peer", () => {
    const crossCard = card();
    crossCard.profileRequest = {
      ...crossCard.profileRequest,
      targetBotId: "bot-2",
      targetName: "Peer",
    };
    const message: Message = {
      id: "profile-card-cross",
      role: "bot",
      kind: "options",
      at: 1,
      card: crossCard,
    };

    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message }));
    expect(visibleRow(html)).toContain("Scout asks for your approval");
    expect(visibleRow(html)).toContain("I want to change the standing instructions of @Peer.");
    expect(visibleRow(html)).not.toContain("my standing instructions");
  });

  it("speaks the card's concise title, not the full diff, and writes the request in first person", () => {
    const message: Message = {
      id: "profile-voice-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: card(),
    };
    const pending: Pending = {
      message,
      requestId: "req-p1",
      tool: "update_profile",
      detail: message.card!.subtitle,
    };

    const spoken = spokenApprovalPrompt(pending, "Mochi");
    expect(spoken).toBe('Mochi wants to update its profile: Set up Scout?. Review the change on screen. Should I confirm it?');
    expect(spoken).not.toContain("SOUL.md");
    expect(spoken).not.toContain("+Be brief.");

    expect(approvalNaturalText(pending)).toBe("I want to change my standing instructions.");
  });
});

describe("ApprovalCard soul batches", () => {
  const names = ["LUMON", "FABRIKAM", "EVERGREEN", "SOCIAL", "MontadorDeVideo", "GerenteDeOperacao"];
  const items = names.map((name, index) => ({
    itemId: `item-${index}`, targetBotId: name === "GerenteDeOperacao" ? "bot-1" : `bot-${name}`, targetName: name, reason: "Padronizar o tom",
    changes: { soul: `Calm tone for ${name}.` }, before: { soul: "Old rules." }, expectedRevision: "r",
  }));
  const batch = (overrides: Partial<NonNullable<Message["card"]>> = {}, outcomes: Array<{ state: "applied"; appliedAt: number } | { state: "stale" }> = []): Message => ({
    id: "soul-batch",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Update 6 bot profiles?",
      subtitle: "@LUMON: standing instructions",
      options: ["Confirm", "Cancel"],
      requestId: "batch-1",
      tool: "update_profile",
      profileRequest: {
        version: 2, requestId: "batch-1", botId: "bot-1", threadId: "thread-1", createdAt: 1, turnKey: "t", reviewKey: "key-1",
        items: items.map((item, index) => (outcomes[index] ? { ...item, outcome: outcomes[index] } : item)),
      },
      ...overrides,
    },
  });
  const bot = { id: "bot-1", name: "GerenteDeOperacao" } as never as Bot;

  it("asks once for the whole list, names every bot and its change, and answers with Approve or Refuse", () => {
    const html = renderCard({ bot, message: batch(), threadId: "thread-1" });
    expect(visibleRow(html)).toContain("I want to change the standing instructions of 6 bots.");
    for (const name of names) expect(visibleRow(html)).toContain(`@${name}`);
    expect(visibleRow(html)).toContain(">Approve<");
    expect(visibleRow(html)).toContain(">Refuse<");
    expect(visibleRow(html)).not.toContain(">Confirm<");
    expect(detailsOf(html)).toContain("+Calm tone for FABRIKAM.");
    expect(detailsOf(html)).toContain("-Old rules.");
  });

  it("says how much of the list applied and which bot was left out", () => {
    const applied = { state: "applied" as const, appliedAt: 2 };
    const html = renderCard({ bot, message: batch({ answered: "allow" }, [applied, { state: "stale" }, applied, applied, applied, applied]) });
    expect(html).toContain("5 of 6 applied");
    expect(html).toContain("FABRIKAM");
    expect(renderCard({ bot, message: batch({ answered: "allow" }, Array(6).fill(applied)) })).toContain("6 changes applied");
  });

  it("keeps Confirm and Cancel for a profile change without standing instructions", () => {
    const message = batch();
    message.card!.profileRequest = { ...message.card!.profileRequest!, items: [{ ...items[0]!, changes: { title: "Copywriter" }, before: { title: "" } }] } as never;
    const html = renderCard({ bot, message, threadId: "thread-1" });
    expect(visibleRow(html)).toContain(">Confirm<");
    expect(visibleRow(html)).toContain("I want to update the profile of @LUMON.");
  });

  it("shows a batch's toggles as on and off and an empty folder as the bot's private folder", () => {
    const message = batch();
    message.card!.profileRequest = { ...message.card!.profileRequest!, items: [
      { ...items[0]!, changes: { notifications: false, speakReplies: true }, before: { notifications: true, speakReplies: false } },
      { ...items[1]!, changes: { cwd: "" }, before: { cwd: "/work/fabrikam" } },
      { ...items[2]!, changes: { cwd: "/work/evergreen" }, before: { cwd: "" } },
    ] } as never;
    const details = detailsOf(renderCard({ bot, message, threadId: "thread-1" })).replaceAll("&#x27;", "'");
    expect(details).toContain("alerts: on → off");
    expect(details).toContain("spoken replies: off → on");
    expect(details).toContain("working folder: /work/fabrikam → FABRIKAM's private folder");
    expect(details).toContain("working folder: EVERGREEN's private folder → /work/evergreen");
    expect(details).not.toContain("true");
  });

  it("speaks a short prompt for a batch", () => {
    const message = batch();
    const pending: Pending = { message, requestId: "batch-1", tool: "update_profile", detail: message.card!.subtitle };
    expect(spokenApprovalPrompt(pending, "GerenteDeOperacao")).toBe("GerenteDeOperacao wants to change 6 bot profiles. Review the changes on screen. Should I approve them?");
  });
});

describe("ApprovalCard learned skills", () => {
  it("names the teammates on a shared learned-skill receipt and who kept their own", () => {
    const message: Message = {
      id: "skill-receipt",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: 'Skill "rough-cut" enabled',
        subtitle: "Cuts a rough edit.",
        options: [],
        answered: "allow",
        autoApplied: true,
        requestId: "skill-receipt",
        tool: "stage_skill",
        skillRequest: {
          version: 1,
          requestId: "skill-receipt",
          botId: "bot-1",
          threadId: "thread-1",
          stagedId: "staged-1",
          action: "create",
          name: "rough-cut",
          gist: "Cuts a rough edit.",
          warnings: [],
          createdAt: 1,
          shared: {
            library: "installed",
            sha256: "ab".repeat(32),
            sharedAt: 1,
            assigned: [{ botId: "bot-1", name: "Cutter" }, { botId: "bot-2", name: "Colorist" }],
            skipped: [{ botId: "bot-3", name: "Sound", reason: "has its own skill" }],
          },
        },
      },
    };
    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message, threadId: "thread-1" }));
    expect(markup).toContain("shared with Colorist");
    expect(markup).not.toContain("shared with Cutter");
    expect(markup).toContain("not shared with Sound");
    expect(markup).not.toContain("Share with team");
  });

  it("maps create and update choices to approval while keeping refusals denied", () => {
    expect(skillRequestBehavior("Enable")).toBe("allow");
    expect(skillRequestBehavior("Update")).toBe("allow");
    expect(skillRequestBehavior("Apply")).toBe("allow");
    expect(skillRequestBehavior("Deny")).toBe("deny");
    expect(skillRequestBehavior("Dismiss")).toBe("deny");
    expect(skillRequestBehavior("unexpected")).toBe("deny");
  });

  it("describes a staged skill as enablement rather than a raw tool call", () => {
    const message: Message = {
      id: "skill-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: 'Enable skill "file-expense"?',
        subtitle: "Files an expense in the company portal.",
        options: ["Enable", "Deny"],
        requestId: "skill-request",
        tool: "stage_skill",
        skillRequest: {
          version: 1,
          requestId: "skill-request",
          botId: "bot-1",
          threadId: "thread-1",
          stagedId: "staged-1",
          action: "create",
          name: "file-expense",
          gist: "Files an expense in the company portal.",
          source: "learn:conversation",
          preview: "---\nname: file-expense\ndescription: Files an expense.\n---\n\n# File expense\n",
          sha256: "abcdef0123456789".repeat(4),
          warnings: [],
          createdAt: 1,
        },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(visibleRow(markup)).toContain("Enable this learned skill");
    expect(markup).toContain("Files an expense in the company portal.");
    expect(markup).toContain("Review the complete SKILL.md before enabling");
    expect(markup).toContain("Source: learn:conversation");
    expect(markup).toContain("name: file-expense");
    expect(markup).toContain("sha256 abcdef01");

    const spoken = spokenApprovalPrompt(
      { message, requestId: "skill-request", tool: "stage_skill", detail: message.card!.subtitle },
      "Mochi",
    );
    expect(spoken).toContain('Enable skill "file-expense"?');
    expect(spoken).toContain("Should I enable it?");
  });

  it("labels a reviewed skill replacement as an update", () => {
    const message: Message = {
      id: "skill-update",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: 'Update skill "verify-app"?',
        subtitle: "Refreshes the verified workflows.",
        options: ["Update", "Deny"],
        requestId: "skill-update-request",
        tool: "stage_skill",
        skillRequest: {
          version: 1,
          requestId: "skill-update-request",
          botId: "bot-1",
          threadId: "thread-1",
          stagedId: "staged-update",
          action: "update",
          name: "verify-app",
          gist: "Refreshes the verified workflows.",
          source: "learn:maintenance",
          preview: "---\nname: verify-app\ndescription: Verifies the app.\n---\n",
          sha256: "abcdef0123456789".repeat(4),
          warnings: [],
          createdAt: 1,
        },
      },
    };

    expect(visibleRow(renderToStaticMarkup(createElement(ApprovalCard, { message })))).toContain("Update this learned skill");
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain("replacing the current version");
    const spoken = spokenApprovalPrompt(
      { message, requestId: "skill-update-request", tool: "stage_skill", detail: message.card!.subtitle },
      "Mochi",
    );
    expect(spoken).toContain("Should I update it?");

    message.card!.answered = "allow";
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain("Skill updated");
  });

  it("keeps an old persisted skill card readable but deny-only", () => {
    const message: Message = {
      id: "legacy-skill-card",
      role: "bot",
      kind: "options",
      at: 1,
      card: {
        title: "Enable old skill?",
        subtitle: "This card predates reviewed hashes.",
        options: ["Enable", "Dismiss"],
        requestId: "legacy-request",
        tool: "stage_skill",
        skillRequest: {
          version: 1,
          requestId: "legacy-request",
          botId: "bot-1",
          threadId: "thread-1",
          stagedId: "staged-1",
          action: "create",
          name: "old-skill",
          gist: "Old skill",
          warnings: [],
          createdAt: 1,
        },
      },
    };

    const markup = renderToStaticMarkup(createElement(ApprovalCard, { message }));
    expect(markup).toContain("created by an older build");
    expect(markup).toContain("cannot be safely applied");
    expect(markup).toContain("create the skill again");

    message.card!.skillRequest!.action = "update";
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message })))
      .toContain("propose the update again");
  });
});

describe("ApprovalCard tool-call kinds", () => {
  const kindMessage = (tool?: string): Message => ({
    id: "kind-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: "rg \"wants to\" src/components",
      options: ["Allow", "Deny"],
      requestId: "req-kind",
      tool,
    },
  });

  const bot = { id: "bot-1", name: "Scout" } as never as Bot;

  it("writes a verb phrase when the driver only knows the ACP kind", () => {
    const html = visibleRow(renderToStaticMarkup(createElement(ApprovalCard, { bot, message: kindMessage("other") })));
    expect(html).toContain("Scout asks for your approval");
    expect(html).toContain("I want to take an action.");
    expect(html).not.toContain("want to other");
  });

  it("maps every kind an ACP driver can send, and never prints a tool name", () => {
    const cases: Array<[string, string]> = [
      ["shell", "make a change"],
      ["edit", "edit a file"],
      ["read", "read a file"],
      ["fetch", "fetch a web page"],
      ["delete", "delete a file"],
      ["think", "think"],
      ["other", "take an action"],
      ["tool", "use a tool"],
      ["mcp__ogb__computer_batch", "use a tool"],
    ];
    for (const [tool, phrase] of cases) {
      const html = visibleRow(renderToStaticMarkup(createElement(ApprovalCard, { bot, message: kindMessage(tool) })));
      expect(html).toContain(`I want to ${phrase}.`);
      expect(html).not.toContain("computer batch");
    }
  });

  it("speaks a verb phrase in the voice prompt too", () => {
    const message = kindMessage("other");
    const spoken = spokenApprovalPrompt(
      { message, requestId: "req-kind", tool: "other", detail: message.card!.subtitle },
      "Mochi",
    );
    expect(spoken).toContain("Mochi wants to take an action");
    expect(spoken).not.toContain("wants to other");
  });
});

describe("ApprovalCard expired proposals", () => {
  const expiredMessage = (): Message => ({
    id: "profile-expired-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Set up Scout?",
      subtitle: 'Name: "Scout" → "Kiwi"',
      options: ["Confirm", "Cancel"],
      requestId: "req-expired",
      tool: "update_profile",
      expired: true,
      profileRequest: {
        version: 1, requestId: "req-expired", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
        createdAt: 1, reason: "you asked", changes: { name: "Kiwi" }, before: { name: "Scout" }, expectedRevision: "r",
      },
    },
  });
  const bot = { id: "bot-1", name: "Scout" } as never as Bot;

  it("marks a dead proposal as expired instead of waiting for an answer", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: expiredMessage() }));
    expect(html).toContain("Expired — ask for a fresh proposal");
    expect(html).not.toContain("Waiting for your confirmation below");
    expect(html).not.toContain("data-tour=\"approval\"");
  });

  it("keeps an expired proposal out of the composer's decision queue", () => {
    const live = expiredMessage();
    live.card!.expired = undefined;
    expect(pendingApprovals([live, expiredMessage()]).map((pending) => pending.requestId)).toEqual(["req-expired"]);
  });
});

describe("ApprovalCard outbound holds", () => {
  const subtitle = [
    "Linear · Create linear comment",
    '{"issueId":"2f04bc73","body":"In flight"}',
    "",
    "Linear · Create linear comment",
    '{"issueId":"1c2755f","body":"From Discord"}',
  ].join("\n");
  const outboundMessage = (answered?: string): Message => ({
    id: "outbound-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Send on your behalf?",
      subtitle,
      options: ["Allow", "Deny"],
      requestId: "req-outbound",
      tool: "LINEAR_CREATE_LINEAR_COMMENT",
      heldCode: "approval.held.outbound",
      held: "This sends something on your behalf, so it always asks first.",
      answered,
      outboundRequest: {
        tool: "LINEAR_CREATE_LINEAR_COMMENT",
        app: "Linear",
        calls: [
          { app: "Linear", label: "Create linear comment" },
          { app: "Linear", label: "Create linear comment" },
        ],
      },
    },
  });
  const bot = { id: "bot-1", name: "Kiwi" } as never as Bot;

  it("names the app and the actions instead of the tool slug", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: outboundMessage() }));
    const row = visibleRow(html);
    expect(row).toContain("Send to Linear?");
    expect(row).toContain("Create linear comment ×2");
    expect(row).not.toContain("LINEAR CREATE LINEAR COMMENT");
    expect(row).not.toContain("LINEAR_CREATE_LINEAR_COMMENT");
    expect(row).not.toContain("issueId");
    expect(detailsOf(html)).toContain("issueId");
  });

  it("says whose account it goes to and what it costs, from the arguments, without showing them", () => {
    const message = outboundMessage();
    message.card!.subtitle = [
      "Meta Ads · Create ad",
      '{"accountName":"EVERGREEN","amount":"120","currency":"USD"}',
    ].join("\n");
    message.card!.outboundRequest = { tool: "META_CREATE_AD", app: "Meta Ads", calls: [{ app: "Meta Ads", label: "Create ad" }] };
    const row = visibleRow(renderToStaticMarkup(createElement(ApprovalCard, { bot, message })));
    expect(row).toContain("Send to Meta Ads? Create ad · EVERGREEN · $120.00");
    expect(row).not.toContain("accountName");
  });

  it("stays as a plain record once settled", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message: outboundMessage("allow") }));
    expect(html).toContain("You allowed");
    expect(html).toContain("Send to Linear: Create linear comment ×2");
    expect(html).not.toContain("issueId");
    expect(html).not.toContain("<button");
  });

  it("reads the subtitle back for a card from an older computer", () => {
    const message = outboundMessage();
    message.card!.outboundRequest = { tool: "LINEAR_CREATE_LINEAR_COMMENT", app: "Linear" };
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message }));
    expect(html).toContain("Send to Linear?");
    expect(html).toContain("Create linear comment ×2");
  });

  it("phrases a Composio slug on a plain permission card as words", () => {
    const message = outboundMessage();
    message.card!.outboundRequest = undefined;
    message.card!.tool = "mcp__composio__LINEAR_CREATE_LINEAR_COMMENT";
    const html = renderToStaticMarkup(createElement(ApprovalCard, { bot, message }));
    expect(visibleRow(html)).toContain("I want to use a tool.");
    expect(visibleRow(html)).not.toContain("LINEAR_CREATE_LINEAR_COMMENT");
  });
});

describe("ApprovalCard for a change that applied on its own", () => {
  const applied = (card: Partial<NonNullable<Message["card"]>>): Message => ({
    id: "applied-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Schedule “Check before dentist”?",
      subtitle: "Action: Create routine\nSchedule: Cron 30 14 * * 3",
      options: [],
      answered: "allow",
      dismissed: true,
      autoApplied: true,
      requestId: "routine-request",
      tool: "schedule_routine",
      ...card,
    },
  });
  const routineCard = (operation: NonNullable<NonNullable<Message["card"]>["routineRequest"]>["operation"], undo?: object) => applied({
    routineRequest: { ...routineRequest, operation, resultId: "routine-1", ...(undo ? { undo } : {}) } as NonNullable<Message["card"]>["routineRequest"],
  });
  const render = (message: Message) => renderToStaticMarkup(createElement(ApprovalCard, { bot: { name: "Scout" }, message, threadId: "thread-1" }));

  // A create renders the live trigger card (TriggerCard.test.ts); every later change is this one line.
  const update = { action: "update" as const, routineId: "routine-1", expectedUpdatedAt: 1, changes: { name: "Renamed" } };
  const before = { ...createRoutineOperation.routine, enabled: true };

  it("reads as one plain line with Undo instead of the approval box", () => {
    const at = new Date();
    at.setHours(14, 30, 0, 0);
    const markup = render(routineCard(update, { name: "Check before dentist", schedule: { type: "once", at: at.getTime() }, appliedUpdatedAt: 2, before }));
    expect(markup).toMatch(/Scout changed an automation: Check before dentist, today 2:30/);
    expect(markup).toContain(">Undo<");
    expect(markup).not.toContain(">Details<");
    expect(markup).not.toContain("30 14 * * 3");
    expect(markup).not.toContain("Waiting for your confirmation");
    expect(markup).not.toContain("schedule_routine");
  });

  it("never shows a cron expression that has no plain name", () => {
    const markup = render(routineCard(
      { ...update, changes: { schedule: { type: "cron", expression: "*/7 3-5 * * 1", timeZone: "UTC" } } },
      { name: "Odd hours", schedule: { type: "cron", expression: "*/7 3-5 * * 1", timeZone: "UTC" } },
    ));
    expect(markup).toContain("Scout changed an automation: Odd hours");
    expect(markup).not.toContain("*/7");
  });

  it("says Undone after Undo, and offers no Undo for a run", () => {
    const undone = { ...routineCard(update, { name: "Backlog review", appliedUpdatedAt: 2, before }) };
    undone.card = { ...undone.card!, undone: true };
    const markup = render(undone);
    expect(markup).toContain("Scout changed an automation: Backlog review");
    expect(markup).toContain(" · Undone");
    expect(markup).not.toContain(">Undo<");
    const run = render(routineCard({ action: "run_now", routineId: "routine-1", expectedUpdatedAt: 1 }, { name: "Backlog review" }));
    expect(run).toContain("Scout ran an automation: Backlog review");
    expect(run).not.toContain(">Undo<");
  });

  it("names profile fields, the model, and the skill in plain words", () => {
    const profile = render(applied({
      tool: "update_profile",
      profileRequest: {
        version: 1, requestId: "p", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
        createdAt: 1, reason: "asked", changes: { title: "Researcher", soul: "Be brief." }, before: { title: "", soul: "" },
        expectedRevision: "r", undo: { appliedRevision: "r2" },
      },
    }));
    expect(profile).toContain("Scout updated its profile: title, standing instructions");
    expect(profile).toContain(">Undo<");
    const model = render(applied({
      tool: "update_model",
      modelRequest: {
        version: 1, requestId: "m", botId: "bot-1", threadId: "thread-1", targetBotId: "bot-1", targetName: "Scout",
        createdAt: 1, reason: "asked", selection: { instanceId: "codex", model: "gpt-fixture" }, before: { instanceId: "claude", model: "sonnet" },
      },
    }));
    expect(model).toContain("Scout changed its default model: gpt-fixture");
    const skill = render(applied({
      tool: "stage_skill",
      skillRequest: {
        version: 1, requestId: "s", botId: "bot-1", threadId: "thread-1", stagedId: "staged", action: "create",
        name: "file-expense", gist: "Files an expense.", warnings: [], createdAt: 1,
      },
    }));
    expect(skill).toContain("Scout added a skill: file-expense");
  });

  it("reads team setup and team memory as one line, with Undo except for a deletion", () => {
    const setup = { version: 1 as const, requestId: "t", botId: "bot-1", threadId: "thread-1", reason: "asked", createdAt: 1, requesterRevision: "r", newTeams: [] };
    const team = render(applied({ tool: "set_up_team", teamSetupRequest: { ...setup, operations: [], resumed: true,
      result: { state: "applied", newTeams: [], bots: [{ id: "b2", name: "Mira", action: "created" }, { id: "b3", name: "Ada", action: "updated" }] },
      undo: { created: ["b2"], before: [], revisions: {} } } }));
    expect(team).toContain("Scout set up the team: added @Mira; updated @Ada");
    expect(team).toContain(">Undo<");
    const deleted = render(applied({ tool: "delete_bot", teamSetupRequest: { ...setup, operations: [], deletion: { botId: "b3", name: "Ada", expectedRevision: "r" },
      result: { state: "applied", newTeams: [], bots: [{ id: "b3", name: "Ada", action: "deleted" }] } } }));
    expect(deleted).toContain("Scout deleted @Ada");
    expect(deleted).not.toContain(">Undo<");
    const memory = render(applied({ tool: "propose_team_memory", subtitle: "Person: Ada Lovelace — Runs the payroll review.",
      teamMemoryRequest: { section: "", entryId: "e", kind: "person", revision: "v1" } }));
    expect(memory).toContain("Scout saved to team memory: Person: Ada Lovelace");
    expect(memory).toContain(">Undo<");
    expect(memory).not.toContain("Remember");
  });

  it("keeps the approval box for a card a person confirmed", () => {
    const confirmed = routineCard(createRoutineOperation, { name: "Backlog review" });
    confirmed.card = { ...confirmed.card!, autoApplied: undefined, options: ["Confirm", "Cancel"] };
    expect(render(confirmed)).toContain("Routine scheduled");
  });
});

describe("one approval, one card", () => {
  const command = (answered?: string, extra: Partial<NonNullable<Message["card"]>> = {}): Message => ({
    id: "shell-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: "git status",
      options: ["Allow", "Deny"],
      requestId: "r-shell",
      tool: "shell",
      allowSession: true,
      ...(answered ? { answered } : {}),
      ...extra,
    },
  });
  const proxy = (answered?: string): Message => ({
    id: "proxy-card",
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Send on your behalf?",
      subtitle: 'Composio · Proxy execute\n{"code_to_execute":"res, err = run_composio_tool(\\"GITHUB_GET_A_COMMIT\\", {})"}',
      options: ["Allow", "Deny"],
      requestId: "r-proxy",
      tool: "COMPOSIO_PROXY_EXECUTE",
      heldCode: "approval.held.outbound",
      held: "This sends something on your behalf, so it always asks first.",
      outboundRequest: { tool: "COMPOSIO_PROXY_EXECUTE", app: "Composio", calls: [{ app: "Composio", label: "Proxy execute" }] },
      ...(answered ? { answered } : {}),
    },
  });
  const render = (message: Message, bot = { name: "Dev", id: "bot-dev" }) =>
    renderCard({ bot, message, threadId: "thread-1", onCancelTurn: () => undefined });

  it("asks in the bot's words with the three answers in the card, and keeps the command folded away", () => {
    const html = render(command());
    const row = visibleRow(html);
    expect(row).toContain('data-approval-row="pending"');
    expect(row).toContain("Dev asks for your approval");
    expect(row).toContain("I want to make a change.");
    expect(row).not.toContain("git status");
    expect(row).not.toContain("<pre");
    expect(row).toContain(">Allow once</button>");
    expect(row).toContain(">Always allow</button>");
    expect(row).toContain(">Deny</button>");
    expect(row).toContain("Show details");
    expect(row).toContain('aria-expanded="false"');
    expect(html).toMatch(/id="approval-details-r-shell" hidden=""/);
    expect(detailsOf(html)).toContain("git status");
    expect(detailsOf(html)).toContain("Cancel turn");
  });

  it("shows the whole explanation, however long, without cutting it", () => {
    const explanation = `Quero rodar os testes do contador de palavras que o Cursor acabou de criar, para conferir se ele conta certo. ${"Só leio e executo dentro do repositório de teste. ".repeat(3)}`.trim();
    const html = render(command(undefined, { explanation, intent: "rodar os testes do contador de palavras" }));
    expect(visibleRow(html)).toContain(explanation.replace(/\s+/g, " "));
    expect(visibleRow(html)).not.toContain("git status");
  });

  it("says 'Quero {intent}.' when the engine gave no explanation", () => {
    const html = render(command(undefined, { intent: "publicar a página do artigo" }));
    expect(visibleRow(html)).toContain("I want to publicar a página do artigo.");
    expect(visibleRow(html)).not.toContain("git status");
  });

  it("falls back to the intent when the explanation only repeats it", () => {
    const html = render(command(undefined, { intent: "publicar a página do artigo", explanation: "Publicar a página do artigo." }));
    expect(visibleRow(html)).toContain("I want to publicar a página do artigo.");
  });

  it("offers no Always allow on a critical action, whatever the card carries", () => {
    const critical = command(undefined, {
      heldCode: "approval.held.sensitive",
      allowSession: undefined,
      allowKey: undefined,
      commandAllowlist: undefined,
    });
    const html = render(critical);
    expect(html).toContain("Hold to approve");
    expect(html).not.toContain(">Allow once</button>");
    expect(html).toContain(">Deny</button>");
    expect(html).not.toContain("Always allow");
    const withGrants = command(undefined, { heldCode: "approval.held.sensitive", allowKey: "Bash:git push" });
    expect(render(withGrants)).not.toContain("Always allow");
  });

  it("offers Allow everything in this task to the owner or an admin, only on a card of the bot's own task, and never on a critical action", () => {
    const plain = command(undefined, { canReleaseTask: true });
    expect(render(plain)).not.toContain("Allow everything in this task");
    viewer.ownerOrAdmin = false;
    expect(render(plain)).not.toContain("Allow everything in this task");
    viewer.ownerOrAdmin = true;
    const html = render(plain);
    expect(html).toContain(">Allow once</button>");
    expect(html).toContain(">Allow everything in this task</button>");
    expect(html).toContain('title="Allows this request and every next one in this task until it ends"');
    const held = render(command(undefined, { heldCode: "approval.held.sensitive", canReleaseTask: true }));
    expect(held).toContain("Hold to approve");
    expect(held).not.toContain("Allow everything in this task");
    expect(held).not.toContain("Always allow");
    expect(render(command())).not.toContain("Allow everything in this task");
    viewer.ownerOrAdmin = null;
    const released = render(command("allow", { releasedTask: true }));
    expect(released).toContain("Allowed for this task");
    expect(released).not.toContain("You allowed");
    expect(released).not.toContain("<button");
  });

  it("leaves a small record once a command is settled, with no buttons and no command", () => {
    const allowed = render(command("allow"));
    expect(allowed).toContain('data-approval-row="settled"');
    expect(allowed).toContain("You allowed");
    expect(allowed).toContain("I want to make a change.");
    expect(allowed).not.toContain("<button");
    expect(allowed).not.toContain("git status");
    const denied = render(command("deny"));
    expect(denied).toContain("You denied");
    expect(denied).not.toContain("<button");
  });

  it("leaves no line for an approval nobody answered", () => {
    expect(render(command("unavailable"))).toBe("");
    expect(render(command(undefined, { dismissed: true }))).toBe("");
    expect(render(command("deny", { dismissed: true }))).toBe("");
  });

  it("names the bot that asked in a room, from the message when the member is gone", () => {
    const fromPeer: Message = { ...command(), from: { botId: "bot-peer", name: "Mochi", color: "blue" } };
    expect(visibleRow(renderCard({ message: fromPeer, threadId: "room-thread" }))).toContain("Mochi asks for your approval");
    expect(visibleRow(renderCard({ bot: { name: "Kiwi", id: "bot-kiwi" }, message: fromPeer, threadId: "room-thread" }))).toContain("Kiwi asks for your approval");
  });

  it("names code run on Composio plainly and keeps the code behind Show details", () => {
    const html = render(proxy(), { name: "Ursa", id: "bot-ursa" });
    const row = visibleRow(html);
    expect(row).toContain("Run code on Composio?");
    expect(row).not.toContain("code_to_execute");
    expect(row).not.toContain("Always allow");
    expect(detailsOf(html)).toContain("code_to_execute");
    expect(detailsOf(html)).toContain("This runs code that could send or change things in your apps, so it always asks first.");
    expect(html).not.toContain("This sends something");
    expect(render(proxy("allow"), { name: "Ursa", id: "bot-ursa" })).toContain("You allowed");
  });

  it("keeps a real send's arguments under the details", () => {
    const send: Message = { ...proxy(), card: { ...proxy().card!, subtitle: 'Slack · Send message\n{"text":"hi"}', tool: "SLACK_SEND_MESSAGE",
      outboundRequest: { tool: "SLACK_SEND_MESSAGE", app: "Slack", calls: [{ app: "Slack", label: "Send message" }] } } };
    const html = render(send);
    expect(visibleRow(html)).toContain("Send to Slack?");
    expect(visibleRow(html)).not.toContain("{&quot;text&quot;:&quot;hi&quot;}");
    expect(detailsOf(html)).toContain("{&quot;text&quot;:&quot;hi&quot;}");
  });
});

describe("approvalNaturalText", () => {
  const pendingOf = (card: Partial<NonNullable<Message["card"]>>) => {
    const message: Message = { id: "m", role: "bot", kind: "options", at: 1,
      card: { title: "Approval needed", subtitle: "rm -rf build", options: ["Allow", "Deny"], requestId: "r", tool: "Bash", ...card } };
    return toPending(message)!;
  };

  it("prefers the engine's explanation, capitalized and ended with a period", () => {
    expect(approvalNaturalText(pendingOf({ explanation: "quero rodar os testes, para conferir se contam certo", intent: "rodar os testes" })))
      .toBe("Quero rodar os testes, para conferir se contam certo.");
  });

  it("speaks 'Quero {intent}.' without an explanation, and never the command", () => {
    const text = approvalNaturalText(pendingOf({ intent: "alterar os arquivos do site" }));
    expect(text).toBe("I want to alterar os arquivos do site.");
    expect(text).not.toContain("rm -rf");
  });

  it("falls back to a plain phrase for the tool, never its name", () => {
    expect(approvalNaturalText(pendingOf({}))).toBe("I want to make a change.");
    expect(approvalNaturalText(pendingOf({ tool: "mcp__acme__do_the_thing" }))).toBe("I want to use a tool.");
  });

  it("reads the plain line of an outbound send or a lesson", () => {
    expect(approvalNaturalText(pendingOf({
      tool: "SLACK_SEND_MESSAGE",
      subtitle: 'Slack · Send message\n{"text":"hi"}',
      outboundRequest: { tool: "SLACK_SEND_MESSAGE", app: "Slack", calls: [{ app: "Slack", label: "Send message" }] },
    }))).toBe("Send to Slack? Send message");
    expect(approvalNaturalText(pendingOf({ tool: "propose_lesson", lessonRequest: { lesson: "Always cite the source" } })))
      .toBe("Always cite the source");
  });
});
