import { describe, expect, it } from "vitest";
import { BOARD_LIMITS, TASK_STATUSES } from "../../shared/board.ts";
import { BOARD_TOOL_DEFINITIONS, BOARD_TOOL_NAMES } from "./agents-board-tools.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import { AGENTS_MCP_ENV } from "./agents-mcp-env.ts";

interface Recorded {
  path: string;
  init?: RequestInit;
}

function context(reply: { ok: boolean; status?: number; body: Record<string, unknown> } = { ok: true, body: { task: { id: 1 } } }) {
  const calls: Recorded[] = [];
  const value: ToolCallContext = {
    botId: "dev",
    threadId: "th-dev",
    depth: 0,
    externalRuntime: false,
    sharedComputers: false,
    client: {
      api: async () => ({}),
      apiResponse: async (path, init) => {
        calls.push({ path, init });
        return { ok: reply.ok, status: reply.status ?? (reply.ok ? 200 : 400), body: reply.body as never };
      },
    },
  };
  return { value, calls };
}

describe("the board tools reach the harness", () => {
  it.each([
    ["task_create", "/api/internal/board/task-create", { title: "Revisar", assignee: "atlas" }],
    ["task_update", "/api/internal/board/task-update", { id: 3, status: "doing", note: "Comecei" }],
    ["mission_create", "/api/internal/board/mission-create", { title: "Virar", goal: "Sem erro", team_bot_ids: ["atlas"] }],
    ["mission_plan", "/api/internal/board/mission-plan", { steps: [{ title: "Preparar" }] }],
    ["mission_note", "/api/internal/board/mission-note", { text: "Subi o ambiente" }],
    ["mission_ask", "/api/internal/board/mission-ask", { question: "Posso?", options: ["Sim", "Não"] }],
  ])("%s posts its arguments untouched to its own route", async (name, path, args) => {
    const { value, calls } = context();
    const result = await callTool(name, args, value);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual({ task: { id: 1 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(path);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(args);
  });

  it("task_list reads mine by default, the room on request, and mine for anything else", async () => {
    for (const [args, scope] of [[{}, "mine"], [{ scope: "room" }, "room"], [{ scope: "mine" }, "mine"], [{ scope: "everything" }, "mine"]] as const) {
      const { value, calls } = context({ ok: true, body: { scope, tasks: [], total: 0 } });
      const result = await callTool("task_list", args, value);
      expect(result.isError).toBeFalsy();
      expect(calls).toEqual([{ path: `/api/internal/board/tasks?scope=${scope}` }]);
    }
  });

  it("hands a refusal back as the tool's own error, with the board's sentence", async () => {
    const { value } = context({ ok: false, status: 403, body: { error: "Essa tarefa é de outro agente." } });
    const result = await callTool("task_update", { id: 2, status: "done" }, value);
    expect(result).toEqual({ text: "Essa tarefa é de outro agente.", isError: true });
    const read = await callTool("task_list", {}, context({ ok: false, status: 500, body: {} }).value);
    expect(read).toEqual({ text: "Could not read the board.", isError: true });
    const write = await callTool("mission_note", { text: "x" }, context({ ok: false, status: 500, body: {} }).value);
    expect(write).toEqual({ text: "The board refused that.", isError: true });
  });
});

describe("the board tools in the catalog", () => {
  const names = (env: NodeJS.ProcessEnv) => availableTools(catalogProfileFromEnv(env)).map((tool) => tool.name);

  it("are named once each and are exactly the ones the harness can run", () => {
    const defined = BOARD_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(defined).toEqual(["task_create", "task_update", "task_list", "mission_create", "mission_plan", "mission_note", "mission_ask"]);
    expect([...BOARD_TOOL_NAMES].sort()).toEqual([...defined].sort());
  });

  it("appear only when the harness turns the board on", () => {
    expect(names({}).filter((name) => BOARD_TOOL_NAMES.has(name))).toEqual([]);
    for (const off of [{ NORDUS_BOARD: "0" }, { NORDUS_BOARD: "" }, { NORDUS_BOARD: "true" }]) {
      expect(names(off).filter((name) => BOARD_TOOL_NAMES.has(name))).toEqual([]);
    }
    expect(names({ NORDUS_BOARD: "1" })).toEqual(expect.arrayContaining([...BOARD_TOOL_NAMES]));
  });

  it("reach the model through the environment the harness hands the agents server", () => {
    expect(AGENTS_MCP_ENV).toContain("NORDUS_BOARD");
  });

  it("describe their arguments in the shape the board accepts", () => {
    const byName = Object.fromEntries(BOARD_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.inputSchema as Record<string, any>]));
    expect(byName.task_create.required).toEqual(["title"]);
    expect(byName.task_update.properties.status.enum).toEqual([...TASK_STATUSES]);
    expect(byName.task_update.required).toEqual(["id"]);
    expect(byName.task_list.properties.scope.enum).toEqual(["mine", "room"]);
    expect(byName.mission_create.required).toEqual(["title", "goal"]);
    expect(byName.mission_plan.properties.steps.maxItems).toBe(BOARD_LIMITS.missionSteps);
    expect(byName.mission_ask.properties.options.maxItems).toBe(BOARD_LIMITS.options);
    for (const schema of Object.values(byName)) expect(schema.additionalProperties).toBe(false);
  });

  it("keep their wording free of the em dash and short enough to cost little", () => {
    for (const tool of BOARD_TOOL_DEFINITIONS) {
      expect(JSON.stringify(tool)).not.toContain("—");
      expect(tool.description.length, tool.name).toBeLessThan(330);
    }
  });
});
