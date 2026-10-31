import { Fragment, useContext, type CSSProperties, type ReactNode } from "react";
import { mentionClassName, mentionRanges, remarkMentions, type MentionPeer, type MentionPerson } from "@/lib/mentions";
import { MentionPeopleContext } from "@/lib/mention-people";
import { t } from "@/lib/i18n";
import { StoreContext } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { PERSON_TAG } from "../../shared/person-mention";

/** The bot's small avatar sits over the "@", so the composer's caret mirror keeps every glyph where the textarea has it. */
function MentionAt({ botId }: { botId: string }) {
  const bot = useContext(StoreContext)?.state.bots.find((entry) => entry.id === botId);
  return (
    <span className="mention-at">
      @
      {bot && (
        <span className="mention-at-avatar" aria-hidden="true">
          <BotAvatar bot={bot} size={16} animated={false} />
        </span>
      )}
    </span>
  );
}

function BotFace({ botId }: { botId: string }) {
  const bot = useContext(StoreContext)?.state.bots.find((entry) => entry.id === botId);
  return (
    <span className="mention-face" aria-hidden="true">
      {bot && <BotAvatar bot={bot} size={18} animated={false} />}
    </span>
  );
}

type PersonProfile = { name?: string; email?: string; avatarUrl?: string };

function usePersonProfile(): PersonProfile | undefined {
  return useContext(StoreContext)?.state.config?.profile as PersonProfile | undefined;
}

function PersonFace({ profile, name }: { profile?: PersonProfile; name: string }) {
  return (
    <span className="mention-face mention-face-person" aria-hidden="true">
      {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" decoding="async" /> : <span>{name.trim()[0]?.toLocaleUpperCase() ?? "?"}</span>}
    </span>
  );
}

/** The person by name, never "@you": the tag a bot wrote reads as the first name from the profile. */
export function personMentionName(tag: string, profileName?: string): string {
  const written = tag.replace(/^@+/, "").trim();
  if (written && written.toLowerCase() !== PERSON_TAG) return written;
  return profileName?.trim().split(/\s+/)[0] || t("chatHeader.you");
}

/** A mention in a message, like Grok: a round avatar the size of the letters and the name in bold, no "@", no chip. */
export function MentionInline({ botId, text, style, colleague = false }: { botId?: string; text: string; style?: CSSProperties; colleague?: boolean }) {
  const store = useContext(StoreContext);
  const profile = usePersonProfile();
  if (colleague) {
    const name = text.replace(/^@+/, "");
    return (
      <span className="mention-inline" data-mention-colleague="" title={name}>
        <PersonFace name={name} />
        <span className="mention-inline-name">{name}</span>
      </span>
    );
  }
  if (!botId) {
    const name = personMentionName(text, profile?.name);
    return (
      <span className="mention-inline" data-mention-person="" title={name}>
        <PersonFace profile={profile} name={name} />
        <span className="mention-inline-name">{name}</span>
      </span>
    );
  }
  const name = store?.state.bots.find((entry) => entry.id === botId)?.name ?? text.replace(/^@+/, "");
  return (
    <span className="mention-inline" style={style} data-mention-bot={botId}>
      <BotFace botId={botId} />
      <span className="mention-inline-name">{name}</span>
    </span>
  );
}

/** `mirror` draws the composer's overlay: same glyphs and widths as the textarea, only the "@" wears the avatar. */
export function MentionText({ text, peers, everyone = false, person, mirror = false }: {
  text: string; peers: readonly MentionPeer[]; everyone?: boolean; person?: MentionPerson; mirror?: boolean;
}) {
  const { people } = useContext(MentionPeopleContext);
  let end = 0;
  const parts = mentionRanges(text, peers, everyone, person, people).map((range) => {
    const prefix = text.slice(end, range.start);
    end = range.end;
    const written = text.slice(range.start, range.end);
    const style = range.color ? { "--mention-color": range.color } as CSSProperties : undefined;
    const body: ReactNode = !mirror && (range.botId || range.you || range.personEmail)
      ? <MentionInline botId={range.botId} text={written} style={style} colleague={Boolean(range.personEmail)} />
      : range.botId
        ? <span className={mentionClassName(range)} style={style} data-mention-bot={range.botId}><MentionAt botId={range.botId} />{written.slice(1)}</span>
        : <span className={mentionClassName(range)} style={style}>{written}</span>;
    return <Fragment key={range.start}>{prefix}{body}</Fragment>;
  });
  return <>{parts}{text.slice(end)}</>;
}

export function useMentionPlugin(peers: readonly MentionPeer[], everyone: boolean, person?: MentionPerson): [typeof remarkMentions, Parameters<typeof remarkMentions>[0]] {
  const { people } = useContext(MentionPeopleContext);
  return [remarkMentions, { peers, everyone, person, people }];
}
