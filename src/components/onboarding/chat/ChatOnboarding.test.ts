// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_PROGRESS_KEY } from "@/lib/onboarding-chat";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn() }));
const team = vi.hoisted(() => ({ create: vi.fn() }));
const apps = vi.hoisted(() => ({ connected: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: store.state, dispatch: store.dispatch }) }));
vi.mock("@/components/Avatar", () => ({ CritterAvatar: () => null }));
vi.mock("@/components/ConnectAI", () => ({
  ConnectAI: (props: { onConnected?: () => void }) => createElement("button", { type: "button", "data-connect-ai": "embedded", onClick: props.onConnected }, "connect-ai"),
}));
vi.mock("@/components/GrokImportFlow", () => ({ GrokImportFlow: () => createElement("div", { "data-grok-flow": "" }) }));
vi.mock("@/components/connected-apps", () => ({ preloadConnectedApps: apps.connected, ServiceIcon: () => null }));
vi.mock("@/lib/connector-oauth", () => ({ reserveConnectionPage: () => ({ open: async () => true, cancel: () => {} }) }));
vi.mock("../beats/TeamBeat", () => ({
  TeamBeat: (props: { onNext: () => void; onSkip: () => void }) => createElement("div", { "data-team-beat": "" },
    createElement("button", { type: "button", onClick: props.onNext }, "team-next"),
    createElement("button", { type: "button", onClick: props.onSkip }, "team-skip")),
}));
vi.mock("@/lib/starter-team", async (original) => ({
  ...(await original<typeof import("@/lib/starter-team")>()),
  createStarterTeam: team.create,
}));
import { ChatOnboarding } from "./ChatOnboarding";

let root: Root | null = null;
let container: HTMLElement;
const onDone = vi.fn();

const settle = async () => {
  for (let index = 0; index < 12; index++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const text = () => container.textContent ?? "";
const buttons = () => [...container.querySelectorAll("button")];
const button = (label: string) => buttons().find((candidate) => candidate.textContent?.includes(label));
const field = (label: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);

function mount(props: { team?: boolean } = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(createElement(ChatOnboarding, { onDone, ...props })));
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function press(label: string) {
  const target = button(label);
  expect(target, label).toBeTruthy();
  target!.click();
  await settle();
}

const stored = () => JSON.parse(localStorage.getItem(CHAT_PROGRESS_KEY) ?? "{}") as Record<string, unknown>;
const requests = () => store.api.mock.calls.map(([path, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${path as string}`);
const bodyOf = (method: string, path: string) => {
  const call = store.api.mock.calls.find(([candidate, init]) => candidate === path && ((init as RequestInit | undefined)?.method ?? "GET") === method);
  return call ? JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown> : undefined;
};

const ready = { instanceId: "claude", driverKind: "claudeAgent", snapshot: { state: "available", authenticated: true } };

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  document.body.replaceChildren();
  onDone.mockReset();
  store.dispatch.mockReset();
  store.api.mockReset();
  team.create.mockReset();
  apps.connected.mockReset().mockResolvedValue({ services: {}, authoritative: true });
  store.state = {
    config: { profile: { name: "Ana Alves", email: "ana@alvesstudio.com.br", aboutMe: "" } },
    instances: [ready],
    bots: [],
    groups: [],
  };
  store.api.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path === "/api/config" && method === "PUT") return { profile: { company: (JSON.parse(String(init!.body)).profile ?? {}).company }, onboarding: {} };
    if (path === "/api/section-context?section=") return method === "GET" ? { text: "Be brief.\n", maxBytes: 24_000 } : { ok: true };
    if (path === "/api/setup-import" && method === "GET") return { skills: [], tools: [] };
    if (path === "/api/connectors/catalog") return { configured: true, cards: [] };
    return {};
  });
});

afterEach(() => {
  flushSync(() => root?.unmount());
  root = null;
  delete (window as { ogb?: unknown }).ogb;
});

describe("the first question", () => {
  it("is the company name, with the answer already filled and every step waiting in the rail", () => {
    mount();

    expect(text()).toContain("What's your company called?");
    expect(field("Company name")!.value).toBe("Alvesstudio");
    const chips = [...container.querySelectorAll<HTMLButtonElement>("[role=group] button")];
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    for (const label of ["Company", "Context", "Bring your agents", "Agents and AI", "Tools"]) expect(text()).toContain(label);
    expect(container.querySelector("ol")!.textContent).not.toContain("Team");
    expect(text()).toContain("5 steps left");
    expect(button("Continue")!.textContent).toContain("↵");
    expect(button("Skip this step")).toBeTruthy();
    expect(container.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("0");
  });

  it("speaks Portuguese with the names the product uses", () => {
    setLocale("pt-br");
    mount({ team: true });

    expect(text()).toContain("Como se chama a sua empresa?");
    expect(container.querySelector("ol")!.textContent).toContain("Trazer seus agentes");
    expect(container.querySelector("ol")!.textContent).toContain("Agentes e IA");
    expect(container.querySelector("ol")!.textContent).toContain("opcional");
    expect(text()).toContain("Faltam 6 etapas");
    expect(text()).toContain("Pular esta etapa");
    expect(text()).not.toContain("—");
  });
});

describe("answering", () => {
  it("saves the company name on the workspace, then asks what the company does", async () => {
    mount();
    type(field("Company name")!, "Alves Studio");
    await press("Continue");

    expect(bodyOf("PUT", "/api/config")).toEqual({ profile: { company: "Alves Studio" } });
    expect(store.dispatch).toHaveBeenCalledWith({ type: "profileSaved", profile: { company: "Alves Studio" } });
    expect(text()).toContain("what do you do?");
    expect(container.querySelector("ol")!.textContent).toContain("Alves Studio");
    expect(text()).toContain("4 steps left");
    expect(stored()).toEqual({ company: { outcome: "done", value: "Alves Studio" } });
  });

  it("starts on a suggestion the person can pick or replace", async () => {
    mount();
    const chips = [...container.querySelectorAll<HTMLButtonElement>("[role=group] button")];
    chips[1]!.click();
    await settle();

    expect(field("Company name")!.value).toBe(chips[1]!.textContent);
    expect(container.querySelectorAll("[role=group] button[aria-pressed=true]")).toHaveLength(1);
  });

  it("will not save an empty name", async () => {
    mount();
    type(field("Company name")!, "   ");
    await settle();

    expect(button("Continue")!.disabled).toBe(true);
    expect(requests()).toEqual([]);
  });

  it("tells the person when the name could not be saved and stays on the question", async () => {
    store.api.mockRejectedValue(new Error("offline"));
    mount();
    await press("Continue");

    expect(text()).toContain("I couldn't save that");
    expect(text()).not.toContain("offline");
    expect(text()).toContain("What's your company called?");
    expect(stored()).toEqual({});
  });

  it("writes what the company does into the team's shared instructions, from the textarea with Enter", async () => {
    localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify({ company: { outcome: "done", value: "Alves Studio" } }));
    mount();
    expect(text()).toContain("what do you do?");
    const about = field("What you do") as HTMLTextAreaElement;
    expect(about.value).toContain("content and campaigns");

    type(about, "We create content for local brands.");
    about.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(requests()).toEqual([]);

    about.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();

    expect(requests()).toEqual(["GET /api/section-context?section=", "PUT /api/section-context?section="]);
    expect(bodyOf("PUT", "/api/section-context?section=")).toEqual({
      text: "Be brief.\n\n## About the company\nCompany: Alves Studio\nWhat we do: We create content for local brands.\n",
    });
    expect(stored()).toMatchObject({ about: { outcome: "done", value: "We create content for local brands." } });
    expect(text()).toContain("Do you already use a Grok Bot?");
  });

  it("says so when the shared instructions have no room", async () => {
    localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify({ company: { outcome: "done", value: "Alves Studio" } }));
    store.api.mockImplementation(async (path: string, init?: RequestInit) =>
      path === "/api/section-context?section=" && (init?.method ?? "GET") === "GET" ? { text: "x".repeat(23_990), maxBytes: 24_000 } : {});
    mount();
    await press("Continue");

    expect(text()).toContain("instructions are full");
    expect(requests()).not.toContain("PUT /api/section-context?section=");
  });
});

describe("skipping", () => {
  it("leaves a step unanswered, says so in the rail, and moves on", async () => {
    mount();
    await press("Skip this step");

    expect(stored()).toEqual({ company: { outcome: "skipped" } });
    expect(requests()).toEqual([]);
    expect(text()).toContain("what do you do?");
    expect(container.querySelector("ol")!.textContent).toContain("Skipped");
    expect(text()).toContain("4 steps left");
  });

  it("can skip the import, the agents and the tools in turn until the end", async () => {
    mount();
    for (let index = 0; index < 5; index++) await press("Skip this step");

    expect(Object.keys(stored())).toEqual(["company", "about", "import", "agents", "tools"]);
    expect(text()).toContain("All set");
    expect(text()).toContain("You're ready to start");
  });
});

describe("coming back after a reload", () => {
  it("opens on the first step nobody answered, with the earlier answers in the rail", () => {
    localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify({
      company: { outcome: "done", value: "Alves Studio" },
      about: { outcome: "skipped" },
    }));
    mount();

    expect(text()).toContain("Do you already use a Grok Bot?");
    expect(container.querySelector("ol")!.textContent).toContain("Alves Studio");
    expect(container.querySelector("ol")!.textContent).toContain("Skipped");
    expect(text()).toContain("3 steps left");
    expect(container.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("40");
    expect(requests()).not.toContain("PUT /api/config");
  });

  it("goes straight to the end when everything was answered", () => {
    localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify(Object.fromEntries(["company", "about", "import", "agents", "tools"].map((id) => [id, { outcome: "skipped" }]))));
    mount();

    expect(text()).toContain("You're ready to start");
  });
});

describe("bringing in what the person already uses", () => {
  const found = { skills: [{ name: "pdf", source: "claudeCode" }], tools: [{ name: "github", source: "cursor" }] };
  const resumed = () => localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify({ company: { outcome: "done" }, about: { outcome: "done" } }));

  it("says there is nothing to bring when nothing was found, and skipping that is not an import", async () => {
    resumed();
    (window as { ogb?: unknown }).ogb = { remoteClient: { active: false } };
    mount();
    await settle();

    expect(requests()).toContain("GET /api/setup-import");
    expect(text()).toContain("I didn't find anything to bring over");
    await press("Continue");
    expect(stored().import).toEqual({ outcome: "skipped" });
  });

  it("brings in the skills and tools that were found, then moves on", async () => {
    resumed();
    (window as { ogb?: unknown }).ogb = { remoteClient: { active: false } };
    store.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/setup-import" && (init?.method ?? "GET") === "GET") return found;
      if (path === "/api/setup-import") {
        return {
          skills: { added: ["pdf"], present: [], skipped: [{ name: "docs", reason: "conflict" }], filesLeftOut: 0, review: [] },
          tools: { added: ["github"], present: [], skipped: [] },
        };
      }
      return {};
    });
    mount();
    await settle();
    expect(text()).toContain("Do you already use other agents?");

    await press("Bring them in");

    expect(bodyOf("POST", "/api/setup-import")).toEqual({ skills: true, tools: true });
    expect(text()).toContain("Skipped docs");
    await press("Continue");
    expect(stored().import).toEqual({ outcome: "done", count: 2 });
    expect(text()).toContain("put together a team");
  });
});

describe("choosing agents", () => {
  const resumed = () => localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify({
    company: { outcome: "done", value: "Alves Studio" },
    about: { outcome: "done", value: "We create content for brands." },
    import: { outcome: "skipped" },
  }));
  const created = (names: string[]) => names.map((name, index) => ({ id: `bot-${index}`, name }) as Bot);

  it("proposes a team for the business with every agent checked and the names editable", () => {
    resumed();
    mount();

    expect(text()).toContain("put together a team");
    const names = [...container.querySelectorAll<HTMLInputElement>('[aria-label="Agent name"]')].map((input) => input.value);
    expect(names).toEqual(["Maya", "Cal", "Rae", "Lia"]);
    expect([...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].every((box) => box.checked)).toBe(true);
    expect(button("Create 4 agents")).toBeTruthy();
  });

  it("creates the agents that stayed checked, with the names and roles typed, and adds them without opening them", async () => {
    resumed();
    const bots = created(["Maya", "Rae"]);
    team.create.mockResolvedValue({ bots, chief: bots[0] });
    mount();
    type(container.querySelectorAll<HTMLInputElement>('[aria-label="Agent name"]')[0]!, "Mia");
    container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1]!.click();
    container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[3]!.click();
    await settle();

    await press("Create 2 agents");

    expect(team.create).toHaveBeenCalledOnce();
    const [, options] = team.create.mock.calls[0]!;
    expect(options.members.map((member: { key: string; name: string }) => [member.key, member.name])).toEqual([
      ["onboarding-coordinator", "Mia"],
      ["onboarding-research", "Rae"],
    ]);
    expect(store.dispatch).toHaveBeenCalledWith({ type: "botAdded", bot: bots[0], preserveSelection: true });
    expect(store.dispatch).toHaveBeenCalledWith({ type: "botAdded", bot: bots[1], preserveSelection: true });
    expect(stored().agents).toEqual({ outcome: "done", count: 2, names: ["Maya", "Rae"] });
    expect(text()).toContain("Which apps will your agents use?");
    expect(container.querySelector("ol")!.textContent).toContain("2 agents");
  });

  it("asks for an AI first when none is connected, and offers the team once there is one", async () => {
    resumed();
    store.state = { ...store.state, instances: [{ ...ready, snapshot: { state: "available", authenticated: false } }] };
    mount();

    expect(text()).toContain("your agents need an AI");
    expect(container.querySelector("[data-connect-ai]")).toBeTruthy();
    expect(container.querySelector("input[type=checkbox]")).toBeNull();

    container.querySelector<HTMLButtonElement>("[data-connect-ai]")!.click();
    await settle();

    expect(text()).toContain("put together a team");
    expect(team.create).not.toHaveBeenCalled();
  });

  it("explains a missing AI in plain words and keeps the person on the step", async () => {
    resumed();
    const { StarterTeamUnavailableError } = await import("@/lib/starter-team");
    team.create.mockRejectedValue(new StarterTeamUnavailableError("model instance claude is unavailable"));
    mount();
    await press("Create 4 agents");

    expect(text()).toContain("your agents need an AI");
    expect(text()).not.toContain("model instance");
    expect(stored().agents).toBeUndefined();
  });

  it("keeps the agents the server confirmed when the build stops halfway, and shows no technical text", async () => {
    resumed();
    const { StarterTeamBuildError } = await import("@/lib/starter-team");
    const maya = created(["Maya"])[0]!;
    team.create.mockRejectedValue(new StarterTeamBuildError({ confirmedBots: [maya], uncertain: false }, new Error("POST /api/bots returned 500")));
    mount();
    await press("Create 4 agents");

    expect(store.dispatch).toHaveBeenCalledWith({ type: "botAdded", bot: maya, preserveSelection: true });
    expect(text()).toContain("Already ready: Maya");
    expect(text()).not.toContain("/api/bots");
    expect(button("Try again")).toBeTruthy();
    expect(stored().agents).toBeUndefined();
  });

  it("moves on without creating anything when every agent is unchecked", async () => {
    resumed();
    mount();
    for (const box of container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) box.click();
    await settle();
    await press("Continue");

    expect(team.create).not.toHaveBeenCalled();
    expect(stored().agents).toEqual({ outcome: "skipped" });
  });
});

describe("picking tools", () => {
  const resumed = () => localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify(Object.fromEntries(
    ["company", "about", "import", "agents"].map((id) => [id, { outcome: "skipped" }]),
  )));
  const catalog = {
    configured: true,
    cards: ["gmail", "googlecalendar", "slack"].map((slug) => ({ slug, label: slug === "gmail" ? "Gmail" : slug === "slack" ? "Slack" : "Google Calendar", blurb: "x", logo: null, domain: null })),
  };

  it("offers the catalog's apps and connects one with the same call the Apps screen makes", async () => {
    resumed();
    store.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/connectors/catalog") return catalog;
      if (path === "/api/connectors/gmail/authorize" && init?.method === "POST") return { url: "https://accounts.example.com/sign-in" };
      return { services: {} };
    });
    mount();
    await settle();
    expect(text()).toContain("Gmail");
    expect(text()).toContain("Google Calendar");

    const connect = buttons().filter((candidate) => candidate.textContent === "Connect")[0]!;
    connect.click();
    await settle();

    expect(requests()).toContain("POST /api/connectors/gmail/authorize");
    expect(button("Waiting")).toBeTruthy();
  });

  it("remembers the apps that are connected when the person continues, and says Later when none are", async () => {
    resumed();
    store.api.mockImplementation(async (path: string) => (path === "/api/connectors/catalog" ? catalog : {}));
    apps.connected.mockResolvedValue({ services: { gmail: { connected: true } }, authoritative: true });
    mount();
    await settle();
    expect(text()).toContain("Connected");
    await press("Continue");
    expect(stored().tools).toEqual({ outcome: "done", names: ["Gmail"] });
    expect(container.querySelector("ol")!.textContent).toContain("Gmail");
  });

  it("says plainly that apps cannot be connected here when the server is not set up for them", async () => {
    resumed();
    store.api.mockImplementation(async (path: string) => (path === "/api/connectors/catalog" ? { configured: false, cards: [] } : {}));
    mount();
    await settle();

    expect(text()).toContain("isn't available on this computer yet");
    await press("Continue");
    expect(stored().tools).toEqual({ outcome: "done" });
    expect(container.querySelector("ol")!.textContent).toContain("Later");
  });
});

describe("the team step", () => {
  const resumed = () => localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify(Object.fromEntries(
    ["company", "about", "import", "agents", "tools"].map((id) => [id, { outcome: "skipped" }]),
  )));

  it("comes last and only where it is offered", async () => {
    resumed();
    mount({ team: true });

    expect(container.querySelector("[data-team-beat]")).toBeTruthy();
    expect(container.querySelector("ol")!.textContent).toContain("Team");
    expect(text()).toContain("1 step left");
    await press("team-skip");
    expect(stored().team).toEqual({ outcome: "skipped" });
    expect(text()).toContain("You're ready to start");
  });

  it("is not part of a run that does not offer it", () => {
    resumed();
    mount({ team: false });

    expect(container.querySelector("[data-team-beat]")).toBeNull();
    expect(text()).toContain("You're ready to start");
  });
});

describe("the end", () => {
  const everything = {
    company: { outcome: "done", value: "Alves Studio" },
    about: { outcome: "done", value: "We create content." },
    import: { outcome: "skipped" },
    agents: { outcome: "done", count: 2, names: ["Maya", "Rae"] },
    tools: { outcome: "done", names: ["Gmail"] },
  };

  it("sums up what was set up", () => {
    localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify(everything));
    mount();

    expect(text()).toContain("Company: Alves Studio");
    expect(text()).toContain("Team instructions saved");
    expect(text()).toContain("2 agents: Maya and Rae");
    expect(text()).toContain("Connected apps: Gmail");
    expect(text()).toContain("All set");
  });

  it("opens the General room, records the welcome as done and forgets its progress", async () => {
    localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify(everything));
    store.state = { ...store.state, groups: [{ id: "room-general", name: "Geral", general: true }, { id: "dm", dm: true }] };
    mount();

    await press("Open General");

    expect(store.dispatch).toHaveBeenCalledWith({ type: "select", id: "room-general" });
    expect(onDone).toHaveBeenCalledOnce();
    expect(bodyOf("PUT", "/api/config")).toMatchObject({ onboarding: { version: expect.any(Number), completedAt: expect.any(String) } });
    expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "configStatus" }));
    expect(localStorage.getItem(CHAT_PROGRESS_KEY)).toBeNull();
  });

  it("opens the first new agent when there is no General room yet", async () => {
    localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify(everything));
    store.state = { ...store.state, bots: [{ id: "bot-maya", name: "Maya" }, { id: "bot-other", name: "Other" }] };
    mount();

    await press("Start chatting");

    expect(store.dispatch).toHaveBeenCalledWith({ type: "select", id: "bot-maya" });
  });

  it("keeps the progress when the record could not be saved, so the next start is not from scratch", async () => {
    localStorage.setItem(CHAT_PROGRESS_KEY, JSON.stringify(everything));
    store.api.mockRejectedValue(new Error("offline"));
    mount();

    await press("Get started");

    expect(onDone).toHaveBeenCalledOnce();
    expect(localStorage.getItem(CHAT_PROGRESS_KEY)).not.toBeNull();
  });

  it("lets the person leave at any step with Skip all, and only once", async () => {
    mount();
    await press("Skip all");
    await press("Skip all");

    expect(onDone).toHaveBeenCalledOnce();
    expect(bodyOf("PUT", "/api/config")).toMatchObject({ onboarding: { version: expect.any(Number) } });
  });

  it("leaves with Escape too", async () => {
    mount();
    container.querySelector("[role=dialog]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settle();

    expect(onDone).toHaveBeenCalledOnce();
  });
});
