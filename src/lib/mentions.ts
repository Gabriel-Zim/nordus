import { t } from "./i18n";
import { CRITTER_COLORS, type CritterColor } from "./mascot";
import { isMentionBoundary, isMentionNameContinuation } from "../../shared/mention-boundary";
import { personMentionAliases, personTagAt, personTagNames, type MentionablePerson } from "../../shared/person-mention";

export type MentionPeer = { name: string; hidden?: boolean; color?: CritterColor; id?: string };
export type MentionRange = { start: number; end: number; color?: string; you?: true; botId?: string; personEmail?: string };
export type MentionPerson = { profileName?: string | null };

export function sameMentionPerson(a?: MentionPerson, b?: MentionPerson): boolean {
  return Boolean(a) === Boolean(b) && (a?.profileName ?? "") === (b?.profileName ?? "");
}

export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}

export function mentionChoicesForQuery<T extends { name: string }>(pool: readonly T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  if (query.endsWith(" ") && pool.some((choice) => choice.name.toLowerCase() === normalized)) return [];
  return pool.filter((choice) => !normalized || choice.name.toLowerCase().includes(normalized));
}

export type MentionRowDetail =
  | { kind: "bot"; title: string }
  | { kind: "everyone"; count: number }
  | { kind: "team"; count: number }
  | { kind: "all"; count: number };

export function mentionRowDescription(detail: MentionRowDetail): string {
  switch (detail.kind) {
    case "bot":
      return detail.title.trim();
    case "everyone":
      return detail.count === 1
        ? t("composer.mention.everyoneOne")
        : t("composer.mention.everyoneMany", { count: detail.count });
    case "team":
      return detail.count === 1 ? t("composer.mention.teamOne") : t("composer.mention.teamMany", { count: detail.count });
    case "all":
      return detail.count === 1 ? t("composer.mention.allOne") : t("composer.mention.allMany", { count: detail.count });
    default: {
      const unreachable: never = detail;
      return unreachable;
    }
  }
}

/** "@revisao" finds Revisão: case and accents do not change who is meant. */
function foldName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function mentionRanges(text: string, peers: readonly MentionPeer[], everyone = false, person?: MentionPerson, people?: readonly MentionablePerson[]): MentionRange[] {
  const candidates = peers.filter((p) => !p.hidden && p.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const personNames = person ? personTagNames(person.profileName) : [];
  const botNames = candidates.map(({ name }) => name);
  const aliases = people?.length ? personMentionAliases(people) : [];
  const aliasNames = aliases.map(({ alias }) => alias);
  const ranges: MentionRange[] = [];
  let at = -1;
  while ((at = text.indexOf("@", at + 1)) !== -1) {
    if (!isMentionBoundary(text, at)) continue;
    const rest = text.slice(at + 1);
    const peer = candidates.find(({ name }) => foldName(rest.slice(0, name.length)) === foldName(name)
      && !isMentionNameContinuation(rest.slice(name.length)));
    const all = everyone && rest.slice(0, 8).toLowerCase() === "everyone"
      && !isMentionNameContinuation(rest.slice(8));
    const you = !all && personNames.length ? personTagAt(rest, personNames, botNames) : undefined;
    if (you !== undefined) {
      ranges.push({ start: at, end: at + you + 1, you: true });
      at += you;
      continue;
    }
    const colleague = !all && aliasNames.length ? personTagAt(rest, aliasNames, botNames) : undefined;
    if (colleague !== undefined) {
      const written = rest.slice(0, colleague).toLowerCase();
      const alias = aliases.find((candidate) => candidate.alias.length === colleague && candidate.alias.toLowerCase() === written);
      ranges.push({ start: at, end: at + colleague + 1, ...(alias ? { personEmail: alias.email } : {}) });
      at += colleague;
      continue;
    }
    const length = all ? 8 : peer?.name.length;
    if (length === undefined) continue;
    // Only palette values enter CSS.
    const color = !all && peer?.color && Object.hasOwn(CRITTER_COLORS, peer.color) ? CRITTER_COLORS[peer.color] : undefined;
    ranges.push({ start: at, end: at + length + 1, ...(color ? { color } : {}), ...(!all && peer?.id ? { botId: peer.id } : {}) });
    at += length;
  }
  return ranges;
}

export function mentionClassName(range: Pick<MentionRange, "you" | "personEmail">): string {
  return range.you ? "mention-highlight mention-you" : range.personEmail ? "mention-highlight mention-colleague" : "mention-highlight";
}

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName: string; hProperties: { className: string; style?: string; dataMentionBot?: string; title?: string } };
};

export function remarkMentions({ peers, everyone = false, person, people }: { peers: readonly MentionPeer[]; everyone?: boolean; person?: MentionPerson; people?: readonly MentionablePerson[] }) {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || ["link", "linkReference", "code", "inlineCode"].includes(node.type)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const text = child.value;
        const ranges = mentionRanges(text, peers, everyone, person, people);
        if (!ranges.length) return [child];
        const result: MarkdownNode[] = [];
        let end = 0;
        for (const range of ranges) {
          if (range.start > end) result.push({ type: "text", value: text.slice(end, range.start) });
          result.push({ type: "mention", data: { hName: "span", hProperties: {
            className: mentionClassName(range),
            ...(range.color ? { style: `--mention-color:${range.color}` } : {}),
            ...(range.botId ? { dataMentionBot: range.botId } : {}),
          } },
            children: [{ type: "text", value: text.slice(range.start, range.end) }] });
          end = range.end;
        }
        if (end < text.length) result.push({ type: "text", value: text.slice(end) });
        return result;
      });
    };
    visit(tree);
  };
}
