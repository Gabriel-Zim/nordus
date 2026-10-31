import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { closeTaskDraft, requestBoardFocus, useTaskDraft } from "@/lib/board-compose";
import { dispatchLine } from "@/lib/board-text";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { CreateTaskDialog } from "../lazy-screens";

const NOTICE_MS = 9_000;

export function TaskFromMessageHost() {
  const draft = useTaskDraft();
  const { dispatch } = useStore();
  const [created, setCreated] = useState<{ id: number; sent: string | null } | null>(null);
  useEffect(() => {
    if (!created) return;
    const timer = setTimeout(() => setCreated(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [created]);
  return (
    <>
      {draft && (
        <CreateTaskDialog
          draft={draft}
          onClose={closeTaskDraft}
          onCreated={(answer, assigneeName) => {
            closeTaskDraft();
            setCreated({ id: answer.task.id, sent: assigneeName ? dispatchLine(answer, assigneeName) : null });
          }}
        />
      )}
      {created && (
        <div role="status" data-task-created="" className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}>
          <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-2xl border border-hairline/50 bg-menu py-2 pl-4 pr-2 text-[13px] text-ink shadow-xl shadow-black/30">
            <span className="min-w-0">
              <span className="block font-medium">{t("board.created", { id: created.id })}</span>
              {created.sent && <span className="block text-[12px] text-ink-secondary">{created.sent}</span>}
            </span>
            <button type="button" className="ui-button ui-button-sm shrink-0" onClick={() => {
              requestBoardFocus({ taskId: created.id });
              dispatch({ type: "showBoard" });
              setCreated(null);
            }}>{t("board.fromMessage.open")}</button>
            <button type="button" aria-label={t("common.dismiss")} className="ui-icon-button size-7 min-h-0" onClick={() => setCreated(null)}><X size={14} aria-hidden="true" /></button>
          </div>
        </div>
      )}
    </>
  );
}
