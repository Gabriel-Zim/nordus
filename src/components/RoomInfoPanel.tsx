import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, ChevronLeft, ChevronRight, Flag, Images, Plus, Search, Star, UserPlus, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { normalizeState } from "@/lib/mascot";
import { useStore, type Bot, type Group } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { InlineText } from "./InlineText";
import { GroupTaskPicker } from "./TaskPicker";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import { DefaultResponderSelect } from "./GroupView";
import { RoomWorkingFolder } from "./RoomWorkingFolder";
import { RoomFavorites, RoomGallery, roomMediaCount } from "./RoomGallery";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { botAvatarUrlFromStoredPath } from "../../shared/bot-avatar";
import { roomClientOptions, useClients } from "@/lib/conversation-client";
import { Select } from "./Select";
import { RoomPeople } from "./people/RoomPeople";
import { useGuest } from "@/lib/use-viewer";

const capsLabelCls = "text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-secondary";
const cardCls = "rounded-[14px] border border-white/[0.07] bg-white/[0.03]";

function Section({ title, hint, action, children, ...rest }: {
  id?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  "data-room-info-section"?: string;
}) {
  return (
    <section className="flex flex-col gap-2" {...rest}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className={capsLabelCls}>{title}</h3>
        {action}
      </div>
      {hint && <p className="-mt-1 px-1 text-[12px] leading-relaxed text-ink-secondary">{hint}</p>}
      {children}
    </section>
  );
}

/** Instructions save on their own: a short pause after typing, and again when the box loses focus. */
function RoomInstructions({ group, onSaved }: { group: Group; onSaved: () => void }) {
  const { dispatch } = useStore();
  const [draft, setDraft] = useState(group.bulletin);
  const saved = useRef(group.bulletin);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (group.bulletin !== saved.current) {
      saved.current = group.bulletin;
      setDraft(group.bulletin);
    }
  }, [group.bulletin]);
  const save = (text: string) => {
    window.clearTimeout(timer.current);
    if (text === saved.current) return;
    saved.current = text;
    dispatch({ type: "patchGroup", groupId: group.id, patch: { bulletin: text } });
    onSaved();
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <textarea
      data-room-instructions=""
      dir="auto"
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => save(text), 800);
      }}
      onBlur={() => save(draft)}
      placeholder={t("room.info.instructionsPlaceholder")}
      rows={7}
      className={cn(cardCls, "min-h-[9rem] w-full resize-y px-3.5 py-3 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-tertiary focus:border-accent-border focus:outline-none")}
    />
  );
}

function RoomMembers({ group, members, adding, setAdding }: {
  group: Group; members: Bot[]; adding: boolean; setAdding: (next: boolean | ((open: boolean) => boolean)) => void;
}) {
  const { state, dispatch } = useStore();
  const others = state.bots.filter((bot) => !bot.hidden && !group.memberIds.includes(bot.id));
  const setMembers = (memberIds: string[]) => {
    if (memberIds.length === 0) return;
    dispatch({ type: "patchGroup", groupId: group.id, patch: { memberIds } });
  };
  return (
    <Section
      id="room-info-members"
      title={t("room.info.members")}
      data-room-info-section="members"
      action={others.length > 0 && (
        <button
          type="button"
          data-room-add-member=""
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <Plus size={13} aria-hidden="true" />
          {t("room.info.addMember")}
        </button>
      )}
    >
      <ul className={cn(cardCls, "divide-y divide-hairline/40")}>
        {members.map((bot) => (
          <li key={bot.id} data-room-member={bot.id} className="group/member flex items-center gap-3 px-3 py-2">
            <BotAvatar bot={bot} state={normalizeState(bot.mascotExpression) ?? "happy"} size={32} animated={false} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="nb-name truncate text-[13.5px] text-ink">{bot.name}</span>
                {bot.tag && <span className="shrink-0 rounded-[5px] border border-white/10 bg-white/[0.04] px-1.5 text-[10px] font-medium uppercase leading-[16px] tracking-[0.05em] text-ink-tertiary">{bot.tag}</span>}
              </div>
              {bot.title.trim() && <div className="truncate text-[12px] text-ink-secondary">{bot.title.trim()}</div>}
            </div>
            {members.length > 1 && (
              <button
                type="button"
                data-room-remove-member={bot.id}
                onClick={() => setMembers(group.memberIds.filter((id) => id !== bot.id))}
                aria-label={t("room.info.removeMember", { name: bot.name })}
                title={t("room.info.removeMember", { name: bot.name })}
                className="rounded-md p-1 text-ink-tertiary opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/member:opacity-100 touch:opacity-100"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && others.length > 0 && (
        <ul data-room-member-choices="" className={cn(cardCls, "divide-y divide-hairline/40")}>
          {others.map((bot) => (
            <li key={bot.id}>
              <button
                type="button"
                data-room-pick-member={bot.id}
                onClick={() => {
                  setMembers([...group.memberIds, bot.id]);
                  if (others.length === 1) setAdding(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.04]"
              >
                <BotAvatar bot={bot} state={normalizeState(bot.mascotExpression) ?? "happy"} size={32} animated={false} />
                <span className="nb-name min-w-0 flex-1 truncate text-[13.5px] text-ink">{bot.name}</span>
                <Plus size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const LINK_SPLIT = /(https?:\/\/[^\s<>()[\]"'`]+[^\s<>()[\]"'`.,;:!?])/g;

/** Plain text with its web addresses as links that open in a new tab. */
function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {text.split(LINK_SPLIT).map((part, index) => index % 2 === 1
        ? <a key={index} href={part} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()} className="break-all text-[var(--color-unread,#3b82f6)] hover:underline">{part}</a>
        : <Fragment key={index}>{part}</Fragment>)}
    </>
  );
}

/** What the room is about, for the person (the bots follow the Instructions, not this). Saves when the box closes. */
function RoomDescription({ group, editable, onSaved }: { group: Group; editable: boolean; onSaved: () => void }) {
  const { dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.description ?? "");
  const description = group.description ?? "";
  const save = () => {
    setEditing(false);
    if (draft === description) return;
    dispatch({ type: "patchGroup", groupId: group.id, patch: { description: draft.trim() ? draft : "" } });
    onSaved();
  };
  if (editing) {
    return (
      <textarea
        autoFocus
        data-room-description-input=""
        dir="auto"
        value={draft}
        maxLength={4000}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(description); setEditing(false); }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
        }}
        placeholder={t("room.info.descriptionPlaceholder")}
        rows={4}
        className={cn(cardCls, "w-full resize-y px-3.5 py-3 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-tertiary focus:border-accent-border focus:outline-none")}
      />
    );
  }
  if (!description) {
    if (!editable) return null;
    return (
      <button type="button" data-room-description="" onClick={() => { setDraft(""); setEditing(true); }}
        className="w-full rounded-[14px] border border-dashed border-white/[0.10] px-3.5 py-3 text-left text-[13px] text-ink-tertiary hover:bg-white/[0.03] hover:text-ink-secondary">
        {t("room.info.descriptionAdd")}
      </button>
    );
  }
  return (
    <div
      data-room-description=""
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={() => { if (editable) { setDraft(description); setEditing(true); } }}
      onKeyDown={(event) => { if (editable && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setDraft(description); setEditing(true); } }}
      className={cn(cardCls, "whitespace-pre-wrap break-words px-3.5 py-3 text-[13.5px] leading-relaxed text-ink", editable && "cursor-text hover:bg-white/[0.05]")}
    >
      <LinkifiedText text={description} />
    </div>
  );
}

/** The room's own round picture, or its members' faces when it has none; a click picks a new picture. */
function RoomPhoto({ group, members, editable, onSaved }: { group: Group; members: Bot[]; editable: boolean; onSaved: () => void }) {
  const { dispatch } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = members.slice(0, 4);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await imageAttachmentFromFile(file);
      const avatarUrl = saved ? botAvatarUrlFromStoredPath(saved.path) : null;
      if (!avatarUrl) throw new Error(t("room.info.photoError"));
      dispatch({ type: "patchGroup", groupId: group.id, patch: { avatarUrl } });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const face = group.avatarUrl ? (
    <img src={group.avatarUrl} alt="" decoding="async" className="size-[88px] rounded-full object-cover ring-1 ring-white/10" />
  ) : (
    <span data-room-info-avatars="" className="flex h-[88px] items-center -space-x-4">
      {shown.map((bot, index) => (
        <span key={bot.id} className="inline-flex rounded-full ring-2 ring-[var(--color-panel)]" style={{ zIndex: index + 1 }}>
          <BotAvatar bot={bot} state={normalizeState(bot.mascotExpression) ?? "happy"} size={56} animated={false} />
        </span>
      ))}
    </span>
  );
  if (!editable) return face;
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        data-room-photo=""
        disabled={busy}
        onClick={() => input.current?.click()}
        aria-label={t("room.info.photoChange")}
        title={t("room.info.photoChange")}
        className="group/photo relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border disabled:opacity-60"
      >
        {face}
        <span className="pointer-events-none absolute bottom-0 right-0 z-10 flex size-7 items-center justify-center rounded-full border border-white/10 bg-panel text-ink-secondary opacity-0 shadow transition-opacity group-hover/photo:opacity-100 group-focus-within/photo:opacity-100 touch:opacity-100">
          <Camera size={14} aria-hidden="true" />
        </span>
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
      {group.avatarUrl && (
        <button type="button" data-room-photo-remove="" onClick={() => { dispatch({ type: "patchGroup", groupId: group.id, patch: { avatarUrl: "" } }); onSaved(); }}
          className="rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-tertiary hover:bg-raised hover:text-ink-secondary">
          {t("room.info.photoRemove")}
        </button>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function QuickAction({ icon, label, onClick, ...rest }: { icon: ReactNode; label: string; onClick: () => void; "data-room-action"?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-glass-action=""
      className="flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-[14px] border border-white/[0.07] bg-white/[0.03] px-2 py-3 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-white/[0.06] hover:text-ink"
      {...rest}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function NavRow({ icon, label, count, onClick, ...rest }: { icon: ReactNode; label: string; count: number; onClick: () => void; "data-room-nav"?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-white/[0.04]" {...rest}>
      <span className="text-ink-secondary">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{label}</span>
      <span className="text-[12.5px] tabular-nums text-ink-tertiary">{count}</span>
      <ChevronRight size={15} className="text-ink-tertiary" aria-hidden="true" />
    </button>
  );
}

type RoomInfoView = "main" | "gallery" | "favorites";

/** Everything about a room in one panel on the right, like WhatsApp's group info: nothing stacks on the conversation. */
/** Nordus: the client this room works for. A member gets no client list, so they see the room's client but cannot change it. */
function RoomClient({ group }: { group: Group }) {
  const { dispatch } = useStore();
  const clients = useClients();
  const current = group.client ?? "";
  if (!clients.length && !current) return null;
  return (
    <Section title="Cliente" hint="Todo pedido nesta sala usa a ficha deste cliente." data-room-info-section="client">
      <div className={cn(cardCls, "flex items-center justify-between gap-3 px-3.5 py-2.5")}>
        <span className="text-[13px] text-ink">Trabalha para</span>
        <Select
          variant="pill"
          size="sm"
          className="shrink-0 max-w-[190px]"
          aria-label="Cliente da sala"
          data-room-client=""
          value={current}
          disabled={!clients.length}
          onChange={(event) => dispatch({ type: "patchGroup", groupId: group.id, patch: { client: event.target.value || null } })}
        >
          <option value="">Nenhum</option>
          {roomClientOptions(current, clients).map((client) => (
            <option key={client.slug} value={client.slug}>{client.name}</option>
          ))}
        </Select>
      </div>
    </Section>
  );
}

export function RoomInfoPanel({ group, members, onClose, onFind, onGoal }: {
  group: Group;
  members: Bot[];
  onClose: () => void;
  onFind?: () => void;
  onGoal?: () => void;
}) {
  const { dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const [savedAt, setSavedAt] = useState(0);
  const [view, setView] = useState<RoomInfoView>("main");
  const [adding, setAdding] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => setView("main"), [group.id]);
  useEffect(() => {
    if (!savedAt) return;
    const timer = window.setTimeout(() => setSavedAt(0), 1600);
    return () => window.clearTimeout(timer);
  }, [savedAt]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role=dialog][aria-modal=true], [role=listbox]")) return;
      event.preventDefault();
      if (view !== "main") setView("main");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, view]);
  const guest = useGuest();
  const editable = !remoteClient && !group.dm && !guest;
  const saved = () => setSavedAt(Date.now());
  const mediaCount = roomMediaCount(group.messages);
  const favoriteCount = group.favoriteMessageIds?.length ?? 0;
  const addMember = () => {
    setAdding(true);
    requestAnimationFrame(() => panelRef.current?.querySelector("#room-info-members")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-labelledby="room-info-title"
      data-room-info=""
      className="animate-panel-in absolute inset-0 z-40 flex h-full min-w-0 flex-col border-l border-hairline/40 bg-panel md:static md:z-auto md:w-[min(420px,42vw)] md:shrink-0"
    >
      <div data-layer-head="" className={cn("flex shrink-0 items-center px-4 py-3", view === "main" ? "justify-end max-md:justify-start max-md:px-2" : "justify-between")}>
        {view === "main" && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("botSettings.simple.backToChat")}
            data-ios-glass-button=""
            className="flex size-11 items-center justify-center rounded-full text-ink md:hidden"
          >
            <ChevronLeft size={24} strokeWidth={2.25} className="pointer-events-none" />
          </button>
        )}
        {view !== "main" && (
          <button type="button" data-room-info-back="" data-layer-subback="" onClick={() => setView("main")} className="flex items-center gap-1 rounded-md py-1 pl-1 pr-2 text-[13px] font-medium text-ink-secondary hover:bg-control hover:text-ink">
            <ChevronLeft size={16} aria-hidden="true" />
            {view === "gallery" ? t("room.info.gallery") : t("room.info.favorites")}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("room.info.close")}
          data-layer-close=""
          className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink max-md:hidden"
        >
          <X size={18} className="pointer-events-none" />
        </button>
      </div>

      {view === "gallery" ? (
        <div data-layer-body="" className="min-h-0 flex-1 overflow-y-auto px-5 pb-6"><RoomGallery group={group} /></div>
      ) : view === "favorites" ? (
        <div data-layer-body="" className="min-h-0 flex-1 overflow-y-auto px-5 pb-6"><RoomFavorites group={group} members={members} onOpen={() => {}} /></div>
      ) : (
      <div data-layer-body="" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6">
        <div className="flex flex-col items-center gap-1.5">
          <RoomPhoto group={group} members={members} editable={editable} onSaved={saved} />
          {editable ? (
            <InlineText
              id="room-info-title"
              value={group.name}
              label={t("room.info.name")}
              className="nb-name mt-1 text-[17px] font-semibold text-ink"
              onSave={(name) => {
                if (!name.trim()) return;
                dispatch({ type: "patchGroup", groupId: group.id, patch: { name: name.trim() } });
                saved();
              }}
            />
          ) : (
            <span id="room-info-title" className="nb-name mt-1 text-[17px] font-semibold text-ink">{group.name}</span>
          )}
          <span className="text-[12.5px] text-ink-secondary">
            {members.length === 1 ? t("room.info.membersOne") : t("room.info.membersMany", { count: members.length })}
          </span>
          <span aria-live="polite" className={cn("h-4 text-[11.5px] text-ink-tertiary transition-opacity", savedAt ? "opacity-100" : "opacity-0")}>
            {savedAt ? t("botSettings.simple.saved") : ""}
          </span>
        </div>

        {!group.dm && (
          <div data-room-actions="" className="-mt-3 flex gap-2">
            {editable && <QuickAction data-room-action="add" icon={<UserPlus size={18} aria-hidden="true" />} label={t("room.info.actionAdd")} onClick={addMember} />}
            {onFind && <QuickAction data-room-action="find" icon={<Search size={18} aria-hidden="true" />} label={t("room.info.actionFind")} onClick={onFind} />}
            {onGoal && !remoteClient && <QuickAction data-room-action="goal" icon={<Flag size={18} aria-hidden="true" />} label={t("room.info.actionGoal")} onClick={onGoal} />}
          </div>
        )}

        {(editable || group.description) && (
          <Section title={t("room.info.description")} data-room-info-section="description">
            <RoomDescription group={group} editable={editable} onSaved={saved} />
          </Section>
        )}

        {editable && <RoomClient group={group} />}

        <div className={cn(cardCls, "shrink-0 divide-y divide-hairline/40 overflow-hidden")} data-room-info-section="library">
          <NavRow data-room-nav="gallery" icon={<Images size={17} aria-hidden="true" />} label={t("room.info.gallery")} count={mediaCount} onClick={() => setView("gallery")} />
          <NavRow data-room-nav="favorites" icon={<Star size={17} aria-hidden="true" />} label={t("room.info.favorites")} count={favoriteCount} onClick={() => setView("favorites")} />
        </div>

        {editable && <RoomMembers group={group} members={members} adding={adding} setAdding={setAdding} />}

        {!group.dm && <RoomPeople group={group} />}

        {editable && (
          <Section title={t("room.info.whoAnswers")} hint={t("room.info.whoAnswersHint")} data-room-info-section="responder">
            <div className={cn(cardCls, "flex items-center justify-between gap-3 px-3.5 py-2.5")}>
              <span className="text-[13px] text-ink">{t("room.info.whoAnswersLabel")}</span>
              <DefaultResponderSelect group={group} members={members} />
            </div>
          </Section>
        )}

        {!remoteClient && (
          <Section title={t("room.info.instructions")} hint={t("room.info.instructionsHint")} data-room-info-section="instructions">
            <RoomInstructions group={group} onSaved={saved} />
          </Section>
        )}

        {editable && (
          <Section title={t("room.folder.title")} data-room-info-section="folder">
            <RoomWorkingFolder group={group} />
          </Section>
        )}

        {!group.dm && (
          <Section title={t("room.info.conversations")} data-room-info-section="conversations">
            <div className={cn(cardCls, "flex items-center justify-between gap-3 px-3.5 py-2.5")}>
              <span className="text-[13px] text-ink">{t("room.info.conversationsLabel")}</span>
              <GroupTaskPicker group={group} />
            </div>
          </Section>
        )}

        <Section title={t("room.info.export")} data-room-info-section="export">
          <div className={cn(cardCls, "flex items-center justify-between gap-3 px-3.5 py-2.5")}>
            <span className="text-[13px] text-ink">{t("room.info.exportLabel")}</span>
            <ExportTranscriptMenu title={group.name} messages={group.messages} isGroup />
          </div>
        </Section>
      </div>
      )}
    </aside>
  );
}
