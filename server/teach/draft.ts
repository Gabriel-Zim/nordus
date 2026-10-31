// Nordus: ensinar uma tarefa (frente G). Transforma uma gravacao num rascunho de skill (SKILL.md).
// O modelo leve so redige; o esqueleto das secoes e os avisos de aprovacao e login vem daqui, nunca do modelo.
import { DESCRIPTION_MAX, isSkillName, parseSkillMd, SKILL_NAME_MAX, yamlFrontmatterValue } from "../../shared/skill-md.ts";
import { teachStepLabel, type TeachRecording, type TeachStep } from "../../shared/teach.ts";
import { writtenSkillDescription, writtenSkillProblem, WRITTEN_INSTRUCTIONS_MAX } from "../../shared/written-skill.ts";

export interface TeachDraft {
  /** kebab-case, isSkillName */
  name: string;
  description: string;
  /** "Aprendi: ..." sem o prefixo */
  sentence: string;
  /** Como a pessoa pede, ex.: "faz aquela do suporte" */
  trigger: string;
  /** Corpo do SKILL.md */
  instructions: string;
  /** Nome de uma tarefa ensinada existente quando a gravacao e so um trecho dela. */
  updates?: string;
}

export interface TaughtForPrompt { name: string; description: string; text?: string }

const STUCK_RE = /me mostra s[oó] onde fica/i;
/** A ultima fala do robo pedia ajuda para achar um elemento: a gravacao e um trecho de uma tarefa que ja existe. */
export function botAskedToBeShown(line: string | undefined): boolean { return !!line && STUCK_RE.test(line); }

function clip(text: string, max: number): string { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; }
}

export function slugifyName(text: string): string {
  const slug = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, SKILL_NAME_MAX).replace(/-+$/g, "");
  return slug;
}

/** Nome livre entre as tarefas e skills que o robo ja tem (acrescenta -2, -3...). */
export function uniqueTeachName(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; i < 100; i++) {
    const suffix = `-${i}`;
    const candidate = `${name.slice(0, SKILL_NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${name.slice(0, SKILL_NAME_MAX - 7)}-${Date.now().toString(36).slice(-6)}`;
}

/** Passo com as pistas entre parenteses (texto do botao, papel, seletor). Nada de valor secreto: ele nem existe no passo. */
export function teachStepWithHints(step: TeachStep): string {
  const a = step.action;
  const hints: string[] = [];
  if (a.kind === "click") { if (a.role) hints.push(`papel: ${a.role}`); if (a.selector) hints.push(`seletor: ${a.selector}`); }
  if (a.kind === "type" || a.kind === "type-secret") { if (a.field) hints.push(`campo: ${a.field}`); if (a.selector) hints.push(`seletor: ${a.selector}`); }
  const site = hostOf(step.url);
  if (site && a.kind !== "navigate") hints.push(`site: ${site}`);
  const label = a.kind === "type-secret" ? teachStepLabel(step) + " (o valor não foi gravado)" : teachStepLabel(step);
  return hints.length ? `${label} (${hints.join("; ")})` : label;
}

export interface TeachPromptInput {
  recording: TeachRecording;
  lastBotLine?: string;
  taught: TaughtForPrompt[];
  change?: string;
  previous?: TeachDraft;
}

export function teachPrompt(input: TeachPromptInput): string {
  const { recording, lastBotLine, taught, change, previous } = input;
  const steps = recording.steps.map((s) => `${s.n}. ${teachStepWithHints(s)}${s.critical ? " [CRÍTICO]" : ""}`).join("\n");
  const known = taught.length
    ? taught.map((t) => `- ${t.name}: ${t.description}${t.text ? `\n  Texto atual da tarefa:\n${clip(t.text, 4000).split("\n").map((l) => `  | ${l}`).join("\n")}` : ""}`).join("\n")
    : "(nenhuma)";
  const snippet = botAskedToBeShown(lastBotLine);
  return [
    "Você transforma a gravação de uma pessoa usando um navegador numa tarefa que um robô vai repetir. Escreva em português do Brasil, sem travessão.",
    "Responda SOMENTE com um objeto JSON, sem texto em volta, com estes campos:",
    '{"name":"nome-curto-em-kebab-case","description":"uma frase dizendo o que a tarefa faz e quando usar","sentence":"o que você aprendeu, em uma frase curta, começando com verbo no infinitivo ou no presente (sem o prefixo Aprendi)","trigger":"como a pessoa pediria, ex.: faz aquela do suporte","objective":"uma frase com o objetivo","steps":["passo por intenção, não coordenadas"],"checks":["o que conferir na tela"],"updates":"nome de tarefa existente, só se for o caso"}',
    "Regras:",
    '- Escreva os passos pela intenção ("Abrir a caixa de entrada do suporte em exemplo.com", "Achar a conversa mais antiga sem resposta"), e traga entre parênteses as pistas úteis: texto do botão, papel e seletor.',
    '- Valores digitados que parecem do caso (nome de cliente, texto de resposta) viram "o texto que a pessoa pedir" quando fizer sentido. Valores fixos (um filtro, um status) ficam como estão.',
    "- Passos marcados [CRÍTICO] (enviar, apagar, pagar, publicar, comprar, aceitar termos) ficam nos passos como estão; a aprovação é tratada à parte.",
    "- Nunca escreva senha, código ou dado de cartão. Passos de login só dizem que o login é necessário.",
    "- O gatilho (trigger) é a frase curta e natural que a pessoa diria para repetir a tarefa.",
    snippet
      ? `- A última fala do robô pedia ajuda para achar um elemento ("${clip(lastBotLine ?? "", 200)}"). Se esta gravação é só um trecho de uma das tarefas já ensinadas, preencha "updates" com o nome dela e devolva também "instructions" com o texto COMPLETO da tarefa atualizada (as seções ## Objetivo, ## Quando usar, ## Passos, ## Pontos de conferência), trocando só o trecho que mudou.`
      : "- Se a gravação for claramente um trecho de uma tarefa já ensinada, preencha updates; senão deixe de fora.",
    "",
    "Tarefas já ensinadas neste robô:",
    known,
    ...(previous ? ["", "Rascunho anterior (a pessoa pediu para mudar):", JSON.stringify({ name: previous.name, description: previous.description, sentence: previous.sentence, trigger: previous.trigger, updates: previous.updates }), previous.instructions] : []),
    ...(change ? ["", `Ajuste pedido pela pessoa: ${clip(change, 600)}`] : []),
    "",
    `Gravação (${recording.steps.length} passos):`,
    steps || "(sem passos)",
  ].join("\n");
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, max) : [];
}

export function cleanSentence(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/^aprendi\s*[:,-]?\s*/i, "").replace(/[.\s]+$/, "").trim();
}

export function composeInstructions(input: { sentence: string; trigger: string; description: string; steps: string[]; checks: string[]; objective?: string }): string {
  const objective = (input.objective?.trim() || input.sentence).replace(/[.\s]+$/, "");
  return [
    "## Objetivo",
    `${objective}.`,
    "",
    "## Quando usar",
    `Quando a pessoa pedir "${input.trigger}" ou algo parecido. ${input.description}`.trim(),
    "",
    "## Passos",
    ...input.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Pontos de conferência",
    ...(input.checks.length ? input.checks.map((c) => `- ${c}`) : ["- Ao terminar, confira na tela que o resultado apareceu."]),
  ].join("\n");
}

/** O JSON que o modelo devolveu (pode vir com texto em volta), ou null quando nao serve. */
export function parseTeachDraft(text: string): TeachDraft | null {
  const json = firstJsonObject(text);
  if (!json) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(json) as Record<string, unknown>; } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const sentence = typeof raw.sentence === "string" ? cleanSentence(raw.sentence) : "";
  if (!sentence) return null;
  let name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!isSkillName(name)) name = slugifyName(name || sentence);
  if (!isSkillName(name)) return null;
  const description = writtenSkillDescription(typeof raw.description === "string" && raw.description.trim() ? raw.description : sentence).slice(0, DESCRIPTION_MAX);
  const trigger = typeof raw.trigger === "string" && raw.trigger.trim() ? raw.trigger.replace(/\s+/g, " ").trim().replace(/^["']+|["']+$/g, "").slice(0, 120) : sentence.toLowerCase();
  const steps = strings(raw.steps, 80);
  const given = typeof raw.instructions === "string" ? raw.instructions.trim() : "";
  if (!steps.length && !given) return null;
  const instructions = given || composeInstructions({ sentence, trigger, description, steps, checks: strings(raw.checks, 40), objective: typeof raw.objective === "string" ? raw.objective : undefined });
  const updates = typeof raw.updates === "string" && isSkillName(raw.updates.trim()) ? raw.updates.trim() : undefined;
  return { name, description, sentence, trigger, instructions: instructions.slice(0, WRITTEN_INSTRUCTIONS_MAX), ...(updates ? { updates } : {}) };
}

/** Sem modelo: tudo sai direto dos passos. */
export function fallbackTeachDraft(recording: TeachRecording): TeachDraft {
  const steps = recording.steps;
  const site = hostOf(steps.find((s) => s.url)?.url ?? "");
  const base = slugifyName(`tarefa-${site || "navegador"}`) || "tarefa-navegador";
  const name = `${base.slice(0, SKILL_NAME_MAX - 3)}-${steps.length}`.replace(/-+/g, "-");
  const sentence = site ? `uma tarefa em ${site} com ${steps.length} passos` : `uma tarefa no navegador com ${steps.length} passos`;
  const description = writtenSkillDescription(`Repete a tarefa que a pessoa ensinou${site ? ` em ${site}` : ""}.`);
  const trigger = `repete a tarefa${site ? ` de ${site}` : ""}`;
  const checks = steps.filter((s) => s.action.kind === "navigate" || s.action.kind === "tab").map((s) => `Confira que a página aberta é ${s.action.kind === "navigate" ? s.action.url : s.title || s.url}.`);
  return {
    name: isSkillName(name) ? name : "tarefa-navegador", description, sentence, trigger,
    instructions: composeInstructions({ sentence, trigger, description, steps: steps.map(teachStepWithHints), checks: checks.slice(0, 20) }),
  };
}

function hasSection(instructions: string, title: string): boolean {
  return new RegExp(`^##\\s+${title}\\s*$`, "im").test(instructions);
}

/** O SKILL.md final. Garante as secoes de seguranca mesmo que o modelo as tenha esquecido. */
export function teachSkillMd(draft: TeachDraft, recording: TeachRecording): string {
  let body = draft.instructions.trim();
  const critical = recording.steps.filter((s) => s.critical);
  if (!hasSection(body, "Se a página mudar")) {
    body += "\n\n## Se a página mudar\nProcure o elemento pelo texto ou pela função dele, não pela posição. Se não achar, pare e peça na conversa: \"Me mostra só onde fica <elemento>.\" e espere a pessoa ensinar o trecho.";
  }
  if (!hasSection(body, "Ações que pedem aprovação")) {
    const lines = critical.length ? critical.map((s) => `- Passo ${s.n}: ${teachStepLabel(s)}`) : ["- Nenhum passo gravado pede aprovação, mas qualquer ação que envie, apague, pague, publique ou compre pede."];
    body += `\n\n## Ações que pedem aprovação\n${lines.join("\n")}\nAntes de enviar, apagar, pagar, publicar ou comprar, pergunte na conversa e espere o sim da pessoa. Nunca pule essa pergunta.`;
  }
  const secrets = recording.steps.filter((s) => s.action.kind === "type-secret");
  if (secrets.length && !hasSection(body, "Login")) {
    const sites = [...new Set(secrets.map((s) => (s.action.kind === "type-secret" ? s.action.site : "") || hostOf(s.url)).filter(Boolean))];
    body += `\n\n## Login\nSe pedir login em ${sites.length ? sites.join(", ") : "algum site"}, use o login salvo do Chaveiro ou peça para a pessoa entrar pela tela do navegador. Nunca peça senha ou código no chat.`;
  }
  return taughtSkillMd({ name: draft.updates ?? draft.name, description: draft.description, instructions: body.slice(0, WRITTEN_INSTRUCTIONS_MAX) });
}

/** Como o writtenSkillMd, mas sem o cabecalho de comando escrito (/nome): uma tarefa ensinada se pede em palavras. */
function taughtSkillMd(input: { name: string; description: string; instructions: string }): string {
  const problem = writtenSkillProblem(input);
  if (problem) throw new Error(`taught skill: invalid ${problem}`);
  const name = input.name.trim();
  const description = writtenSkillDescription(input.description);
  const text = `---\nname: ${name}\ndescription: ${yamlFrontmatterValue(description)}\n---\n\n` +
    "Tarefa ensinada pela pessoa no navegador do robô. Siga os passos abaixo no seu navegador.\n\n" +
    `${input.instructions.trim()}\n`;
  const parsed = parseSkillMd(text);
  if ("error" in parsed || parsed.name !== name || parsed.description !== description) throw new Error("taught skill: did not round-trip");
  return text;
}
