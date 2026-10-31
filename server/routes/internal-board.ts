import { z } from "zod";
import type { BoardTask } from "../../shared/board.ts";
import { BOARD_LIMITS, TASK_STATUSES } from "../../shared/board.ts";
import type { BotCaller } from "../board/directory.ts";
import { BoardError } from "../board/errors.ts";
import type { BoardFeature } from "../board/feature.ts";
import { parseBody } from "../board/schema.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

export interface InternalBoardDeps {
  board: BoardFeature;
  caller(): BotCaller;
  readBody(): ReturnType<RouteContext["readBody"]>;
  requireActive(): void;
}

const link = z.object({ url: z.string().trim().min(1).max(BOARD_LIMITS.linkUrl), label: z.string().trim().max(BOARD_LIMITS.linkLabel).optional() }).strict();
const text = (max: number) => z.string().trim().min(1).max(max);

const taskCreate = z.object({
  title: text(BOARD_LIMITS.title),
  description: z.string().max(BOARD_LIMITS.description).optional(),
  assignee: z.string().trim().max(320).optional(),
}).strict();

const taskUpdate = z.object({
  id: z.number().int().positive(),
  status: z.enum(TASK_STATUSES).optional(),
  note: z.string().trim().max(BOARD_LIMITS.note).optional(),
  link: link.optional(),
}).strict();

const missionCreate = z.object({
  title: text(BOARD_LIMITS.missionTitle),
  goal: text(BOARD_LIMITS.missionGoal),
  team_bot_ids: z.array(z.string().regex(/^[\w-]+$/).max(200)).max(BOARD_LIMITS.missionTeam).optional(),
}).strict();

const missionPlan = z.object({
  steps: z.array(z.object({
    title: text(BOARD_LIMITS.title),
    description: z.string().max(BOARD_LIMITS.description).optional(),
    assignee: z.string().regex(/^[\w-]+$/).max(200).optional(),
  }).strict()).min(1).max(BOARD_LIMITS.missionSteps),
}).strict();

const missionNote = z.object({ text: text(BOARD_LIMITS.description) }).strict();

const missionAsk = z.object({
  question: text(BOARD_LIMITS.question),
  options: z.array(text(BOARD_LIMITS.option)).max(BOARD_LIMITS.options).optional(),
}).strict();

const LIST_LIMIT = 50;

export function createInternalBoardRoutes(deps: InternalBoardDeps): RouteHandler {
  const { board } = deps;
  const brief = (task: BoardTask) => {
    const assignee = task.assignee;
    const bot = assignee && !assignee.includes("@") ? board.dir.bot(assignee) : undefined;
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      ...(assignee ? { assignee, ...(bot ? { assigneeName: bot.name } : {}) } : {}),
      ...(task.description ? { description: task.description.slice(0, 600) } : {}),
      ...(task.links?.length ? { links: task.links } : {}),
      ...(task.missionId ? { missionId: task.missionId } : {}),
    };
  };
  return async ({ res, path, method, url, json }) => {
    if (!path.startsWith("/api/internal/board/")) return PASS;
    const caller = deps.caller();
    try {
      if (method === "GET" && path === "/api/internal/board/tasks") {
        const scope = url.searchParams.get("scope") === "room" ? "room" : "mine";
        const room = board.dir.roomOfThread(caller.threadId);
        const tasks = board.tasks.list(caller).filter((task) => scope === "mine"
          ? task.assignee === caller.bot.id
          : Boolean(room && (task.source?.groupId === room.id || task.thread?.groupId === room.id)));
        return json(res, 200, { scope, tasks: tasks.slice(0, LIST_LIMIT).map(brief), total: tasks.length });
      }
      if (method !== "POST") return PASS;
      if (path === "/api/internal/board/task-create") {
        const body = parseBody(taskCreate, await deps.readBody(), "task_create");
        deps.requireActive();
        const { task } = await board.tasks.create(caller, body);
        const handover = task.assignee && !task.assignee.includes("@") && task.assignee !== caller.bot.id;
        return json(res, 200, {
          task: brief(task),
          ...(handover ? { note: "The card is recorded. It does not start the other agent: hand the work over with coordinate_bots." } : {}),
        });
      }
      if (path === "/api/internal/board/task-update") {
        const body = parseBody(taskUpdate, await deps.readBody(), "task_update");
        deps.requireActive();
        return json(res, 200, { task: brief(board.tasks.botUpdate(caller, body.id, { status: body.status, note: body.note, link: body.link })) });
      }
      if (path === "/api/internal/board/mission-create") {
        const body = parseBody(missionCreate, await deps.readBody(), "mission_create");
        deps.requireActive();
        const mission = board.missions.create(caller, { title: body.title, goal: body.goal, leadBotId: caller.bot.id, teamBotIds: body.team_bot_ids });
        return json(res, 200, { mission: { id: mission.id, title: mission.title, status: mission.status, team: mission.teamBotIds, room: mission.groupId } });
      }
      if (path === "/api/internal/board/mission-plan") {
        const body = parseBody(missionPlan, await deps.readBody(), "mission_plan");
        deps.requireActive();
        const mission = board.missions.plan(caller, body.steps);
        return json(res, 200, { mission: { id: mission.id, status: mission.status }, steps: board.missions.stepTasks(mission).map(brief) });
      }
      if (path === "/api/internal/board/mission-note") {
        const body = parseBody(missionNote, await deps.readBody(), "mission_note");
        deps.requireActive();
        const mission = board.missions.note(caller, body.text);
        return json(res, 200, { mission: { id: mission.id, status: mission.status } });
      }
      if (path === "/api/internal/board/mission-ask") {
        const body = parseBody(missionAsk, await deps.readBody(), "mission_ask");
        deps.requireActive();
        const mission = board.missions.ask(caller, body.question, body.options);
        return json(res, 200, { status: mission.status, note: "The person was asked. Finish your turn: the mission resumes when they answer." });
      }
      return PASS;
    } catch (error) {
      if (error instanceof BoardError) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}

