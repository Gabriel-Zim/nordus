// The task board and mission tools of the agents catalog, and the internal route behind each. The server scopes every
// call to the calling bot, so a tool only ever reads or changes cards that bot may reach.
import { BOARD_LIMITS, TASK_STATUSES } from "../../shared/board.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

const BOARD_TOOL_ROUTES: Readonly<Record<string, string>> = {
  task_create: "task-create",
  task_update: "task-update",
  mission_create: "mission-create",
  mission_plan: "mission-plan",
  mission_note: "mission-note",
  mission_ask: "mission-ask",
};

export const BOARD_TOOL_NAMES: ReadonlySet<string> = new Set([...Object.keys(BOARD_TOOL_ROUTES), "task_list"]);

export async function callBoardTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { apiResponse } = context.client;
  if (name === "task_list") {
    const scope = args.scope === "room" ? "room" : "mine";
    const { ok, body } = await apiResponse(`/api/internal/board/tasks?scope=${scope}`);
    return ok ? { text: JSON.stringify(body) } : { text: String(body.error ?? "Could not read the board."), isError: true };
  }
  const route = BOARD_TOOL_ROUTES[name];
  if (!route) return { text: `Unknown board tool ${name}.`, isError: true };
  const { ok, body } = await apiResponse(`/api/internal/board/${route}`, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: JSON.stringify(body) } : { text: String(body.error ?? "The board refused that."), isError: true };
}

export const BOARD_TOOL_DEFINITIONS = [
  {
    name: "task_create",
    description:
      "Put a card on the shared task board, which the person sees live. Without assignee it is yours; giving it to another agent only records it, so hand the work over with coordinate_bots.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assignee: { type: "string", description: "Agent id or a person's email." },
      },
      required: ["title"],
    },
  },
  {
    name: "task_update",
    description:
      "Move or annotate a board card you may change: doing when you start, review when it needs a look, done when finished. The card moves live.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "integer", description: "The card number." },
        status: { type: "string", enum: [...TASK_STATUSES] },
        note: { type: "string" },
        link: { type: "object", additionalProperties: false, properties: { url: { type: "string" }, label: { type: "string" } }, required: ["url"] },
      },
      required: ["id"],
    },
  },
  {
    name: "task_list",
    description: "List board cards: mine (assigned to you, the default) or room (cards of the room you are in).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { scope: { type: "string", enum: ["mine", "room"] } },
    },
  },
  {
    name: "mission_create",
    description:
      "Open a multi-day mission with its own room, led by you. Then finish your turn: in the new room you are asked to plan it with mission_plan.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        goal: { type: "string", description: "What done looks like." },
        team_bot_ids: { type: "array", items: { type: "string" }, description: "Teammate agent ids." },
      },
      required: ["title", "goal"],
    },
  },
  {
    name: "mission_plan",
    description:
      "Mission lead only, in the mission room, once: the ordered steps, each with an owner from the team (default: you). They then run one after another.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        steps: {
          type: "array",
          maxItems: BOARD_LIMITS.missionSteps,
          items: {
            type: "object",
            additionalProperties: false,
            properties: { title: { type: "string" }, description: { type: "string" }, assignee: { type: "string", description: "Team agent id." } },
            required: ["title"],
          },
        },
      },
      required: ["steps"],
    },
  },
  {
    name: "mission_note",
    description:
      "In a mission room: add a progress note to the feed. When all steps are done, the lead's note is the final summary the person reads.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "mission_ask",
    description:
      "In a mission room: ask the person for a decision, then stop. The mission waits and you are told the answer. Offer options when the choice is closed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        options: { type: "array", maxItems: BOARD_LIMITS.options, items: { type: "string" } },
      },
      required: ["question"],
    },
  },
];
