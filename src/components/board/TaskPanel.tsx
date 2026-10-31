import { useEffect, useRef, useState } from "react";
import { ExternalLink, MessageSquare, Plus, Target, Trash2, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { COLUMN_LABEL, type Directory, type TaskPatch } from "@/lib/board";
import { dateTimeText, dispatchLine, historyLine } from "@/lib/board-text";
import type { Outcome } from "@/state/board";
import type { Bot } from "@/state/store";
import { assigneeKind, BOARD_LIMITS, TASK_STATUSES } from "../../../shared/board";
import type { BoardLink, BoardPerson, BoardTask, BoardTaskResponse, TaskStatus } from "../../../shared/board";
import { Select } from "../Select";
import { AssigneeSelect } from "./Assignee";

const FIELD = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-tertiary";

export function webLink(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function LinkRow({ link, onRemove }: { link: BoardLink; onRemove: () => void }) {
  const href = webLink(link.url);
  const name = link.label?.trim() || (href ? new URL(href).hostname : link.url);
  return (
    <li className="flex items-center gap-2 rounded-lg bg-card px-2.5 py-1.5" data-task-link="">
      <ExternalLink size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title={href} className="min-w-0 flex-1 truncate text-[13px] text-accent-text hover:underline">{name}</a>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{name}</span>
      )}
      <button type="button" aria-label={t("board.panel.linkRemove", { name })} onClick={onRemove} className="ui-icon-button size-6 min-h-0">
        <X size={13} aria-hidden="true" />
      </button>
    </li>
  );
}

function Links({ links, onChange }: { links: readonly BoardLink[]; onChange: (links: BoardLink[]) => void }) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const href = webLink(url);
    if (!href || href.length > BOARD_LIMITS.linkUrl) return setProblem(t("board.panel.linkInvalid"));
    if (links.length >= BOARD_LIMITS.links) return setProblem(t("board.panel.linkTooMany"));
    const name = label.trim();
    onChange([...links, name ? { url: href, label: name } : { url: href }]);
    setUrl("");
    setLabel("");
    setProblem(null);
  };
  return (
    <section aria-labelledby="board-panel-links" className="space-y-2">
      <h3 id="board-panel-links" className="text-[12px] font-semibold text-ink-secondary">{t("board.panel.links")}</h3>
      {links.length > 0 && (
        <ul className="space-y-1.5">
          {links.map((link, index) => <LinkRow key={`${link.url}-${index}`} link={link} onRemove={() => onChange(links.filter((_, at) => at !== index))} />)}
        </ul>
      )}
      <form onSubmit={(event) => { event.preventDefault(); add(); }} className="space-y-1.5">
        <input value={url} onChange={(event) => { setUrl(event.target.value); setProblem(null); }} inputMode="url" autoComplete="off" spellCheck={false}
          maxLength={BOARD_LIMITS.linkUrl} aria-label={t("board.panel.linkUrl")} placeholder={t("board.panel.linkUrl")} aria-invalid={problem ? true : undefined} className={FIELD} />
        <div className="flex gap-1.5">
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={BOARD_LIMITS.linkLabel} autoComplete="off"
            aria-label={t("board.panel.linkLabel")} placeholder={t("board.panel.linkLabel")} className={FIELD} />
          <button type="submit" disabled={!url.trim()} className="ui-button shrink-0"><Plus size={14} aria-hidden="true" />{t("board.panel.linkAdd")}</button>
        </div>
        {problem && <p role="alert" className="text-[12px] text-danger">{problem}</p>}
      </form>
    </section>
  );
}

export function TaskPanel({ task, directory, bots, people, missionTitle, canDelete, onClose, onUpdate, onDelete, onOpenChat, onOpenMission, onNotice }: {
  task: BoardTask;
  directory: Directory;
  bots: readonly Bot[];
  people: readonly BoardPerson[];
  missionTitle?: string;
  canDelete: boolean;
  onClose: () => void;
  onUpdate: (patch: TaskPatch) => Promise<Outcome<BoardTaskResponse>>;
  onDelete: () => Promise<Outcome<true>>;
  onOpenChat?: () => void;
  onOpenMission?: () => void;
  onNotice: (text: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const saving = useRef({ title: false, description: false });
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [dispatched, setDispatched] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async (patch: TaskPatch) => {
    const result = await onUpdate(patch);
    if (!result.ok) onNotice(t("board.panel.saveFailed", { error: result.error }));
    return result;
  };
  const commit = async (field: "title" | "description") => {
    const draft = field === "title" ? title : description;
    if (draft === null || saving.current[field]) return;
    const next = field === "title" ? draft.trim() : draft;
    const current = field === "title" ? task.title : task.description ?? "";
    const reset = field === "title" ? setTitle : setDescription;
    if ((field === "title" && !next) || next === current) return reset(null);
    saving.current[field] = true;
    const result = await save(field === "title" ? { title: next } : { description: next });
    saving.current[field] = false;
    if (result.ok) reset(null);
  };
  const closePanel = () => {
    void commit("title");
    void commit("description");
    onClose();
  };
  const closeNow = useRef(closePanel);
  closeNow.current = closePanel;

  useEffect(() => { panel.current?.focus(); }, []);
  useEffect(() => { if (confirming) cancelDelete.current?.focus(); }, [confirming]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (confirming) setConfirming(false);
      else closeNow.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  const change = async (patch: TaskPatch, owner: string | undefined) => {
    const result = await save(patch);
    if (!result.ok) return;
    setDispatched(owner && assigneeKind(owner) === "bot" ? dispatchLine(result.value, directory.assigneeName(owner)) : null);
  };
  const dirty = (title !== null && title.trim() !== task.title && title.trim() !== "") || (description !== null && description !== (task.description ?? ""));
  const links = task.links ?? [];

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label={t("board.panel.label", { id: task.id })}
      data-testid="board-task-panel"
      className="flex w-[420px] max-w-full shrink-0 flex-col border-l border-hairline/40 bg-panel outline-none max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-full"
    >
      <header className="flex items-center gap-2 border-b border-hairline/40 px-4 py-3">
        <span className="text-[12.5px] tabular-nums text-ink-secondary">#{task.id}</span>
        <button type="button" aria-label={t("common.close")} onClick={closePanel} className="ui-icon-button ml-auto"><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <input
          value={title ?? task.title}
          maxLength={BOARD_LIMITS.title}
          aria-label={t("board.panel.title")}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void commit("title")}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          className={`${FIELD} text-[15px] font-semibold`}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 text-[12px] font-semibold text-ink-secondary">
            <span>{t("board.panel.assignee")}</span>
            <AssigneeSelect label={t("board.panel.assignee")} value={task.assignee} directory={directory} bots={bots} people={people}
              onChange={(assignee) => void change({ assignee }, assignee ?? undefined)} />
          </div>
          <div className="space-y-1 text-[12px] font-semibold text-ink-secondary">
            <span>{t("board.panel.status")}</span>
            <Select aria-label={t("board.panel.status")} className="w-full" value={task.status}
              onChange={(event) => void change({ status: event.target.value as TaskStatus }, task.assignee)}>
              {TASK_STATUSES.map((status) => <option key={status} value={status}>{t(COLUMN_LABEL[status])}</option>)}
            </Select>
          </div>
        </div>
        {dispatched && <p role="status" data-task-dispatch="" className="rounded-lg bg-card px-3 py-2 text-[12.5px] text-ink">{dispatched}</p>}
        <label className="block space-y-1 text-[12px] font-semibold text-ink-secondary">
          <span>{t("board.panel.description")}</span>
          <textarea
            value={description ?? task.description ?? ""}
            rows={5}
            maxLength={BOARD_LIMITS.description}
            placeholder={t("board.panel.descriptionPlaceholder")}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => void commit("description")}
            className={`${FIELD} resize-y font-normal`}
          />
        </label>
        {dirty && (
          <button type="button" className="ui-button ui-button-primary" onClick={() => { void commit("title"); void commit("description"); }}>{t("common.save")}</button>
        )}
        <Links links={links} onChange={(next) => void save({ links: next })} />
        {(onOpenChat || onOpenMission) && (
          <div className="flex flex-wrap gap-2">
            {onOpenChat && <button type="button" className="ui-button" onClick={onOpenChat}><MessageSquare size={14} aria-hidden="true" />{t("board.panel.openChat")}</button>}
            {onOpenMission && <button type="button" className="ui-button" onClick={onOpenMission}><Target size={14} aria-hidden="true" />{missionTitle ? t("board.panel.openMissionNamed", { title: missionTitle }) : t("board.panel.openMission")}</button>}
          </div>
        )}
        <section aria-labelledby="board-panel-history" className="space-y-2">
          <h3 id="board-panel-history" className="text-[12px] font-semibold text-ink-secondary">{t("board.panel.history")}</h3>
          <ol className="space-y-2" data-task-history="">
            {task.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="text-[12.5px] leading-snug text-ink">
                <span>{historyLine(entry, directory)}</span>
                <time dateTime={new Date(entry.at).toISOString()} className="ml-1.5 text-[11.5px] text-ink-tertiary">{dateTimeText(entry.at)}</time>
                {entry.note && <p className="mt-0.5 text-ink-secondary">{entry.note}</p>}
              </li>
            ))}
          </ol>
        </section>
        {canDelete && (confirming ? (
          <div role="alert" className="space-y-2 rounded-lg border border-danger/30 bg-card p-3">
            <p className="text-[13px] font-medium text-ink">{t("board.panel.deleteTitle", { id: task.id })}</p>
            <p className="text-[12.5px] text-ink-secondary">{t("board.panel.deleteBody")}</p>
            <div className="flex justify-end gap-2">
              <button ref={cancelDelete} type="button" className="ui-button ui-button-sm" onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
              <button type="button" disabled={deleting} className="ui-button ui-button-sm border-danger/40 text-danger" onClick={async () => {
                setDeleting(true);
                const result = await onDelete();
                setDeleting(false);
                if (result.ok) onClose();
                else { setConfirming(false); onNotice(t("board.panel.deleteFailed", { error: result.error })); }
              }}>{t("common.delete")}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="ui-button ui-button-sm text-danger" onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" />{t("board.panel.delete")}</button>
        ))}
      </div>
    </aside>
  );
}
