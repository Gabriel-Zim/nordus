// Picks a Live voice for a bot with Cloudflare's CLEF decision model (Workers AI). The key comes from the
// environment (or the decision model's env file); with no key, or on any failure, the caller keeps the app-wide voice.
import { LIVE_VOICE_OPTIONS } from "../shared/live-call.ts";
import { CLEF_DEFAULT_MODEL, clefBackend, clefCredentials, clefEndpoint as clefRunUrl } from "./decider/clef.ts";
import type { DeciderQuestion } from "./decider/types.ts";

export const CLEF_MODEL = `@cf/cloudflare/${CLEF_DEFAULT_MODEL}`;
export const CLEF_TIMEOUT_MS = 3_000;
const PERSONA_CHARS = 400;

export interface LivePersona {
  name: string;
  title?: string;
  description?: string;
}

export interface ChooseVoiceInput {
  persona: LivePersona;
  env?: Record<string, string | undefined>;
  /** The env file the decision model reads too (decider.clefEnvFile), when the environment lacks the key. */
  envFile?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The run URL and token for CLEF, from the decision model's own reader (server/decider/clef.ts). */
export function clefEndpoint(env: Record<string, string | undefined>, envFile?: string): { url: URL; token: string } | null {
  const credentials = clefCredentials(envFile, env);
  const url = credentials ? clefRunUrl(credentials.accountId) : null;
  return credentials && url ? { url, token: credentials.token } : null;
}

export function voiceQuestions(): Record<string, DeciderQuestion> {
  return {
    voice: {
      type: "choice",
      instructions: "Which voice suits this assistant's persona best? Its owner speaks Brazilian Portuguese, so prefer a Brazilian Portuguese voice unless the persona clearly points elsewhere. Match the persona's gender, tone and role.",
      options: Object.fromEntries(LIVE_VOICE_OPTIONS.map((option) => [option.id, option.label.replace(" (default)", "")])),
    },
  };
}

const clip = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, PERSONA_CHARS);

/** The catalog id CLEF picks, or null when there is no key or anything goes wrong. Never throws. */
export async function chooseLiveVoice(input: ChooseVoiceInput): Promise<string | null> {
  try {
    const target = clefEndpoint(input.env ?? process.env, input.envFile);
    if (!target) return null;
    const questions = voiceQuestions();
    const state = { name: clip(input.persona.name), title: clip(input.persona.title), description: clip(input.persona.description) };
    const result = await clefBackend.decide({
      key: target.token,
      baseUrl: target.url.href,
      state,
      questions,
      signal: AbortSignal.timeout(input.timeoutMs ?? CLEF_TIMEOUT_MS),
      fetch: input.fetch ?? fetch,
    });
    if (!result.ok) return null;
    const answer = result.answers.voice;
    return answer?.type === "choice" && LIVE_VOICE_OPTIONS.some((option) => option.id === answer.choice) ? answer.choice : null;
  } catch {
    return null;
  }
}
