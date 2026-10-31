import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "./i18n";
import {
  createStarterTeam,
  STARTER_TEAM_TIMEOUT_MS,
  StarterTeamBuildError,
  StarterTeamUnavailableError,
  starterTeamMembers,
  starterTeamRegistryKey,
  type StarterTeamKey,
} from "./starter-team";
import type { Bot } from "@/state/store";

type Request = typeof import("@/state/store").api;

const ENVIRONMENT_PATH = "/.well-known/nordus/environment";
const ENVIRONMENT = "env-test";

interface Call {
  path: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

function fakeRequest(handler: (call: Call) => unknown) {
  const calls: Call[] = [];
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    const call = { path, method, body };
    calls.push(call);
    return handler(call);
  });
  return { request: request as unknown as Request, calls };
}

function fixture(id: string, body: Record<string, unknown>): Bot {
  return {
    id,
    threadId: `thread-${id}`,
    name: String(body.name ?? id),
    title: String(body.title ?? ""),
    description: String(body.description ?? ""),
    color: "green",
    notifications: true,
    unread: false,
    messages: [],
    modelSelection: (body.modelSelection as Bot["modelSelection"] | undefined) ?? { instanceId: "", model: "" },
    ...(typeof body.tag === "string" ? { tag: body.tag } : {}),
    ...(typeof body.soul === "string" ? { soul: body.soul } : {}),
  };
}

function memberBot(key: StarterTeamKey, id = `team-${key}`): Bot {
  const member = starterTeamMembers().find((entry) => entry.key === key)!;
  return fixture(id, {
    name: member.name,
    title: member.title,
    description: member.description,
    soul: member.soul,
    modelSelection: { instanceId: "claude", model: "sonnet" },
  });
}

/** Answers the create/patch calls the helper makes, keeping one record per bot. */
function createHandler() {
  const bots = new Map<string, Bot>();
  let count = 0;
  return (call: Call) => {
    if (call.method === "GET" && call.path === "/api/bot-defaults") {
      return { modelSelection: { instanceId: "claude", model: "sonnet" } };
    }
    if (call.method === "POST" && call.path === "/api/bots") {
      count += 1;
      const bot = fixture(`bot-${count}`, call.body ?? {});
      bots.set(bot.id, bot);
      return { bot };
    }
    if (call.method === "PATCH") {
      const id = call.path.split("/").pop()!;
      return { bot: { ...bots.get(id), ...call.body } };
    }
    throw new Error(`unexpected ${call.method} ${call.path}`);
  };
}

function routed(handler: (call: Call) => unknown, environment: string | (() => string) = ENVIRONMENT) {
  return (call: Call) => call.path === ENVIRONMENT_PATH
    ? { environmentId: typeof environment === "function" ? environment() : environment }
    : handler(call);
}

const surface = (initial: Record<string, string> = {}) => {
  const stored = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    stored,
  };
};

function registry(scope = ENVIRONMENT): Record<string, string> {
  const raw = globalThis.localStorage.getItem(starterTeamRegistryKey(scope));
  return raw ? JSON.parse(raw) as Record<string, string> : {};
}

function seedRegistry(ids: Partial<Record<StarterTeamKey, string>>, scope = ENVIRONMENT): void {
  globalThis.localStorage.setItem(starterTeamRegistryKey(scope), JSON.stringify(ids));
}

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("localStorage", surface());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the starter team", () => {
  it("creates a chief, a researcher and an operator with the built-in roles", async () => {
    const { request, calls } = fakeRequest(routed(createHandler()));
    const modelSelection = { instanceId: "claude", model: "sonnet" };

    const result = await createStarterTeam(request, { modelSelection });

    expect(result.bots.map((bot) => bot.name)).toEqual(["Chief", "Analyst", "Operator"]);
    expect(result.chief).toBe(result.bots[0]);
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(3);
    expect(posts[0]!.body).toMatchObject({
      name: "Chief",
      title: "Chief of staff",
      modelSelection,
      requireAvailableModel: true,
    });
    expect(posts[1]!.body).toMatchObject({ name: "Analyst", title: "Researcher" });
    expect(posts[2]!.body).toMatchObject({ name: "Operator", title: "Operations" });
    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(3);
    expect(patches[0]!.body!.soul).toContain("capable, plain-spoken assistant");
    expect(patches[0]!.body!.soul).toContain("You lead this small team");
    expect(patches[1]!.body!.soul).toContain("You research questions");
    expect(patches[2]!.body!.soul).toContain("keep the user's week on track");
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  });

  it("creates every bot without a tag or any other visible marker", async () => {
    const { request, calls } = fakeRequest(routed(createHandler()));

    const result = await createStarterTeam(request);

    expect(result.bots.map((bot) => bot.tag)).toEqual([undefined, undefined, undefined]);
    expect(result.bots.map((bot) => bot.title)).toEqual(["Chief of staff", "Researcher", "Operations"]);
    const writes = calls.filter((call) => call.method === "POST" || call.method === "PATCH");
    expect(writes).toHaveLength(6);
    expect(writes.some((call) => call.body !== undefined && "tag" in call.body)).toBe(false);
    expect(registry()).toEqual({
      chief: result.bots[0]!.id,
      research: result.bots[1]!.id,
      execution: result.bots[2]!.id,
    });
  });

  it("reuses the registered bots when called twice, still checking the model", async () => {
    const { request, calls } = fakeRequest(routed(createHandler()));
    const first = await createStarterTeam(request);
    const writes = calls.filter((call) => call.method !== "GET").length;
    const defaults = calls.filter((call) => call.path === "/api/bot-defaults").length;
    const environments = calls.filter((call) => call.path === ENVIRONMENT_PATH).length;

    const second = await createStarterTeam(request, { existing: first.bots });

    expect(second.bots.map((bot) => bot.id)).toEqual(first.bots.map((bot) => bot.id));
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(writes);
    expect(calls.filter((call) => call.path === "/api/bot-defaults")).toHaveLength(defaults + 1);
    expect(calls.filter((call) => call.path === ENVIRONMENT_PATH)).toHaveLength(environments + 1);
  });

  it("never reuses or overwrites a particular bot that happens to share a starter name or tag", async () => {
    const stranger = fixture("stranger", { name: "Chief", title: "My own bot", tag: "starter-team:chief" });
    const { request, calls } = fakeRequest(routed(createHandler()));

    const result = await createStarterTeam(request, { existing: [stranger] });

    expect(calls.filter((call) => call.method === "PATCH").some((call) => call.path.endsWith("stranger"))).toBe(false);
    expect(calls.filter((call) => call.method === "DELETE").some((call) => call.path.endsWith("stranger"))).toBe(false);
    expect(result.bots.map((bot) => bot.name)).toEqual(["Chief 2", "Analyst", "Operator"]);
  });

  it("repairs a registered member whose model or role drifted", async () => {
    const { request, calls } = fakeRequest(routed(createHandler()));
    const first = await createStarterTeam(request);
    const drifted = first.bots.map((bot) => bot.id === first.chief.id
      ? { ...bot, modelSelection: { instanceId: "", model: "" }, title: "Old title" }
      : bot);
    calls.length = 0;

    const result = await createStarterTeam(request, { existing: drifted });

    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.path).toBe(`/api/bots/${first.chief.id}`);
    expect(patches[0]!.body).toMatchObject({
      title: "Chief of staff",
      modelSelection: { instanceId: "claude", model: "sonnet" },
      requireAvailableModel: true,
    });
    expect(patches[0]!.body).not.toHaveProperty("tag");
    expect(result.chief.modelSelection).toEqual({ instanceId: "claude", model: "sonnet" });
    expect(result.chief.title).toBe("Chief of staff");
  });

  it("fails instead of reporting success when a registered member cannot be repaired", async () => {
    const chief = { ...memberBot("chief"), modelSelection: { instanceId: "", model: "" } };
    const handler = createHandler();
    const { request } = fakeRequest(routed((call) => {
      if (call.method === "PATCH") return { bot: { ...chief, title: "still wrong" } };
      return handler(call);
    }));
    seedRegistry({ chief: chief.id, research: "team-research", execution: "team-execution" });

    const error = await createStarterTeam(request, {
      existing: [chief, memberBot("research"), memberBot("execution")],
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StarterTeamBuildError);
    expect((error as Error).message).not.toContain("could not be repaired");
  });

  it("shares one run between concurrent calls", async () => {
    const { request, calls } = fakeRequest(routed(createHandler()));
    const [first, second] = await Promise.all([createStarterTeam(request), createStarterTeam(request)]);
    expect(second).toBe(first);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(3);
    expect(Object.keys(registry())).toEqual(["chief", "research", "execution"]);
  });

  it("keeps the bots it already made when a later profile write fails", async () => {
    let patches = 0;
    const handler = createHandler();
    const { request, calls } = fakeRequest(routed((call) => {
      if (call.method === "PATCH" && ++patches === 2) throw new Error("profile patch rejected");
      return handler(call);
    }));

    const error = await createStarterTeam(request).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StarterTeamBuildError);
    const failure = error as StarterTeamBuildError;
    expect(failure.uncertain).toBe(false);
    expect(failure.confirmedBots.map((bot) => bot.id)).toEqual(["bot-1", "bot-2"]);
    expect(failure.message).toContain("Already ready: Chief, Analyst");
    expect(failure.message).not.toContain("profile patch rejected");
    expect(failure.message).not.toContain("bot-1");
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
    expect(calls.some((call) => call.method === "POST" && call.body?.name === "Operator")).toBe(false);
    expect(registry()).toEqual({ chief: "bot-1", research: "bot-2" });
  });

  it("completes the team on retry without duplicating a bot confirmed by the failed attempt", async () => {
    let failResearch = true;
    const handler = createHandler();
    const { request, calls } = fakeRequest(routed((call) => {
      if (call.method === "POST" && call.body?.name === "Analyst" && failResearch) {
        throw new Error("connection reset");
      }
      return handler(call);
    }));

    const error = await createStarterTeam(request).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(StarterTeamBuildError);
    const confirmed = (error as StarterTeamBuildError).confirmedBots;
    expect(confirmed.map((bot) => bot.name)).toEqual(["Chief"]);

    failResearch = false;
    const completed = await createStarterTeam(request, { existing: confirmed });

    expect(completed.bots.map((bot) => bot.name)).toEqual(["Chief", "Analyst", "Operator"]);
    expect(calls.filter((call) => call.method === "POST" && call.body?.name === "Chief")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(4);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(registry()).toEqual({ chief: "bot-1", research: "bot-2", execution: "bot-3" });
  });

  it("sends no DELETE and lists no bots when a create response is lost", async () => {
    const handler = createHandler();
    const { request, calls } = fakeRequest(routed((call) => {
      if (call.method === "POST" && call.path === "/api/bots") {
        handler(call);
        throw new Error("connection reset");
      }
      return handler(call);
    }));

    const error = await createStarterTeam(request).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StarterTeamBuildError);
    const failure = error as StarterTeamBuildError;
    expect(failure.uncertain).toBe(true);
    expect(failure.confirmedBots).toEqual([]);
    expect(failure.message).toContain("There may be an extra bot");
    expect(failure.message).not.toContain("connection reset");
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(calls.filter((call) => call.method === "GET" && call.path.startsWith("/api/bots"))).toHaveLength(0);
  });

  it("never sweeps a same-named bot it did not create", async () => {
    const older = fixture("older", { name: "Chief" });
    const handler = createHandler();
    const { request, calls } = fakeRequest(routed((call) => {
      if (call.method === "POST" && call.path === "/api/bots") throw new Error("connection reset");
      return handler(call);
    }));

    const error = await createStarterTeam(request, { existing: [older] }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StarterTeamBuildError);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(calls.some((call) => call.method === "PATCH" && call.path.endsWith("older"))).toBe(false);
  });

  it("stops before creating anything when the server has no model", async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.path === ENVIRONMENT_PATH) return { environmentId: ENVIRONMENT };
      if (call.method === "GET" && call.path === "/api/bot-defaults") {
        return { modelSelection: { instanceId: "", model: "" } };
      }
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });

    await expect(createStarterTeam(request)).rejects.toBeInstanceOf(StarterTeamUnavailableError);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  });

  it("turns a requireAvailableModel refusal into a plain unavailable error", async () => {
    const handler = createHandler();
    const { request, calls } = fakeRequest(routed((call) => {
      if (call.method === "POST" && call.path === "/api/bots") {
        throw new Error('model instance "claude" is unavailable');
      }
      return handler(call);
    }));

    const failure = createStarterTeam(request, { modelSelection: { instanceId: "claude", model: "sonnet" } });

    await expect(failure).rejects.toBeInstanceOf(StarterTeamUnavailableError);
    await expect(failure).rejects.toThrow('model instance "claude" is unavailable');
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
  });

  it("drops registered ids that no longer exist and keeps the ones that do", async () => {
    seedRegistry({ chief: "gone", research: "team-research", execution: "team-execution" });
    const { request, calls } = fakeRequest(routed(createHandler()));
    const research = memberBot("research");
    const execution = memberBot("execution");

    const result = await createStarterTeam(request, { existing: [research, execution] });

    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "PATCH").map((call) => call.path)).toEqual([`/api/bots/${result.chief.id}`]);
    expect(result.bots.map((bot) => bot.id)).toEqual([result.chief.id, "team-research", "team-execution"]);
    expect(registry()).toEqual({
      chief: result.chief.id,
      research: "team-research",
      execution: "team-execution",
    });
  });

  it("keeps one registry per workspace, so A to B to A reuses A's team", async () => {
    let environment = "workspace-a";
    const { request, calls } = fakeRequest(routed(createHandler(), () => environment));

    const a = await createStarterTeam(request);
    environment = "workspace-b";
    const b = await createStarterTeam(request, { existing: [] });
    environment = "workspace-a";
    const back = await createStarterTeam(request, { existing: a.bots });

    expect(b.bots.map((bot) => bot.id)).not.toEqual(a.bots.map((bot) => bot.id));
    expect(back.bots.map((bot) => bot.id)).toEqual(a.bots.map((bot) => bot.id));
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(6);
    expect(registry("workspace-a")).toEqual({
      chief: a.bots[0]!.id,
      research: a.bots[1]!.id,
      execution: a.bots[2]!.id,
    });
    expect(registry("workspace-b")).toEqual({
      chief: b.bots[0]!.id,
      research: b.bots[1]!.id,
      execution: b.bots[2]!.id,
    });
  });

  it("builds the team the person chose instead of the default three, with the first member as chief", async () => {
    const { request, calls } = fakeRequest(routed(createHandler()));
    const members = [
      { key: "onboarding-support", roleId: "assistant", name: "Lia", title: "Atendimento", description: "Responde clientes.", soul: "Soul A" },
      { key: "onboarding-writer", roleId: "writer", name: "Caio", title: "Conteudo", description: "Escreve posts.", soul: "Soul B" },
    ];

    const result = await createStarterTeam(request, { members });

    expect(result.bots.map((bot) => bot.name)).toEqual(["Lia", "Caio"]);
    expect(result.chief).toBe(result.bots[0]);
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toMatchObject([
      { name: "Lia", title: "Atendimento", requireAvailableModel: true },
      { name: "Caio", title: "Conteudo", requireAvailableModel: true },
    ]);
    expect(calls.filter((call) => call.method === "PATCH").map((call) => call.body!.soul)).toEqual(["Soul A", "Soul B"]);
    expect(registry()).toEqual({ "onboarding-support": result.bots[0]!.id, "onboarding-writer": result.bots[1]!.id });
  });

  it("uses the member keyed chief as chief and creates nothing twice on a retry", async () => {
    const { request, calls } = fakeRequest(routed(createHandler()));
    const members = [
      { key: "onboarding-research", roleId: "research", name: "Rita", title: "Pesquisa", description: "Pesquisa.", soul: "Soul R" },
      { key: "chief", roleId: "assistant", name: "Ana", title: "Coordenacao", description: "Coordena.", soul: "Soul C" },
    ];
    const first = await createStarterTeam(request, { members });
    expect(first.chief.name).toBe("Ana");
    const writes = calls.filter((call) => call.method !== "GET").length;

    const second = await createStarterTeam(request, { members, existing: first.bots });

    expect(second.bots.map((bot) => bot.id)).toEqual(first.bots.map((bot) => bot.id));
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(writes);
  });

  it("keeps the default team and a chosen team apart when both run at once", async () => {
    const { request } = fakeRequest(routed(createHandler()));
    const members = [{ key: "onboarding-support", roleId: "assistant", name: "Lia", title: "Atendimento", description: "Responde.", soul: "S" }];

    const [defaults, chosen] = await Promise.all([createStarterTeam(request), createStarterTeam(request, { members })]);

    expect(defaults.bots).toHaveLength(3);
    expect(chosen.bots.map((bot) => bot.name)).toEqual(["Lia"]);
  });

  it("ignores registry entries with keys it did not write", async () => {
    seedRegistry({ chief: "bot-x", "Not A Key": "bot-y", "": "bot-z" } as Record<string, string>);
    const { request } = fakeRequest(routed(createHandler()));

    await createStarterTeam(request);

    expect(Object.keys(registry()).sort()).toEqual(["chief", "execution", "research"]);
  });

  it("gives up on a request that never settles and frees the next attempt", async () => {
    vi.useFakeTimers();
    const stalled = fakeRequest((call) => {
      if (call.path === ENVIRONMENT_PATH) return { environmentId: ENVIRONMENT };
      if (call.method === "GET" && call.path === "/api/bot-defaults") {
        return { modelSelection: { instanceId: "claude", model: "sonnet" } };
      }
      if (call.method === "POST") return new Promise(() => {});
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    const failure = createStarterTeam(stalled.request);
    const rejected = expect(failure).rejects.toBeInstanceOf(StarterTeamBuildError);

    await vi.advanceTimersByTimeAsync(STARTER_TEAM_TIMEOUT_MS);
    await rejected;
    const error = await failure.catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(StarterTeamBuildError);
    const timedOut = error as StarterTeamBuildError;
    expect(timedOut.uncertain).toBe(true);
    expect(timedOut.confirmedBots).toEqual([]);
    expect(stalled.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);

    vi.useRealTimers();
    const { request } = fakeRequest(routed(createHandler()));
    const completed = await createStarterTeam(request);
    expect(completed.bots).toHaveLength(3);
  });
});
