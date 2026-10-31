// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { BotEditorStore, initialState, type InstanceInfo } from "@/state/store";
import {
  canConnectAutomatically,
  connectMethod,
  CONNECT_POLL_MS,
  useConnectEngine,
} from "./use-connect-engine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function instance(overrides: Partial<InstanceInfo> = {}): InstanceInfo {
  return {
    instanceId: "chatgpt",
    driverKind: "codex",
    displayName: "ChatGPT plan",
    snapshot: { state: "available", authenticated: false, chatgptPlan: true },
    authentication: { method: "browser-pkce" },
    install: { server: { package: "@openai/codex" } },
    ...overrides,
  } as InstanceInfo;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let current: ReturnType<typeof useConnectEngine>;
let root: ReturnType<typeof createRoot> | null = null;

function Probe({ target }: { target: InstanceInfo }) {
  current = useConnectEngine(target);
  return null;
}

function mount(target: InstanceInfo) {
  const value = {
    state: { ...initialState, instances: [target] },
    dispatch: vi.fn(),
    refreshInstances: vi.fn().mockResolvedValue(undefined),
    refreshModels: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof BotEditorStore>[0]["value"];
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(BotEditorStore, { value, children: createElement(Probe, { target }) }));
  });
}

async function flush(times = 8) {
  for (let tick = 0; tick < times; tick += 1) await Promise.resolve();
}

beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers();
  window.open = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connecting an engine end to end", () => {
  it("installs a missing engine before it starts the sign-in", async () => {
    const calls: string[] = [];
    let statusCalls = 0;
    const target = instance({
      snapshot: { state: "unavailable", reason: "not installed" },
      authentication: { method: "device-code" },
    });
    const installed = { ...target, snapshot: { state: "available", authenticated: false } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/install")) return response({ instances: [installed] });
      if (url.endsWith("/auth/start")) {
        return response({
          auth: {
            phase: "waiting",
            flowId: "flow-device",
            authorizationUrl: "https://auth.openai.com/codex/device",
            userCode: "ABCD-1234",
            expiresAt: null,
          },
        });
      }
      if (url.includes("/auth/status")) {
        statusCalls += 1;
        return response({
          auth: {
            phase: statusCalls >= 2 ? "succeeded" : "waiting",
            flowId: "flow-device",
            authorizationUrl: "https://auth.openai.com/codex/device",
            userCode: "ABCD-1234",
            expiresAt: null,
          },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(target);

    await act(async () => { await current.connect(); });
    expect(calls[0]).toBe("POST /api/instances/chatgpt/install");
    expect(calls[1]).toBe("POST /api/instances/chatgpt/auth/start");
    expect(current.status).toBe("needs-code");
    expect(current.flow?.code).toBe("ABCD-1234");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_POLL_MS);
      await flush();
    });
    expect(current.status).toBe("needs-code");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_POLL_MS);
      await flush();
    });
    expect(current.status).toBe("connected");
    expect(current.message).toContain("ChatGPT plan is connected");
    expect(statusCalls).toBe(2);
  });

  it("polls the browser sign-in until the engine reports it is connected", async () => {
    const target = instance();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/start")) {
        return response({
          auth: {
            phase: "waiting",
            flowId: "flow-browser",
            authorizationUrl: "https://auth.openai.com/api/accounts/authorize?client_id=codex",
            expiresAt: null,
          },
        });
      }
      if (url.includes("/auth/status")) {
        return response({ auth: { phase: "succeeded", flowId: "flow-browser", authorizationUrl: null, expiresAt: null } });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(target);

    await act(async () => { await current.connect(); });
    expect(current.status).toBe("waiting-browser");
    expect(window.open).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/authorize?client_id=codex",
      "_blank",
      "noopener,noreferrer",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_POLL_MS);
      await flush();
    });
    expect(current.status).toBe("connected");
  });

  it("finishes a paste-code sign-in with the code the person typed", async () => {
    const target = instance({ authentication: { method: "paste-code" } });
    let completed: unknown = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/start")) {
        return response({
          auth: {
            phase: "waiting",
            flowId: "flow-paste",
            authorizationUrl: "https://claude.ai/oauth/authorize?code=true",
            expiresAt: null,
          },
        });
      }
      if (url.endsWith("/auth/complete")) {
        completed = JSON.parse(String(init?.body));
        return response({ auth: { phase: "succeeded" } });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(target);

    await act(async () => { await current.connect(); });
    expect(current.status).toBe("needs-code");
    expect(window.open).toHaveBeenCalled();

    await act(async () => { await current.submitCode("  the-code  "); });
    expect(completed).toEqual({ flowId: "flow-paste", code: "the-code" });
    expect(current.status).toBe("connected");
  });

  it("turns a server failure into a friendly message without the raw error", async () => {
    const target = instance();
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "EACCES /usr/local/lib/node_modules" }, 500)));
    mount(target);

    await act(async () => { await current.connect(); });
    expect(current.status).toBe("failed");
    expect(current.message).toBe("We couldn't connect ChatGPT plan. Try again.");
    expect(current.message).not.toContain("EACCES");
  });

  it("marks an engine that is already signed in without any network call", async () => {
    const target = instance({ snapshot: { state: "available", authenticated: true } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mount(target);

    expect(current.status).toBe("connected");
    await act(async () => { await current.connect(); });
    expect(current.status).toBe("connected");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deciding which engines the friendly path can handle", () => {
  it("accepts installable sign-in engines and rejects command-only ones", () => {
    expect(connectMethod(instance())).toBe("browser-pkce");
    expect(canConnectAutomatically(instance({
      snapshot: { state: "unavailable", reason: "missing" },
      authentication: { method: "device-code" },
    }))).toBe(true);
    expect(canConnectAutomatically(instance({
      snapshot: { state: "unavailable", reason: "missing" },
      authentication: { method: "device-code" },
      install: { command: { linux: "npm install -g codex" } },
    }))).toBe(false);
    expect(canConnectAutomatically(instance({ readOnly: true }))).toBe(false);
    expect(canConnectAutomatically(instance({ access: "api", install: { settings: "connections" } }))).toBe(false);
  });
});
