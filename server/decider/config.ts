// The decision model's settings in config.json (server/decider): schema and type, kept out of server/config.ts.
import { z } from "zod";

import { DECIDER_JOBS as DECIDER_JOB_NAMES } from "../../shared/decider-jobs.ts";

/** What a saved `decider.openrouterModel` must look like; the model picker
 * offers only ids that match it. */
export const OPENROUTER_MODEL_ID = /^[A-Za-z0-9][\w.-]*\/[\w.:-]+$/;
export const OPENROUTER_MODEL_ID_MAX = 128;

const optionalText = z.string().optional();

/** The decision model (server/decider): a fast classifier that picks
 * things for bots, starting with who answers a room message. `key` is the
 * Jev key and `openrouterKey` the OpenRouter one: write-only like every
 * credential, and kept apart from each other and from the engine's
 * OpenRouter key. `baseUrl` / `openrouterBaseUrl` point at a compatible
 * server instead of the vendor's (operator settings with no UI);
 * `openrouterModel` is an OpenRouter model id and `openrouterApi` says
 * whether it is a chat model or one of OpenRouter's decisions models
 * (`chat` when absent); `jobs` switches each
 * decision on or off. Not `decisions`: that section is the authorization
 * log's retention. */
export const deciderConfigSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["jev", "openrouter", "clef", "off"]).optional(),
  key: optionalText,
  openrouterKey: optionalText,
  openrouterModel: z
    .string()
    .trim()
    .max(OPENROUTER_MODEL_ID_MAX)
    .regex(OPENROUTER_MODEL_ID, "an OpenRouter model id looks like vendor/model")
    .optional(),
  openrouterApi: z.enum(["chat", "decisions"]).optional(),
  baseUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => !value || /^https?:\/\//i.test(value), "the decision model address must start with http:// or https://")
    .optional(),
  openrouterBaseUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => !value || /^https?:\/\//i.test(value), "the OpenRouter address must start with http:// or https://")
    .optional(),
  /** CLEF (Cloudflare Workers AI): `clef` or `clef-flash`. Its account id and token are never saved here: they come
   * from CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN in the environment, else from the env file at `clefEnvFile`
   * (else $NORDUS_CLEF_ENV_FILE). `clefBaseUrl` points at a compatible server (an AI Gateway, a test double);
   * `clefTimeoutMs` is the wait when a caller sets none. */
  clefModel: z.enum(["clef", "clef-flash"]).optional(),
  clefEnvFile: z.string().trim().max(1024).optional(),
  clefBaseUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => !value || /^https?:\/\//i.test(value), "the CLEF address must start with http:// or https://")
    .optional(),
  clefTimeoutMs: z.number().int().min(50).max(30_000).optional(),
  /** Jev aprova por você: how many credit-spending actions it may approve per task and per day. */
  autoApprove: z.object({
    creditsPerTask: z.number().int().min(0).max(1_000).optional(),
    creditsPerDay: z.number().int().min(0).max(10_000).optional(),
  }).optional(),
  /** Fixed-model bots and the Boss: a light request goes to the engine's newest Sonnet (default on). */
  simpleToSonnetForFixed: z.boolean().optional(),
  /** Bots (by id or name, any case) that never get that: EDITORDEVIDEO when absent. */
  simpleToSonnetExclude: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  jobs: z.object(Object.fromEntries(DECIDER_JOB_NAMES.map((job) => [job, z.boolean().optional()])) as Record<(typeof DECIDER_JOB_NAMES)[number], z.ZodOptional<z.ZodBoolean>>).optional(),
});

/** The decision model; see `deciderConfigSchema`. */
export interface DeciderConfig {
  enabled?: boolean;
  provider?: "jev" | "openrouter" | "clef" | "off";
  key?: string;
  baseUrl?: string;
  openrouterKey?: string;
  openrouterModel?: string;
  /** Which OpenRouter API `openrouterModel` is served by: absent is `chat`. */
  openrouterApi?: "chat" | "decisions";
  openrouterBaseUrl?: string;
  simpleToSonnetForFixed?: boolean;
  simpleToSonnetExclude?: string[];
  clefModel?: "clef" | "clef-flash";
  clefEnvFile?: string;
  clefBaseUrl?: string;
  clefTimeoutMs?: number;
  autoApprove?: { creditsPerTask?: number; creditsPerDay?: number };
  jobs?: Partial<Record<(typeof DECIDER_JOB_NAMES)[number], boolean>>;
}
