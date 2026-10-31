import { isMentionBoundary, isMentionNameContinuation } from "./mention-boundary.ts";

export const PERSON_TAG = "you";

const RESERVED = new Set(["everyone", "all"]);

export function personTagNames(profileName?: string | null): string[] {
  const name = profileName?.replace(/^@+/, "").replace(/\s+/g, " ").trim() ?? "";
  const folded = name.toLowerCase();
  return name && folded !== PERSON_TAG && !RESERVED.has(folded) ? [PERSON_TAG, name] : [PERSON_TAG];
}

function tagMatches(rest: string, name: string): boolean {
  return rest.slice(0, name.length).toLowerCase() === name.toLowerCase()
    && !isMentionNameContinuation(rest.slice(name.length));
}

export function personTagAt(rest: string, personNames: readonly string[], botNames: readonly string[]): number | undefined {
  const bot = Math.max(0, ...botNames.filter((name) => name.trim() && tagMatches(rest, name)).map((name) => name.length));
  const person = Math.max(0, ...personNames.filter((name) => tagMatches(rest, name)).map((name) => name.length));
  return person > bot ? person : undefined;
}

export interface PersonTagOptions {
  profileName?: string | null;
  botNames?: readonly string[];
}

export function personMentionRanges(text: string, options: PersonTagOptions = {}): { start: number; end: number }[] {
  const personNames = personTagNames(options.profileName);
  const botNames = options.botNames ?? [];
  const ranges: { start: number; end: number }[] = [];
  let at = -1;
  while ((at = text.indexOf("@", at + 1)) !== -1) {
    if (!isMentionBoundary(text, at)) continue;
    const length = personTagAt(text.slice(at + 1), personNames, botNames);
    if (length === undefined) continue;
    ranges.push({ start: at, end: at + length + 1 });
    at += length;
  }
  return ranges;
}

/** CommonMark: a fence closes only on the same character at least as long; an unclosed fence runs to the end. */
function maskFences(text: string): string {
  let open: { char: string; length: number } | null = null;
  return text.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!open) {
      if (!marker || (marker[0] === "`" && line.slice(line.indexOf(marker) + marker.length).includes("`"))) return line;
      open = { char: marker[0]!, length: marker.length };
    } else if (marker && marker[0] === open.char && marker.length >= open.length && !line.trim().slice(marker.length).trim()) {
      open = null;
    }
    return " ".repeat(line.length);
  }).join("\n");
}

function proseOf(text: string): string {
  // CommonMark code spans close on a backtick run of the opening length and may cross line endings.
  return maskFences(text).replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, (code) => code.replace(/[^\n]/g, " "));
}

/** A message is read for tags only this far in, tags at most this many times and people this many: a long message cannot hold the server. */
const SCAN_LIMIT = 50_000;
const CANDIDATE_LIMIT = 500;
const MENTION_LIMIT = 20;
/** The line, or the paragraph, that names someone is quoted from this far around the tag. */
const EXCERPT_REACH = 400;

const scanned = (text: string): string => (text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text);

function excerptAt(text: string, hit: { start: number; end: number }): string {
  const from = Math.max(0, hit.start - EXCERPT_REACH);
  const near = text.slice(from, hit.end + EXCERPT_REACH);
  const start = hit.start - from;
  const end = hit.end - from;
  const lineStart = near.lastIndexOf("\n", start) + 1;
  const lineEnd = near.indexOf("\n", end);
  const line = near.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  const withoutTag = line.replace(near.slice(start, end), "").replace(/[\s\p{P}]+/gu, "");
  if (withoutTag.length >= 12) return line;
  const before = near.slice(0, start).search(/\n\s*\n(?![\s\S]*\n\s*\n)/);
  const paraStart = before === -1 ? 0 : before;
  const after = near.slice(end).search(/\n\s*\n/);
  return near.slice(paraStart, after === -1 ? undefined : end + after).trim();
}

export function personMentionExcerpt(raw: string, options: PersonTagOptions = {}): string | null {
  const text = scanned(raw);
  const hit = personMentionRanges(proseOf(text), options)[0];
  return hit ? excerptAt(text, hit) : null;
}

/** A person who can be called by name: the room's people, or the workspace directory. */
export interface MentionablePerson {
  name: string;
  email: string;
}

export interface PersonMention {
  email: string;
  excerpt: string;
}

const WORDS_THAT_ARE_NOT_NAMES = new Set([PERSON_TAG, ...RESERVED, "todos", "todas"]);

/** The words a person answers to after "@": the whole name, and the first name when nobody else in the list shares it. */
export function personMentionAliases(people: readonly MentionablePerson[]): Array<{ alias: string; email: string }> {
  const firsts = new Map<string, number>();
  const clean = people.map((person) => ({ email: person.email, name: person.name.replace(/^@+/, "").replace(/\s+/g, " ").trim() })).filter((person) => person.name);
  for (const person of clean) {
    const first = person.name.split(" ")[0]!.toLowerCase();
    firsts.set(first, (firsts.get(first) ?? 0) + 1);
  }
  const aliases: Array<{ alias: string; email: string }> = [];
  for (const person of clean) {
    if (!WORDS_THAT_ARE_NOT_NAMES.has(person.name.toLowerCase())) aliases.push({ alias: person.name, email: person.email });
    const first = person.name.split(" ")[0]!;
    if (first !== person.name && firsts.get(first.toLowerCase()) === 1 && !WORDS_THAT_ARE_NOT_NAMES.has(first.toLowerCase())) aliases.push({ alias: first, email: person.email });
  }
  return aliases;
}

/** Everyone @named in the prose of a message, once each, with the line that names them. A bot with the same or a longer name wins the tag. */
export function personMentions(raw: string, people: readonly MentionablePerson[], options: { botNames?: readonly string[] } = {}): PersonMention[] {
  const aliases = personMentionAliases(people);
  if (!aliases.length) return [];
  const text = scanned(raw);
  const prose = proseOf(text);
  const botNames = (options.botNames ?? []).filter((name) => name.trim());
  const found = new Map<string, PersonMention>();
  let at = -1;
  let tried = 0;
  while (tried < CANDIDATE_LIMIT && found.size < MENTION_LIMIT && (at = prose.indexOf("@", at + 1)) !== -1) {
    if (!isMentionBoundary(prose, at)) continue;
    tried++;
    const rest = prose.slice(at + 1);
    let best: { alias: string; email: string } | undefined;
    for (const candidate of aliases) {
      if (tagMatches(rest, candidate.alias) && (!best || candidate.alias.length > best.alias.length)) best = candidate;
    }
    if (!best) continue;
    const bot = Math.max(0, ...botNames.filter((name) => tagMatches(rest, name)).map((name) => name.length));
    if (bot >= best.alias.length) continue;
    if (!found.has(best.email)) found.set(best.email, { email: best.email, excerpt: excerptAt(text, { start: at, end: at + 1 + best.alias.length }) });
    at += best.alias.length;
  }
  return [...found.values()];
}

/** The emails of everyone @named in a message. */
export function mentionedPeople(text: string, people: readonly MentionablePerson[], options: { botNames?: readonly string[] } = {}): string[] {
  return personMentions(text, people, options).map((mention) => mention.email);
}
