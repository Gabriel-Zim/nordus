// Direct messages between two people. They live in their own file and are reached only through /api/dms: no room, bot, search,
// recall, export or live frame of the workspace ever holds one, and every read checks that the caller is one of the two people.
// An admin is not one of the two. The machine's operator can still read this file on disk; that is outside what the server enforces.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { DIRECT_THREAD_PREFIX, normalizePersonEmail, type DirectConversation, type DirectMessage } from "../shared/people.ts";
import { writeFileAtomic } from "./atomic.ts";
import { isJsonObject, readJsonState } from "./state-file.ts";

export const MAX_DIRECT_MESSAGE_CHARS = 8_000;
const PAGE = 50;
const MAX_PAGE = 200;

/** What is kept, so that no one can fill the machine with direct messages: the oldest lines go first. */
export interface DirectLimits {
  /** lines kept in one conversation */
  perPair: number;
  /** characters kept in one conversation */
  charsPerPair: number;
  /** conversations one person may hold */
  pairsPerPerson: number;
  /** conversations in the workspace */
  pairs: number;
  /** characters kept in all conversations together */
  chars: number;
}
export const DIRECT_LIMITS: DirectLimits = { perPair: 2_000, charsPerPair: 400_000, pairsPerPerson: 100, pairs: 2_000, chars: 16_000_000 };

interface DirectRecord {
  id: string;
  people: [string, string];
  createdAt: number;
  readAt: Record<string, number>;
  messages: DirectMessage[];
}

export class DirectMessages {
  private readonly file: string;
  private readonly name: (email: string) => string;
  private readonly limits: DirectLimits;
  private readonly clock: () => number;
  private records: DirectRecord[] = [];
  private saving: NodeJS.Timeout | null = null;
  private chars = 0;

  constructor(options: { file: string; nameOf: (email: string) => string; limits?: Partial<DirectLimits>; now?: () => number }) {
    this.file = options.file;
    this.name = options.nameOf;
    this.limits = { ...DIRECT_LIMITS, ...options.limits };
    this.clock = options.now ?? Date.now;
    const saved = readJsonState(this.file, isJsonObject);
    if (saved.status === "ok" && Array.isArray(saved.value.conversations)) {
      this.records = saved.value.conversations.filter(isRecord);
    }
    this.chars = this.records.reduce((sum, record) => sum + sizeOf(record.messages), 0);
  }

  private persist(): void {
    if (this.saving) return;
    this.saving = setTimeout(() => this.flush(), 250);
    this.saving.unref();
  }

  flush(): void {
    if (this.saving) clearTimeout(this.saving);
    this.saving = null;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify({ version: 1, conversations: this.records }), { mode: 0o600, durable: false });
  }

  private record(id: string, email: string): DirectRecord | undefined {
    return this.records.find((record) => record.id === id && record.people.includes(email));
  }

  /** Whether this person is one of the two: the only question every read asks. */
  takesPart(id: string, email: string | undefined): boolean {
    return Boolean(email && this.record(id, email));
  }

  participants(id: string): readonly string[] {
    return this.records.find((record) => record.id === id)?.people ?? [];
  }

  private view(record: DirectRecord, email: string): DirectConversation {
    const peer = record.people[0] === email ? record.people[1] : record.people[0];
    const last = record.messages.at(-1);
    const readAt = record.readAt[email] ?? 0;
    return {
      id: record.id,
      threadId: `${DIRECT_THREAD_PREFIX}${record.id}`,
      peer,
      peerName: this.name(peer),
      unread: record.messages.some((message) => message.from !== email && message.at > readAt),
      ...(last ? { last } : {}),
    };
  }

  list(email: string): DirectConversation[] {
    return this.records
      .filter((record) => record.people.includes(email))
      .map((record) => this.view(record, email))
      .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
  }

  get(id: string, email: string): DirectConversation | undefined {
    const record = this.record(id, email);
    return record ? this.view(record, email) : undefined;
  }

  private between(email: string, peer: string): DirectRecord | undefined {
    return this.records.find((candidate) => candidate.people.includes(email) && candidate.people.includes(peer));
  }

  private held(email: string): number {
    return this.records.filter((record) => record.people.includes(email)).length;
  }

  /** Whether this conversation exists, or may be opened without passing what a person or the workspace may hold. */
  canOpen(email: string, peerEmail: string): boolean {
    const peer = normalizePersonEmail(peerEmail);
    if (!peer || peer === email) return false;
    if (this.between(email, peer)) return true;
    return this.records.length < this.limits.pairs && this.held(email) < this.limits.pairsPerPerson && this.held(peer) < this.limits.pairsPerPerson;
  }

  /** The conversation between these two, opened if it is not there yet and there is room. Never one with oneself. */
  open(email: string, peerEmail: string): DirectConversation | null {
    const peer = normalizePersonEmail(peerEmail);
    if (!peer || peer === email || !this.canOpen(email, peer)) return null;
    let record = this.between(email, peer);
    if (!record) {
      record = { id: randomUUID(), people: [email, peer].sort() as [string, string], createdAt: this.clock(), readAt: {}, messages: [] };
      this.records.push(record);
      this.persist();
    }
    return this.view(record, email);
  }

  page(id: string, email: string, options: { before?: string; limit?: number } = {}): { messages: DirectMessage[]; hasMore: boolean } | null {
    const record = this.record(id, email);
    if (!record) return null;
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? PAGE) || PAGE, 1), MAX_PAGE);
    const end = options.before ? Math.max(record.messages.findIndex((message) => message.id === options.before), 0) : record.messages.length;
    const start = Math.max(end - limit, 0);
    return { messages: record.messages.slice(start, end), hasMore: start > 0 };
  }

  post(id: string, email: string, text: string): { message: DirectMessage; record: DirectRecord } | null {
    const record = this.record(id, email);
    const clean = text.trim();
    if (!record || !clean) return null;
    const message: DirectMessage = { id: randomUUID(), at: this.clock(), from: email, name: this.name(email), text: clean.slice(0, MAX_DIRECT_MESSAGE_CHARS) };
    record.messages.push(message);
    this.chars += message.text.length;
    this.trim(record, message);
    record.readAt[email] = message.at;
    this.persist();
    return { message, record };
  }

  /** The oldest lines go: first the ones past what a conversation keeps, then the oldest anywhere past what all of them keep. */
  private trim(record: DirectRecord, newest: DirectMessage): void {
    const drop = (from: DirectRecord): void => {
      const [gone] = from.messages.splice(0, 1);
      if (gone) this.chars -= gone.text.length;
    };
    while (record.messages.length > this.limits.perPair) drop(record);
    while (record.messages.length > 1 && sizeOf(record.messages) > this.limits.charsPerPair) drop(record);
    while (this.chars > this.limits.chars) {
      let oldest: DirectRecord | undefined;
      for (const candidate of this.records) {
        const first = candidate.messages[0];
        if (first && (!oldest || first.at < oldest.messages[0]!.at)) oldest = candidate;
      }
      if (!oldest || oldest.messages[0] === newest) break;
      drop(oldest);
    }
  }

  markRead(id: string, email: string, at = this.clock()): DirectConversation | null {
    const record = this.record(id, email);
    if (!record) return null;
    record.readAt[email] = at;
    this.persist();
    return this.view(record, email);
  }

  /** The conversation as the other person sees it, for the live frame sent to each of them. */
  viewFor(record: DirectRecord, email: string): DirectConversation {
    return this.view(record, email);
  }
}

function sizeOf(messages: readonly DirectMessage[]): number {
  return messages.reduce((sum, message) => sum + message.text.length, 0);
}

function isRecord(value: unknown): value is DirectRecord {
  if (!isJsonObject(value)) return false;
  const people = value.people;
  return typeof value.id === "string" && Array.isArray(people) && people.length === 2 && people.every((entry) => typeof entry === "string")
    && isJsonObject(value.readAt) && Array.isArray(value.messages);
}

export type { DirectRecord };
