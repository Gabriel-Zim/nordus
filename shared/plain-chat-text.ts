/** What a bot wrote, as a person reads it in the Nordus chat: no shell, no paths, no internal names, no em dash.
 *  The stored message keeps every character; "Ver original" in the bubble menu still shows it. */

const SHELL_FENCE = /^(?:bash|sh|shell|zsh|fish|console|terminal|powershell|pwsh|ps1?|cmd|bat|batch)$/i;
const FENCE = /(^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g;

/** A line typed at a terminal, not a phrase: a known command word, a flag, a pipe or a redirect. */
export function looksLikeShellCommand(text: string): boolean {
  const line = text.trim();
  if (!line || line.length > 200) return false;
  return /^(?:sudo|cd|ls|cat|rm|mv|cp|mkdir|chmod|chown|npm|pnpm|npx|yarn|git|curl|wget|python3?|pip3?|node|bash|sh|ssh|scp|docker|systemctl|journalctl|apt(?:-get)?|brew|kill|pkill|ps|top|df|du|grep|rg|find|tail|head|sed|awk|echo|export|source|crontab|ufw|iptables|tar|unzip|ffmpeg|vps|zorg-[\w-]+)(?:\s|$)/i.test(line)
    || /(?:^|\s)--?[a-z][\w-]*(?:\s|=|$)/i.test(line) && /\s/.test(line)
    || /\s(?:\||&&|>>?)\s/.test(line);
}

/** /home/x/file.md, ~/notas, C:\pasta\arquivo: a location on a disk. URLs are links, not paths. */
function looksLikePath(text: string): boolean {
  const value = text.trim();
  if (/^[a-z][\w+.-]*:\/\//i.test(value) || /\s/.test(value)) return false;
  return /^(?:~|\.{1,2})?\/[\w.@~-]/.test(value) || /^[A-Za-z]:\\/.test(value) || /^[\w.-]+(?:\/[\w.@-]+){2,}$/.test(value);
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** The product is Nordus to the person; the engine, its drivers and model names stay out of sight. */
function plainNames(text: string): string {
  return text
    .replace(/\bo driver do computador\s*\((?:CUA|cua)\)/g, "o computador")
    .replace(/\bdriver do computador\s*\((?:CUA|cua)\)/gi, "computador")
    .replace(/\bCUA Driver\b/g, "computador")
    .replace(/\bdriver do computador\b/gi, "computador")
    .replace(/\s*\((?:CUA|MCP|ACP|VM)\)/g, "")
    .replace(/\bNordus\b/gi, "Nordus")
    .replace(/\bClaude(?: Code| Agent| Opus| Sonnet| Haiku| Fable)?(?: \d+(?:\.\d+)*)?\b/g, "Nordus");
}

/** "isso — aquilo" reads "isso, aquilo"; a dash opening a line just goes. */
function plainDashes(text: string): string {
  return text
    .replace(/^([ \t]*(?:[-*>]\s+)?)[—–]\s*/gm, "$1")
    .replace(/\s*—\s*([.,;:!?)])/g, "$1")
    .replace(/\s*—\s*/g, ", ")
    .replace(/ – /g, ", ");
}

/** A link's destination and a bare address are where they lead: renaming a word inside them breaks the link. */
const ADDRESS = /\]\([^)\s]*(?:\s+"[^"]*")?\)|<[a-z][\w+.-]*:[^>\s]*>|\b[a-z][\w+.-]*:\/\/[^\s<>()]+/gi;

function plainWords(text: string): string {
  const inline = text.replace(/`([^`\n]+)`/g, (whole, code: string) => {
    if (looksLikePath(code)) return baseName(code);
    if (looksLikeShellCommand(code)) return "o comando";
    return whole;
  });
  return plainNames(inline)
    .replace(/^(\s*(?:[#>]+\s*)?(?:\*\*|__)?)Sources?(\s*:)/gim, "$1Fabrikam$2")
    .replace(/\[\s*@\s*/g, "[")
    .replace(/\[\s*From:\s*/gi, "[");
}

const ENGLISH = new Set(["the", "is", "are", "was", "were", "did", "does", "not", "first", "call", "record", "retrying", "retry", "trying", "again", "let", "me", "i", "i'll", "i'm", "will", "now", "this", "that", "it", "it's", "to", "of", "and", "with", "for", "on", "in", "check", "checking", "looks", "like", "seems", "done", "okay", "ok", "let's", "going", "need", "next", "then", "file", "files", "command", "tool", "output", "error", "failed", "works", "working"]);
const PORTUGUESE = new Set(["o", "a", "os", "as", "de", "do", "da", "dos", "das", "que", "e", "é", "não", "um", "uma", "para", "com", "no", "na", "em", "por", "eu", "você", "vou", "está", "já", "mais", "se", "foi", "isso", "aqui"]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-zà-úç']+/g) ?? [];
}

function englishSentence(sentence: string): boolean {
  const list = words(sentence);
  if (list.length === 0 || list.length > 25) return false;
  const english = list.filter((word) => ENGLISH.has(word)).length;
  const portuguese = list.filter((word) => PORTUGUESE.has(word)).length;
  if (portuguese > 0) return false;
  if (list.length <= 2 && english === list.length && /(?:\.\.\.|…)\s*$/.test(sentence)) return true;
  return english >= 2 && english / list.length >= 0.3;
}

/** A model narrating its own tool calls in English ("The first call did not record. Retrying...") between Portuguese
 *  sentences: in a Portuguese reply those short English sentences are dropped, the rest stays as written. */
function withoutEnglishNarration(text: string): string {
  const all = words(text);
  if (all.filter((word) => PORTUGUESE.has(word)).length < 3) return text;
  return text.split("\n").map((line) => {
    if (/^\s*(?:[|#>]|```)/.test(line)) return line;
    const sentences = line.split(/(?<=[.!?…])\s+/);
    const kept = sentences.filter((sentence) => !englishSentence(sentence));
    return kept.length === sentences.length ? line : kept.join(" ");
  }).join("\n");
}

function plainProse(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(ADDRESS)) {
    const start = match.index ?? 0;
    out += plainWords(text.slice(last, start)) + match[0];
    last = start + match[0].length;
  }
  return plainDashes(withoutEnglishNarration(out + plainWords(text.slice(last))));
}

/** Rewrites the prose of a bot's markdown for the chat; code that is not a shell command stays as written. */
export function plainChatText(text: string): string {
  if (!text) return text;
  let out = "";
  let last = 0;
  for (const match of text.matchAll(FENCE)) {
    const [whole, lead, , info] = match;
    const start = match.index ?? 0;
    out += plainProse(text.slice(last, start));
    const lang = (info ?? "").trim().split(/\s+/)[0] ?? "";
    const body = match[4] ?? "";
    const shell = SHELL_FENCE.test(lang) || (!lang && body.split("\n").filter(Boolean).every(looksLikeShellCommand));
    out += shell ? lead : whole;
    last = start + whole.length;
  }
  out += plainProse(text.slice(last));
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

const IMAGE_FILE = /\.(?:png|jpe?g|webp|gif|avif|heic)$/i;
const PATH_LINE = /^\s*(?:[-*]\s+)?(?:\[[^\]]*\]\(\s*<?([^)\s>]+)>?\s*\)|`?((?:~|\/)[^\s`]+)`?)\s*$/;

/** Pictures a message names by path ("Arquivos:" and one path per line) belong in the gallery, not in the words: the
 *  lines go, their paths come back to be shown as thumbnails, and a heading left with nothing under it goes too. */
export function splitImagePaths(text: string): { text: string; images: string[] } {
  if (!text || !text.includes("/")) return { text, images: [] };
  const images: string[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const match = PATH_LINE.exec(line);
    const path = match?.[1] ?? match?.[2];
    if (path && IMAGE_FILE.test(path)) {
      if (!images.includes(path)) images.push(path);
      continue;
    }
    kept.push(line);
  }
  if (images.length === 0) return { text, images };
  const cleaned = kept.filter((line, index) => {
    if (!/^\s*\**[\p{L} ]{2,24}:\**\s*$/u.test(line)) return true;
    const next = kept.slice(index + 1).find((candidate) => candidate.trim());
    return Boolean(next) && !/^\s*$/.test(kept[index + 1] ?? "");
  });
  return { text: cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim(), images };
}
