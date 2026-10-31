import type { Decider } from "./decider/index.ts";

/**
 * The title of an approval card says what the action does, in plain Portuguese
 * ("Social quer publicar a página do artigo"), never that a bot wants to run a
 * command. First the engine's own words for the call, when they are Portuguese;
 * then Jev picking the closest plain action; then the card's generic line.
 */

const PT_MARKS = /[ãõçáéíóúâêôà]/i;
const PT_WORDS = new Set(["de", "da", "do", "das", "dos", "para", "com", "um", "uma", "o", "os", "as", "no", "na", "nos", "nas", "e", "em", "que", "arquivo", "arquivos", "pagina", "site", "pasta", "publicar", "criar", "alterar", "apagar", "instalar", "enviar", "baixar", "abrir", "ver", "salvar", "atualizar", "conferir", "verificar"]);
const EN_WORDS = new Set(["the", "to", "and", "for", "of", "with", "file", "files", "run", "install", "check", "list", "create", "update", "build", "push", "commit", "from", "into", "in", "on", "a", "an", "is", "this", "new"]);

export function looksPortuguese(text: string): boolean {
  const words = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z]+/g) ?? [];
  if (!words.length) return false;
  const pt = words.filter((word) => PT_WORDS.has(word)).length + (PT_MARKS.test(text) ? 2 : 0);
  const en = words.filter((word) => EN_WORDS.has(word)).length;
  return pt > en;
}

/** No commands, paths or code in a title: those stay in the card's details. */
function looksTechnical(text: string): boolean {
  return /[`$|<>{}\\;]|\s-{1,2}[a-z]|\/[\w.-]+\/|\.(?:sh|js|ts|py|json|md|html)\b|&&/i.test(text);
}

const MAX_EXPLANATION_CHARS = 400;
const MAX_EXPLANATION_SENTENCES = 3;

function flatten(description: string | undefined): string {
  return description?.replace(/\s+/g, " ").trim() ?? "";
}

/**
 * The engine's description, made into the end of "{name} quer …", or undefined when it cannot be one. The description
 * is written for the card body ("Quero rodar os testes. Só leio …"), so the title takes its first sentence without the
 * leading "Quero".
 */
export function engineIntent(description: string | undefined): string | undefined {
  const flat = flatten(description);
  const first = /^.+?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  const whole = first.replace(/[.!]+$/, "").replace(/^quero\s+/i, "");
  const action = whole.length > 90 ? (whole.split(",")[0] ?? "") : whole;
  if (!action || action.length > 90 || !looksPortuguese(action) || looksTechnical(action)) return undefined;
  return action.charAt(0).toLowerCase() + action.slice(1);
}

/** The engine's description as the card's own words: one to three plain Portuguese sentences, or undefined. */
export function engineExplanation(description: string | undefined): string | undefined {
  const flat = flatten(description);
  if (!flat || flat.length > MAX_EXPLANATION_CHARS || !looksPortuguese(flat) || looksTechnical(flat)) return undefined;
  if ((flat.match(/[.!?](?=\s|$)/g)?.length ?? 0) > MAX_EXPLANATION_SENTENCES) return undefined;
  const sentence = flat.charAt(0).toUpperCase() + flat.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** What Jev may answer: each one finishes "{name} quer …". */
export const PLAIN_ACTIONS = {
  publish: "publicar no site",
  editSite: "alterar arquivos do site",
  editFiles: "alterar arquivos",
  createFiles: "criar arquivos",
  deleteFiles: "apagar arquivos",
  install: "instalar um programa",
  download: "baixar arquivos da internet",
  saveVersion: "salvar uma versão do trabalho",
  deploy: "colocar uma atualização no ar",
  send: "enviar uma mensagem",
  settings: "mudar uma configuração do computador",
  restart: "reiniciar um serviço",
  look: "consultar arquivos e informações",
  other: "fazer uma alteração",
} as const;

export type PlainAction = keyof typeof PLAIN_ACTIONS;

export const APPROVAL_INTENT_TIMEOUT_MS = 1_500;
const MIN_PROBABILITY = 0.45;

/** Jev's pick, as the phrase itself, or null when Jev is off, slow or unsure. */
export async function jevIntent(
  decider: Pick<Decider, "choose">,
  input: { tool: string; command?: string; description?: string },
): Promise<string | null> {
  try {
    const result = await decider.choose("criticalCheck", {
      tool: input.tool,
      command: input.command?.slice(0, 600),
      description: input.description?.slice(0, 200),
    }, {
      instructions: "A bot asks the person to approve one action on its computer. Pick the plain description of what the action does for the person. Choose other when none fits.",
      options: PLAIN_ACTIONS,
    }, { timeoutMs: APPROVAL_INTENT_TIMEOUT_MS });
    if (!result.ok || result.answers.pTop < MIN_PROBABILITY) return null;
    return PLAIN_ACTIONS[result.answers.choice as PlainAction] ?? null;
  } catch {
    return null;
  }
}
