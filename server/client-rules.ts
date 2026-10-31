// Nordus QG: a client's rule lives in that client's ficha (<cwd>/fichas/<client>/regras.md), read by every QG bot
// working on that client, never in one bot's MEMORY.md, which mixes clients and is cut at 200 lines / 24 KB.

import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { redactSecretsInText } from "../shared/redact.ts";
import { writeFileAtomic } from "./atomic.ts";

const CLIENT_SLUG = /^[a-z0-9-]{2,40}$/;
const HEADING = "## Regras";

/** What the person sees for a client's rule: on the card, in the decision log and in what Jev is asked to confirm. */
export const clientRuleText = (lesson: string, client?: string): string => client ? `Regra da ${client.toUpperCase()}: ${lesson}` : lesson;
/** The activity line after Jev saves a rule the person asked for. */
export const lessonSavedLabel = (client?: string): string => client ? `Regra salva na ficha da ${client.toUpperCase()}` : "Regra salva";

export type ClientRulesTarget = { ok: true; path: string } | { ok: false; error: string };

const shown = (client: string) => JSON.stringify(client.length > 60 ? `${client.slice(0, 59)}…` : client);

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** `<botCwd>/fichas/<client>/regras.md`, only for a slug whose folder already exists and stays inside fichas once links are followed. */
export function clientRulesPath(botCwd: string, client: string): ClientRulesTarget {
  if (!CLIENT_SLUG.test(client)) {
    return { ok: false, error: `cliente inválido: ${shown(client)}. Use o nome da pasta da ficha, em minúsculas, como "lumon".` };
  }
  const noFicha: ClientRulesTarget = { ok: false, error: `este cliente ainda não tem ficha: ${client}. Crie fichas/${client}/ antes de guardar regras dele.` };
  if (!isAbsolute(botCwd)) return { ok: false, error: `este bot não trabalha numa pasta com fichas, então não há onde guardar a regra de ${client}.` };
  const fichas = join(botCwd, "fichas");
  const folder = join(fichas, client);
  let fichasReal: string;
  let folderReal: string;
  try {
    fichasReal = realpathSync(fichas);
    folderReal = realpathSync(folder);
    if (!statSync(folderReal).isDirectory()) return noFicha;
  } catch {
    return noFicha;
  }
  const escape: ClientRulesTarget = { ok: false, error: `a ficha de ${client} aponta para fora da pasta fichas; a regra não foi guardada.` };
  if (!inside(fichasReal, folderReal)) return escape;
  const path = join(folder, "regras.md");
  let fileReal: string | undefined;
  try {
    fileReal = realpathSync(path);
  } catch (error) {
    // Missing is fine (it is created); a link that leads nowhere is not.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || lstatSync(path, { throwIfNoEntry: false })) return escape;
  }
  if (fileReal !== undefined && !inside(fichasReal, fileReal)) return escape;
  return { ok: true, path };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Adds `- <regra> (DD/MM/AAAA)` right below `## Regras`, newest on top, creating the heading when it is missing. */
export function appendClientRule(path: string, lesson: string, date: Date): void {
  const rule = redactSecretsInText(lesson).replace(/\s+/g, " ").trim();
  const line = `- ${rule} (${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()})`;
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // A CRLF file keeps its line endings, and its "## Regras\r" is still the heading.
  const heading = /^## Regras[ \t]*\r?$/m.exec(text);
  const end = heading ? heading.index + heading[0].length : 0;
  const cr = heading?.[0].endsWith("\r") ? "\r" : "";
  const next = heading
    ? `${text.slice(0, end)}\n${line}${cr}${text.slice(end) || "\n"}`
    : `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${HEADING}\n${line}\n`;
  writeFileAtomic(path, next, { mode: 0o644 });
}
