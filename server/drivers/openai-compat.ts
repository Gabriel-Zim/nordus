// Transcript-replay driver for OpenRouter, Groq, Together, llama.cpp, and
// other endpoints that speak the OpenAI chat-completions contract.
import type { ModelCatalog, ProviderDriver } from "../contracts.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";
import {
  freeDefault, freeFallbackCatalog, freeLabel, freeToolModels, freeToolsFirst, isOpenRouterOrigin, openRouterFreeTier,
  withOpenRouterTurns, type OpenRouterModelRow,
} from "./openrouter-free.ts";

const DRIVER_KIND = "openai-compat";
const DEFAULT_IDLE_TIMEOUT_MS = 180_000;
const idleTimeoutMs = () => {
  const raw = process.env.NORDUS_OPENAI_COMPAT_IDLE_TIMEOUT_MS;
  if (!raw) return DEFAULT_IDLE_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1_000 && value <= 2_147_483_647 ? value : DEFAULT_IDLE_TIMEOUT_MS;
};
const DEFAULT_MODELS: ModelCatalog = {
  default: "meta-llama/llama-3.3-70b-instruct",
  options: [
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (OpenRouter)", custom: true },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Groq)", custom: true },
  ],
};

const DEFAULT_KEY_ENV = "OPENAI_COMPAT_API_KEY";
/** A provider's own key: such an instance never falls back to the workspace OpenAI-compatible key, URL,
 * model or routing. */
const OWN_KEY_ENVS = new Set(["NORDUS_OPENAI_API_KEY", "NORDUS_OPENROUTER_API_KEY", "NORDUS_GEMINI_API_KEY"]);

const OPENAI_MODELS: ModelCatalog = {
  default: "gpt-5",
  options: [
    { id: "gpt-5", label: "gpt-5" },
    { id: "gpt-5-mini", label: "gpt-5-mini" },
  ],
};

/** Shown only until Google's own /models answers. */
const GEMINI_MODELS: ModelCatalog = {
  default: "gemini-2.5-pro",
  options: [
    { id: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { id: "gemini-2.5-flash", label: "gemini-2.5-flash" },
  ],
};

/** Google's OpenAI-compatible /models names models `models/<id>`; chat completions takes the bare id. */
export function geminiModelId(id: string): string {
  return id.replace(/^models\//, "");
}

/** Google's /models also lists embeddings, Imagen, Veo, speech, live-audio and question-answering models. */
function isGeminiChatModel(id: string): boolean {
  if (!/^(gemini-|gemma-)/i.test(id)) return false;
  return !/(embedding|tts|native-audio|live|image-generation|aqa|imagen|veo)/i.test(id);
}

/** Callable chat ids, deduplicated, newest generation first (Google's order otherwise). */
export function geminiChatModels(rows: Array<{ id?: unknown }>): string[] {
  const generation = (id: string) => Number(/^gemini-(\d+(?:\.\d+)?)/i.exec(id)?.[1] ?? 0);
  const ids = [...new Set(rows.flatMap((row) => typeof row.id === "string" ? [geminiModelId(row.id)] : []))]
    .filter(isGeminiChatModel);
  return ids.map((id, index) => ({ id, index }))
    .sort((a, b) => generation(b.id) - generation(a.id) || a.index - b.index)
    .map(({ id }) => id);
}

/** OpenAI's /models also lists embeddings, speech, images, moderation and Responses-only models. */
export function isOpenAIChatModel(id: string): boolean {
  if (!/^(gpt-|chatgpt-|o\d)/i.test(id)) return false;
  return !/(audio|realtime|tts|transcribe|search|image|embedding|moderation|instruct|codex|computer-use|deep-research|-pro\b)/i.test(id);
}

export interface OpenAICompatConfig {
  tools?: boolean;
  url: string;
  apiKeyEnv: string;
  catalog?: "openai" | "gemini";
  key?: string;
  model?: string;
  provider?: string;
  managedModels?: string[];
}

function isOpenRouterUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

function decodeConfig(raw: unknown): OpenAICompatConfig {
  const config = (raw ?? {}) as Record<string, unknown>;
  if (config.tools !== undefined && typeof config.tools !== "boolean") throw new Error("tools must be a boolean");
  if (config.managedModels !== undefined && (!Array.isArray(config.managedModels) || !config.managedModels.length || config.managedModels.some(model => typeof model !== "string" || !model.trim()))) throw new Error("Invalid managed models.");
  const ownKey = typeof config.apiKeyEnv === "string" && OWN_KEY_ENVS.has(config.apiKeyEnv);
  if (config.catalog !== undefined && config.catalog !== "openai" && config.catalog !== "gemini") {
    throw new Error("catalog must be \"openai\" or \"gemini\"");
  }
  const envUrl = ownKey ? undefined : process.env.OPENAI_COMPAT_URL;
  return {
    ...(config.tools !== undefined ? { tools: config.tools as boolean } : {}),
    ...(config.managedModels ? { managedModels: config.managedModels as string[] } : {}),
    url: (typeof config.url === "string" && config.url ? config.url : envUrl || "https://openrouter.ai/api/v1")
      .replace(/\/+$/, ""),
    apiKeyEnv: typeof config.apiKeyEnv === "string" && config.apiKeyEnv
      ? config.apiKeyEnv
      : DEFAULT_KEY_ENV,
    ...(config.catalog === "openai" || config.catalog === "gemini" ? { catalog: config.catalog } : {}),
    key: typeof config.key === "string" && config.key ? config.key : undefined,
    model: typeof config.model === "string" && config.model
      ? config.model
      : ownKey ? undefined : process.env.OPENAI_COMPAT_MODEL || undefined,
    // An explicit empty override disables inherited routing; absent still inherits the global pin.
    provider: typeof config.provider === "string"
      ? config.provider || undefined
      : ownKey ? undefined : process.env.OPENAI_COMPAT_PROVIDER || undefined,
  };
}

export const OpenAICompatDriver: ProviderDriver<OpenAICompatConfig> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Other (OpenAI-compatible)",
    supportsMultipleInstances: true,
    access: "api",
  },
  models: DEFAULT_MODELS,
  install: {
    docsUrl: "https://openrouter.ai/keys",
    settings: "connections",
    signInCommand: "Save an OpenAI-compatible API key in Settings → API keys, or set OPENAI_COMPAT_API_KEY on the server.",
  },
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input) {
    const { config } = input;
    // An instance naming its own key variable reads only that one: the workspace key must not reach its host.
    const ownKeyVariable = config.apiKeyEnv !== DEFAULT_KEY_ENV;
    const apiKey =
      config.key ??
      input.environment[config.apiKeyEnv] ??
      (ownKeyVariable ? undefined : input.environment[DEFAULT_KEY_ENV]) ??
      process.env[config.apiKeyEnv] ??
      (ownKeyVariable ? undefined : process.env[DEFAULT_KEY_ENV]) ??
      "";
    const missingKey = !ownKeyVariable || OWN_KEY_ENVS.has(config.apiKeyEnv)
      ? "No API key — open Settings → API keys."
      : `no API key — set ${config.apiKeyEnv} or add it to the instance config`;
    const gemini = config.catalog === "gemini";
    const seeded = config.catalog === "openai" ? OPENAI_MODELS : gemini ? GEMINI_MODELS : DEFAULT_MODELS;
    // A model saved as Google lists it (`models/…`) is called by its bare id.
    const savedModel = gemini && config.model ? geminiModelId(config.model) : config.model;
    let catalog: ModelCatalog = config.managedModels
      ? { default: config.managedModels[0], options: config.managedModels.map(id => ({ id, label: id })) }
      : savedModel
      ? {
          default: savedModel,
          options: seeded.options.some((model) => model.id === savedModel)
            ? seeded.options
            : [{ id: savedModel, label: savedModel, custom: true }, ...seeded.options],
        }
      : seeded;
    const openRouter = Boolean(apiKey) && !config.managedModels && isOpenRouterOrigin(config.url);
    const freeTier = () => openRouter ? openRouterFreeTier(apiKey, config.url) : Promise.resolve(null);

    const fetchModels = async () => {
      if (config.managedModels) return;
      if (!apiKey) return;
      try {
        const response = await fetch(`${config.url}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return;
        type Row = OpenRouterModelRow & { name?: unknown; created?: unknown };
        const json = await response.json() as { data?: Row[] } | Row[];
        let rows = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
        // OpenAI lists its catalog unordered and mixed with non-chat models.
        if (config.catalog === "openai") {
          rows = rows
            .filter((row) => typeof row.id === "string" && isOpenAIChatModel(row.id))
            .sort((a, b) => (typeof b.created === "number" ? b.created : 0) - (typeof a.created === "number" ? a.created : 0));
        }
        if (gemini) rows = geminiChatModels(rows).map((id) => ({ id }));
        const seen = new Set<string>();
        const options: ModelCatalog["options"] = [];
        for (const row of rows) {
          const id = typeof row.id === "string" ? row.id : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const label = typeof row.name === "string" && row.name.trim() ? row.name : id;
          options.push({
            id,
            label: openRouter ? freeLabel(label, row) : label,
            ...(config.catalog === "openai" || gemini ? {} : { custom: true }),
          });
        }
        if (!options.length) return;
        const freeTools = await freeTier() ? freeToolModels(rows) : [];
        const ordered = freeToolsFirst(options, freeTools);
        if (savedModel && !ordered.some((model) => model.id === savedModel)) {
          ordered.unshift({ id: savedModel, label: savedModel, custom: true });
        }
        catalog = { default: savedModel ?? freeDefault(freeTools) ?? ordered[0].id, options: ordered };
      } catch {}
    };
    const loading = apiKey ? Promise.all([
      config.model ? null : freeTier().then((free) => {
        if (free && catalog === seeded) catalog = freeFallbackCatalog(seeded);
      }),
      fetchModels(),
    ]) : null;

    const runtime = createOpenAIChatRuntime({
      input,
      driverKind: DRIVER_KIND,
      apiKey,
      apiUrl: config.url,
      tools: config.tools,
      computerUse: true,
      nudgeAnnouncedAction: true,
      models: () => catalog,
      refreshModels: fetchModels,
      requestBody: (model, messages, stream) => ({
        model: gemini ? geminiModelId(model) : model,
        messages,
        stream,
        stream_options: stream ? { include_usage: true } : undefined,
        ...(config.provider && isOpenRouterUrl(config.url)
          ? { provider: { order: [config.provider], allow_fallbacks: false } }
          : {}),
      }),
      httpErrorLabel: "upstream",
      missingKeyError: missingKey,
      unavailableReason: missingKey,
      timeoutMs: idleTimeoutMs(),
      reasoning: true,
      billing: "metered",
      includeUsageInCompleted: true,
      nativeLog: {
        source: "openai-compat.chat.completions",
        outgoing: (_turn, messages, model, tools) => ({
          model,
          messageCount: messages.length,
          tools: tools.map(tool => tool.function.name),
        }),
        incoming: ({ text, reasoning, usage }) => ({
          textLength: text.length,
          reasoningLength: reasoning.length,
          usage,
        }),
      },
    });
    return openRouter && loading ? withOpenRouterTurns(runtime, loading) : runtime;
  },
};
