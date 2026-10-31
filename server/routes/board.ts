import type { BoardTasksResponse, BoardTaskResponse, MissionResponse, MissionsResponse } from "../../shared/board.ts";
import type { BoardFeature } from "../board/feature.ts";
import type { PersonCaller } from "../board/directory.ts";
import { BoardError } from "../board/errors.ts";
import { toWire } from "../board/missions.ts";
import { answerBody, createMissionBody, createTaskBody, parseBody, updateTaskBody } from "../board/schema.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BoardRouteDeps {
  board: BoardFeature;
  callerFor(auth: RequestAuth): PersonCaller;
}

const TASK = /^\/api\/board\/tasks\/(\d{1,9})$/;
const MISSION = /^\/api\/missions\/([\w-]{1,64})$/;
const MISSION_ACTION = /^\/api\/missions\/([\w-]{1,64})\/(pause|resume|answer)$/;

export function createBoardRoutes(deps: BoardRouteDeps): RouteHandler {
  const { board } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/board/") && path !== "/api/missions" && !path.startsWith("/api/missions/")) return PASS;
    const caller = deps.callerFor(auth);
    try {
      if (path === "/api/board/tasks" && method === "GET") {
        const tasks = board.tasks.list(caller);
        if (!caller.admin) board.frames.noteListed(caller.actor.id, tasks, []);
        return json(res, 200, { tasks } satisfies BoardTasksResponse);
      }
      if (path === "/api/board/tasks" && method === "POST") {
        const body = parseBody(createTaskBody, await readBody(req), "Tarefa");
        return json(res, 201, await board.tasks.create(caller, body) satisfies BoardTaskResponse);
      }
      if (path === "/api/board/people" && method === "GET") {
        return json(res, 200, { people: board.tasks.people(caller) });
      }
      const task = TASK.exec(path);
      if (task && method === "PATCH") {
        const body = parseBody(updateTaskBody, await readBody(req), "Tarefa");
        return json(res, 200, await board.tasks.update(caller, Number(task[1]), body) satisfies BoardTaskResponse);
      }
      if (task && method === "DELETE") {
        board.tasks.remove(caller, Number(task[1]));
        return json(res, 200, { ok: true });
      }
      if (path === "/api/missions" && method === "GET") {
        const missions = board.missions.list(caller);
        if (!caller.admin) board.frames.noteListed(caller.actor.id, [], missions);
        return json(res, 200, { missions } satisfies MissionsResponse);
      }
      if (path === "/api/missions" && method === "POST") {
        const body = parseBody(createMissionBody, await readBody(req), "Missão");
        return json(res, 201, { mission: toWire(board.missions.create(caller, body), caller.admin) } satisfies MissionResponse);
      }
      const mission = MISSION.exec(path);
      if (mission && method === "GET") return json(res, 200, board.missions.view(caller, mission[1]!) satisfies MissionResponse);
      if (mission && method === "DELETE") {
        board.missions.remove(caller, mission[1]!);
        return json(res, 200, { ok: true });
      }
      const action = MISSION_ACTION.exec(path);
      if (action && method === "POST") {
        const id = action[1]!;
        if (action[2] === "answer") {
          const body = parseBody(answerBody, await readBody(req), "Resposta");
          return json(res, 200, { mission: toWire(board.missions.answer(caller, id, body.answer), caller.admin) } satisfies MissionResponse);
        }
        const changed = action[2] === "pause" ? board.missions.pause(caller, id) : board.missions.resume(caller, id);
        return json(res, 200, { mission: toWire(changed, caller.admin) } satisfies MissionResponse);
      }
      return PASS;
    } catch (error) {
      if (error instanceof BoardError) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}
