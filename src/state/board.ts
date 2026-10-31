import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { listenLiveFrames } from "@/lib/live-events";
import { boardApi, mergeMission, mergeTask, missionStamp, normalizeMission, normalizeTask, type NewMissionBody, type NewTaskBody, type TaskPatch } from "@/lib/board";
import { errorText } from "@/lib/board-text";
import { isBoardFrameKind } from "../../shared/board";
import type { BoardMission, BoardPerson, BoardTask, BoardTaskResponse, MissionResponse } from "../../shared/board";

export type LoadState = "loading" | "ready" | "error";

export interface BoardState {
  tasks: BoardTask[];
  missions: BoardMission[];
  people: BoardPerson[];
  tasksLoad: LoadState;
  missionsLoad: LoadState;
  tasksError: string | null;
  missionsError: string | null;
}

export const initialBoardState: BoardState = {
  tasks: [], missions: [], people: [], tasksLoad: "loading", missionsLoad: "loading", tasksError: null, missionsError: null,
};

export type BoardAction =
  | { type: "retry" }
  | { type: "tasksLoaded"; tasks: BoardTask[] }
  | { type: "tasksFailed"; error: string }
  | { type: "missionsLoaded"; missions: BoardMission[] }
  | { type: "missionsFailed"; error: string }
  | { type: "peopleLoaded"; people: BoardPerson[] }
  | { type: "taskPut"; task: BoardTask }
  | { type: "taskEdited"; id: number; patch: Partial<BoardTask> }
  | { type: "taskRestored"; task: BoardTask }
  | { type: "taskDeleted"; id: number }
  | { type: "missionPut"; mission: BoardMission }
  | { type: "missionDeleted"; id: string };

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "retry":
      return {
        ...state,
        tasksLoad: state.tasksLoad === "error" ? "loading" : state.tasksLoad,
        missionsLoad: state.missionsLoad === "error" ? "loading" : state.missionsLoad,
      };
    case "tasksLoaded": {
      const current = new Map(state.tasks.map((task) => [task.id, task]));
      const tasks = action.tasks.map(normalizeTask).map((incoming) => {
        const known = current.get(incoming.id);
        return known && known.updatedAt > incoming.updatedAt ? known : incoming;
      });
      return { ...state, tasks, tasksLoad: "ready", tasksError: null };
    }
    case "tasksFailed":
      return { ...state, tasksLoad: state.tasksLoad === "loading" ? "error" : state.tasksLoad, tasksError: action.error };
    case "missionsLoaded": {
      const current = new Map(state.missions.map((mission) => [mission.id, mission]));
      const missions = action.missions.map(normalizeMission).map((incoming) => {
        const known = current.get(incoming.id);
        return known && missionStamp(known) > missionStamp(incoming) ? known : incoming;
      });
      return { ...state, missions, missionsLoad: "ready", missionsError: null };
    }
    case "missionsFailed":
      return { ...state, missionsLoad: state.missionsLoad === "loading" ? "error" : state.missionsLoad, missionsError: action.error };
    case "peopleLoaded":
      return { ...state, people: action.people };
    case "taskPut": {
      const tasks = mergeTask(state.tasks, action.task);
      return tasks === state.tasks ? state : { ...state, tasks };
    }
    case "taskEdited":
      return { ...state, tasks: state.tasks.map((task) => task.id === action.id ? { ...task, ...action.patch } : task) };
    case "taskRestored": {
      const current = state.tasks.find((task) => task.id === action.task.id);
      if (!current || current.updatedAt !== action.task.updatedAt) return state;
      return { ...state, tasks: state.tasks.map((task) => task.id === action.task.id ? action.task : task) };
    }
    case "taskDeleted":
      return { ...state, tasks: state.tasks.filter((task) => task.id !== action.id) };
    case "missionPut": {
      const missions = mergeMission(state.missions, action.mission);
      return missions === state.missions ? state : { ...state, missions };
    }
    case "missionDeleted":
      return { ...state, missions: state.missions.filter((mission) => mission.id !== action.id) };
  }
}

export function frameAction(frame: { kind: string }): BoardAction | null {
  if (!isBoardFrameKind(frame.kind)) return null;
  const body = frame as unknown as { task?: BoardTask; mission?: BoardMission; id?: unknown };
  switch (frame.kind) {
    case "board.task":
      return body.task && typeof body.task.id === "number" ? { type: "taskPut", task: body.task } : null;
    case "board.task.deleted":
      return typeof body.id === "number" ? { type: "taskDeleted", id: body.id } : null;
    case "board.mission":
      return body.mission && typeof body.mission.id === "string" ? { type: "missionPut", mission: body.mission } : null;
    case "board.mission.deleted":
      return typeof body.id === "string" ? { type: "missionDeleted", id: body.id } : null;
    default:
      return null;
  }
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

function optimistic(patch: TaskPatch): Partial<BoardTask> {
  return {
    ...(patch.status ? { status: patch.status } : {}),
    ...("assignee" in patch ? { assignee: patch.assignee ?? undefined } : {}),
  };
}

export interface BoardActions {
  reload: () => void;
  moveTask: (id: number, status: BoardTask["status"]) => Promise<Outcome<BoardTaskResponse>>;
  updateTask: (id: number, patch: TaskPatch) => Promise<Outcome<BoardTaskResponse>>;
  createTask: (body: NewTaskBody) => Promise<Outcome<BoardTaskResponse>>;
  deleteTask: (id: number) => Promise<Outcome<true>>;
  loadMission: (id: string) => Promise<Outcome<MissionResponse>>;
  createMission: (body: NewMissionBody) => Promise<Outcome<MissionResponse>>;
  pauseMission: (id: string) => Promise<Outcome<MissionResponse>>;
  resumeMission: (id: string) => Promise<Outcome<MissionResponse>>;
  answerMission: (id: string, answer: string) => Promise<Outcome<MissionResponse>>;
  deleteMission: (id: string) => Promise<Outcome<true>>;
}

export function useBoard(): BoardState & { actions: BoardActions } {
  const [state, dispatch] = useReducer(boardReducer, initialBoardState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const requests = useRef({ tasks: 0, missions: 0, people: 0 });

  const loadTasks = useCallback(() => {
    const id = ++requests.current.tasks;
    boardApi.tasks().then(
      ({ tasks }) => { if (id === requests.current.tasks) dispatch({ type: "tasksLoaded", tasks }); },
      (error: unknown) => { if (id === requests.current.tasks) dispatch({ type: "tasksFailed", error: errorText(error) }); },
    );
  }, []);
  const loadMissions = useCallback(() => {
    const id = ++requests.current.missions;
    boardApi.missions().then(
      ({ missions }) => { if (id === requests.current.missions) dispatch({ type: "missionsLoaded", missions }); },
      (error: unknown) => { if (id === requests.current.missions) dispatch({ type: "missionsFailed", error: errorText(error) }); },
    );
  }, []);
  const loadPeople = useCallback(() => {
    const id = ++requests.current.people;
    boardApi.people().then(
      ({ people }) => { if (id === requests.current.people) dispatch({ type: "peopleLoaded", people }); },
      () => {},
    );
  }, []);
  const reload = useCallback(() => {
    dispatch({ type: "retry" });
    loadTasks();
    loadMissions();
    loadPeople();
  }, [loadTasks, loadMissions, loadPeople]);

  useEffect(() => {
    reload();
    const stop = listenLiveFrames({
      onFrame: (frame) => {
        const action = frameAction(frame);
        const kind: string = frame.kind;
        if (action) dispatch(action);
        else if (kind === "hello") reload();
      },
      onMissedFrames: reload,
    });
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const pending = requests.current;
    return () => {
      stop();
      window.removeEventListener("focus", onFocus);
      pending.tasks += 1;
      pending.missions += 1;
      pending.people += 1;
    };
  }, [reload]);

  const actions = useMemo<BoardActions>(() => {
    const updateTask = async (id: number, patch: TaskPatch) => {
      const before = stateRef.current.tasks.find((task) => task.id === id);
      if (before) dispatch({ type: "taskEdited", id, patch: optimistic(patch) });
      const result = await attempt(() => boardApi.patchTask(id, patch));
      if (result.ok) dispatch({ type: "taskPut", task: result.value.task });
      else if (before) dispatch({ type: "taskRestored", task: before });
      return result;
    };
    const putMission = async (run: () => Promise<MissionResponse>) => {
      const result = await attempt(run);
      if (result.ok) dispatch({ type: "missionPut", mission: result.value.mission });
      return result;
    };
    return {
      reload,
      updateTask,
      moveTask: (id, status) => updateTask(id, { status }),
      createTask: async (body) => {
        const result = await attempt(() => boardApi.createTask(body));
        if (result.ok) dispatch({ type: "taskPut", task: result.value.task });
        return result;
      },
      deleteTask: async (id) => {
        const result = await attempt(async () => { await boardApi.deleteTask(id); return true as const; });
        if (result.ok) dispatch({ type: "taskDeleted", id });
        return result;
      },
      loadMission: (id) => putMission(() => boardApi.mission(id)),
      createMission: (body) => putMission(() => boardApi.createMission(body)),
      pauseMission: (id) => putMission(() => boardApi.pauseMission(id)),
      resumeMission: (id) => putMission(() => boardApi.resumeMission(id)),
      answerMission: (id, answer) => putMission(() => boardApi.answerMission(id, answer)),
      deleteMission: async (id) => {
        const result = await attempt(async () => { await boardApi.deleteMission(id); return true as const; });
        if (result.ok) dispatch({ type: "missionDeleted", id });
        return result;
      },
    };
  }, [reload]);

  return { ...state, actions };
}
