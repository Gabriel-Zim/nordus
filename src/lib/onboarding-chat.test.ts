import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "./i18n";
import {
  CHAT_PROGRESS_KEY,
  aboutSuggestions,
  businessKind,
  chatOnboardingDue,
  chatSteps,
  chosenAgents,
  clearChatProgress,
  companyBlock,
  companyFromEmail,
  companySuggestions,
  currentStep,
  mergeCompanyBlock,
  oneLine,
  parseChatProgress,
  progressShare,
  proposeTeam,
  railRows,
  readChatProgress,
  recordStep,
  stepsLeft,
  suggestedTools,
  writeChatProgress,
  type ChatProgress,
  type ChatStorage,
} from "./onboarding-chat";

function storage(initial: Record<string, string> = {}): ChatStorage & { values: Map<string, string> } {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

beforeEach(() => setLocale("en"));

describe("the steps", () => {
  it("run company, context, import, agents, tools, then the optional team", () => {
    expect(chatSteps({ team: false })).toEqual(["company", "about", "import", "agents", "tools"]);
    expect(chatSteps({ team: true })).toEqual(["company", "about", "import", "agents", "tools", "team"]);
  });

  it("start on the first one nobody answered, and end on done", () => {
    const steps = chatSteps({ team: true });
    expect(currentStep({}, steps)).toBe("company");
    expect(currentStep({ company: { outcome: "done", value: "Alves Studio" } }, steps)).toBe("about");
    expect(currentStep({ company: { outcome: "done" }, about: { outcome: "skipped" } }, steps)).toBe("import");
    const everything: ChatProgress = Object.fromEntries(steps.map((id) => [id, { outcome: "skipped" as const }]));
    expect(currentStep(everything, steps)).toBe("done");
  });

  it("count what is left, never the optional team when it is not offered", () => {
    const answered: ChatProgress = { company: { outcome: "done" }, about: { outcome: "skipped" } };
    expect(stepsLeft(answered, chatSteps({ team: false }))).toBe(3);
    expect(stepsLeft(answered, chatSteps({ team: true }))).toBe(4);
    expect(progressShare({}, chatSteps({ team: false }))).toBe(0);
    expect(progressShare(answered, chatSteps({ team: false }))).toBeCloseTo(0.4);
  });

  it("belong to the first run in simple mode only", () => {
    expect(chatOnboardingDue({ hosted: false, replay: false, advanced: false })).toBe(true);
    expect(chatOnboardingDue({ hosted: true, replay: false, advanced: false })).toBe(false);
    expect(chatOnboardingDue({ hosted: false, replay: true, advanced: false })).toBe(false);
    expect(chatOnboardingDue({ hosted: false, replay: false, advanced: true })).toBe(false);
  });
});

describe("the rail", () => {
  it("names the steps in Portuguese the way the product speaks", () => {
    setLocale("pt-br");
    const rows = railRows({}, chatSteps({ team: true }), "company");
    expect(rows.map((row) => row.label)).toEqual(["Workspace", "Contexto", "Trazer seus agentes", "Agentes e IA", "Ferramentas", "Time"]);
    expect(rows.at(-1)?.answer).toBe("opcional");
  });

  it("shows a short answer for each finished step, and marks the one in front", () => {
    const progress: ChatProgress = {
      company: { outcome: "done", value: "Alves Studio" },
      about: { outcome: "done", value: "Fazemos campanhas." },
      import: { outcome: "skipped" },
    };
    const rows = railRows(progress, chatSteps({ team: true }), "agents");
    expect(rows.map((row) => [row.id, row.status, row.answer])).toEqual([
      ["company", "done", "Alves Studio"],
      ["about", "done", "Written"],
      ["import", "skipped", "Skipped"],
      ["agents", "current", null],
      ["tools", "upcoming", null],
      ["team", "upcoming", "optional"],
    ]);
  });

  it("sums up agents and apps without repeating the whole list", () => {
    const progress: ChatProgress = {
      agents: { outcome: "done", count: 3, names: ["Maya", "Lia", "Rae"] },
      tools: { outcome: "done", names: ["Gmail", "Slack", "Notion"] },
    };
    const rows = railRows(progress, ["agents", "tools"], "done");
    expect(rows.map((row) => row.answer)).toEqual(["3 agents", "Gmail, Slack and 1 more"]);
    expect(railRows({ agents: { outcome: "done", count: 1 } }, ["agents"], "done")[0]?.answer).toBe("1 agent");
    expect(railRows({ tools: { outcome: "done" } }, ["tools"], "done")[0]?.answer).toBe("Later");
  });
});

describe("the progress kept in the browser", () => {
  it("survives a reload and ignores what it does not know", () => {
    const kept = storage();
    const progress = recordStep(recordStep({}, "company", { outcome: "done", value: "Alves Studio" }), "about", { outcome: "skipped" });
    writeChatProgress(progress, kept);
    expect(readChatProgress(kept)).toEqual(progress);

    const messy = storage({
      [CHAT_PROGRESS_KEY]: JSON.stringify({
        company: { outcome: "done", value: "Alves", extra: "dropped" },
        mystery: { outcome: "done" },
        about: { outcome: "maybe" },
        agents: { outcome: "done", count: -4, names: ["Maya", 7, "", "Lia"] },
      }),
    });
    expect(readChatProgress(messy)).toEqual({
      company: { outcome: "done", value: "Alves" },
      agents: { outcome: "done", names: ["Maya", "Lia"] },
    });
  });

  it("starts clean when the stored text is broken or storage is missing", () => {
    expect(readChatProgress(storage({ [CHAT_PROGRESS_KEY]: "{nope" }))).toEqual({});
    expect(readChatProgress(storage({ [CHAT_PROGRESS_KEY]: "[1,2]" }))).toEqual({});
    expect(readChatProgress(null)).toEqual({});
    expect(() => writeChatProgress({ company: { outcome: "done" } }, null)).not.toThrow();
    expect(parseChatProgress("text")).toEqual({});
  });

  it("clears when the welcome is finished", () => {
    const kept = storage();
    writeChatProgress({ company: { outcome: "done" } }, kept);
    clearChatProgress(kept);
    expect(kept.values.size).toBe(0);
  });

  it("caps what it stores", () => {
    const long = "x".repeat(5_000);
    const progress = parseChatProgress({ about: { outcome: "done", value: long }, tools: { outcome: "done", names: Array.from({ length: 20 }, (_, index) => `App ${index}`) } });
    expect(progress.about?.value?.length).toBe(700);
    expect(progress.tools?.names).toHaveLength(8);
  });
});

describe("the suggested answers", () => {
  it("read a company out of a work address, never out of a personal mailbox", () => {
    expect(companyFromEmail("ana@alvesstudio.com.br")).toBe("Alvesstudio");
    expect(companyFromEmail("ana@alves-studio.com")).toBe("Alves Studio");
    expect(companyFromEmail("ana@mail.example.com")).toBe("Example");
    expect(companyFromEmail("ana@gmail.com")).toBeNull();
    expect(companyFromEmail("ana@hotmail.com.br")).toBeNull();
    expect(companyFromEmail("not an email")).toBeNull();
  });

  it("put the company already saved first, then the address, then a personal fallback", () => {
    expect(companySuggestions({ company: "Alves Studio", name: "Ana Alves", email: "ana@alvesstudio.com.br" }))
      .toEqual(["Alves Studio", "Alvesstudio", "Ana's workspace"]);
    expect(companySuggestions({ name: "Ana Alves", email: "ana@gmail.com" })).toEqual(["Ana's workspace"]);
    expect(companySuggestions({})).toEqual(["My workspace"]);
    setLocale("pt-br");
    expect(companySuggestions({ name: "Ana Alves" })).toEqual(["Espaço de Ana"]);
  });

  it("guess what the business does from its name and offer every kind", () => {
    expect(businessKind("Alves Studio")).toBe("marketing");
    expect(businessKind("Loja da Rua")).toBe("store");
    expect(businessKind("Nuvem Software")).toBe("software");
    expect(businessKind("Clínica Sol")).toBe("services");
    expect(businessKind("Alves & Filhos")).toBeNull();
    const likely = aboutSuggestions("Alves Studio");
    expect(likely).toHaveLength(4);
    expect(likely[0]?.kind).toBe("marketing");
    expect(new Set(likely.map((entry) => entry.kind)).size).toBe(4);
    expect(aboutSuggestions("Alves & Filhos")[0]?.kind).toBe("services");
  });

  it("clean a line of text before it is used", () => {
    expect(oneLine("  Alves \n\t Studio\u0007  ", 80)).toBe("Alves Studio");
    expect(oneLine("x".repeat(100), 10)).toHaveLength(10);
  });
});

describe("the team proposed", () => {
  it("is three agents when nothing says what the business does, and four when something does", () => {
    const generic = proposeTeam({ company: "Alves & Filhos", about: "Fazemos coisas." });
    expect(generic.map((entry) => entry.id)).toEqual(["coordinator", "support", "research"]);
    expect(proposeTeam({ company: "Alves Studio", about: "" }).map((entry) => entry.id)).toEqual(["coordinator", "content", "research", "support"]);
    expect(proposeTeam({ company: "Nuvem", about: "Desenvolvemos um aplicativo." }).map((entry) => entry.id)).toEqual(["coordinator", "dev", "research", "support"]);
    expect(proposeTeam({ company: "Casa", about: "Vendemos produtos pela internet" }).map((entry) => entry.id)).toEqual(["coordinator", "support", "content", "data"]);
    expect(proposeTeam({ company: "Casa", about: "Atendimento a clientes" }).map((entry) => entry.id)).toEqual(["coordinator", "support", "ops", "research"]);
  });

  it("starts every agent checked, with a name, a role and a description in the person's language", () => {
    const team = proposeTeam({ company: "Alves Studio", about: "" });
    expect(team.every((entry) => entry.checked && entry.name && entry.title && entry.description)).toBe(true);
    setLocale("pt-br");
    const portuguese = proposeTeam({ company: "Alves Studio", about: "" });
    expect(portuguese.map((entry) => [entry.name, entry.title])).toEqual([
      ["Maya", "Coordenação"],
      ["Caio", "Conteúdo"],
      ["Rita", "Pesquisa"],
      ["Lia", "Atendimento"],
    ]);
  });

  it("keeps only the checked, named ones, and trims what the person typed", () => {
    const team = proposeTeam({ company: "Alves Studio", about: "" });
    const edited = team.map((entry, index) => {
      if (index === 0) return { ...entry, name: "  Maya \n Lima  " };
      if (index === 1) return { ...entry, checked: false };
      if (index === 2) return { ...entry, name: "   " };
      return { ...entry, title: "x".repeat(200) };
    });
    const chosen = chosenAgents(edited);
    expect(chosen.map((entry) => entry.id)).toEqual(["coordinator", "support"]);
    expect(chosen[0]?.name).toBe("Maya Lima");
    expect(chosen[1]?.title).toHaveLength(60);
  });
});

describe("the company paragraph in the team's shared instructions", () => {
  const block = companyBlock({ company: "Alves Studio", about: "We create content for brands." });

  it("is a heading and two plain lines", () => {
    expect(block).toBe("## About the company\nCompany: Alves Studio\nWhat we do: We create content for brands.");
    setLocale("pt-br");
    expect(companyBlock({ company: "", about: "Fazemos campanhas." })).toBe("## Sobre a empresa\nO que fazemos: Fazemos campanhas.");
  });

  it("is added after the instructions the team already has", () => {
    expect(mergeCompanyBlock("", block)).toBe(`${block}\n`);
    expect(mergeCompanyBlock("Always be brief.\n", block)).toBe(`Always be brief.\n\n${block}\n`);
  });

  it("is replaced, not repeated, and leaves every other section alone", () => {
    const first = mergeCompanyBlock("Always be brief.\n\n## Tone\nFriendly.\n", block);
    const next = companyBlock({ company: "Alves Studio", about: "We sell online." });
    const second = mergeCompanyBlock(first, next);
    expect(second).toBe(`Always be brief.\n\n## Tone\nFriendly.\n\n${next}\n`);
    expect(mergeCompanyBlock(second, next)).toBe(second);
    const middle = mergeCompanyBlock("Intro.\n\n## About the company\nold\n\n## Tone\nFriendly.\n", next);
    expect(middle).toBe(`Intro.\n\n${next}\n\n## Tone\nFriendly.\n`);
  });

  it("is found under the other language's heading too", () => {
    const portuguese = "Oi.\n\n## Sobre a empresa\nEmpresa: Velha\n\n## Tom\nAmigável.\n";
    expect(mergeCompanyBlock(portuguese, block)).toBe(`Oi.\n\n${block}\n\n## Tom\nAmigável.\n`);
  });
});

describe("the apps offered", () => {
  const cards = ["github", "slack", "gmail", "googlecalendar", "notion", "hubspot", "zapier", "figma", "googledrive"].map((slug) => ({ slug, label: slug }));

  it("lead with what suits the business and never go past six", () => {
    const software = suggestedTools(cards, "Nuvem Software");
    expect(software.map((card) => card.slug)).toEqual(["github", "slack", "gmail", "notion", "googlecalendar", "googledrive"]);
    const generic = suggestedTools(cards, "Alves & Filhos");
    expect(generic.map((card) => card.slug)).toEqual(["gmail", "googlecalendar", "slack", "googledrive", "notion", "hubspot"]);
  });

  it("leave out an app the catalog does not have", () => {
    expect(suggestedTools([{ slug: "gmail" }, { slug: "zapier" }], "Alves Studio").map((card) => card.slug)).toEqual(["gmail"]);
  });
});
