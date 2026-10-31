import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ListTodo } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { boardApi, makeDirectory } from "@/lib/board";
import type { TaskDraft } from "@/lib/board-compose";
import { errorText } from "@/lib/board-text";
import { t } from "@/lib/i18n";
import { useMe } from "@/lib/message-author";
import { useStore } from "@/state/store";
import { BOARD_LIMITS } from "../../../shared/board";
import type { BoardAssignee, BoardPerson, BoardTaskResponse } from "../../../shared/board";
import { AssigneeSelect } from "./Assignee";

const FIELD = "mt-1 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] font-normal text-ink placeholder:text-ink-tertiary";

export function CreateTaskDialog({ draft, onClose, onCreated }: {
  draft: TaskDraft;
  onClose: () => void;
  onCreated: (answer: BoardTaskResponse, assigneeName?: string) => void;
}) {
  const { state } = useStore();
  const me = useMe(state.config?.profile);
  const bots = useMemo(() => state.bots.filter((bot) => !bot.hidden), [state.bots]);
  const [people, setPeople] = useState<BoardPerson[]>([]);
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [assignee, setAssignee] = useState<BoardAssignee | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const directory = useMemo(() => makeDirectory({ bots, people, me }), [bots, people, me]);
  useModalDialog(dialog, () => { if (!busy) onClose(); });
  useEffect(() => {
    let live = true;
    boardApi.people().then((answer) => { if (live) setPeople(answer.people); }, () => {});
    return () => { live = false; };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const details = description.trim();
      const answer = await boardApi.createTask({
        title: clean, ...(details ? { description: details } : {}), ...(assignee ? { assignee } : {}), source: draft.source,
      });
      onCreated(answer, assignee ? directory.assigneeName(assignee) : undefined);
    } catch (error) {
      setProblem(t("board.fromMessage.failed", { error: errorText(error) }));
      setBusy(false);
    }
  };

  return createPortal(
    <div data-thread-overlay="" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" tabIndex={-1} aria-label={t("board.fromMessage.title")} aria-busy={busy || undefined}
        className="flex max-h-full w-full max-w-[480px] flex-col rounded-2xl border border-hairline/50 bg-panel p-5 text-ink shadow-2xl">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><ListTodo size={16} aria-hidden="true" />{t("board.fromMessage.title")}</h2>
        <form onSubmit={(event) => void submit(event)} className="mt-3 flex min-h-0 flex-col gap-3.5 overflow-y-auto">
          <label className="block text-[12px] font-semibold text-ink-secondary">{t("board.panel.title")}
            <input value={title} maxLength={BOARD_LIMITS.title} autoFocus autoComplete="off" disabled={busy} onChange={(event) => setTitle(event.target.value)} className={FIELD} />
          </label>
          <label className="block text-[12px] font-semibold text-ink-secondary">{t("board.panel.description")}
            <textarea value={description} rows={4} maxLength={BOARD_LIMITS.description} disabled={busy} placeholder={t("board.panel.descriptionPlaceholder")} onChange={(event) => setDescription(event.target.value)} className={`${FIELD} resize-y`} />
          </label>
          <div className="text-[12px] font-semibold text-ink-secondary">
            <span>{t("board.panel.assignee")}</span>
            <div className="mt-1">
              <AssigneeSelect label={t("board.panel.assignee")} value={assignee ?? undefined} directory={directory} bots={bots} people={people} disabled={busy} onChange={setAssignee} />
            </div>
          </div>
          {problem && <p role="alert" className="text-[12.5px] text-danger">{problem}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="ui-button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="ui-button ui-button-primary" disabled={!title.trim() || busy}>{t(busy ? "board.fromMessage.creating" : "board.fromMessage.create")}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
