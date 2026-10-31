import { useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { MoveRight, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { COLUMN_LABEL, groupByColumn, type Directory } from "@/lib/board";
import { taskHint } from "@/lib/board-text";
import { BOARD_LIMITS, TASK_STATUSES } from "../../../shared/board";
import type { BoardTask, TaskStatus } from "../../../shared/board";
import { Select } from "../Select";
import { AssigneeAvatar } from "./Assignee";

const REVEAL = "opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 has-[[aria-expanded=true]]:opacity-100 touch:opacity-100";

function QuickAdd({ status, onAdd }: { status: TaskStatus; onAdd: (title: string, status: TaskStatus) => Promise<boolean> }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const label = t("board.add.label", { column: t(COLUMN_LABEL[status]) });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean || busy) return;
    setBusy(true);
    const added = await onAdd(clean, status);
    setBusy(false);
    if (added) setTitle("");
    input.current?.focus();
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="flex items-center gap-1 border-t border-hairline/40 px-2 py-2">
      <button type="submit" aria-label={t("common.add")} disabled={!title.trim() || busy} className="ui-icon-button size-7 min-h-0 shrink-0">
        <Plus size={15} aria-hidden="true" />
      </button>
      <input
        ref={input}
        value={title}
        maxLength={BOARD_LIMITS.title}
        readOnly={busy}
        aria-label={label}
        placeholder={t("board.add.placeholder")}
        autoComplete="off"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event: KeyboardEvent) => { if (event.key === "Escape" && title) { event.stopPropagation(); setTitle(""); } }}
        className="min-w-0 flex-1 rounded-md border border-hairline/40 bg-inset px-2 py-1 text-[13px] text-ink placeholder:text-ink-tertiary"
      />
    </form>
  );
}

function TaskCard({ task, directory, selected, dragging, onOpen, onMove, onDragStart, onDragEnd }: {
  task: BoardTask;
  directory: Directory;
  selected: boolean;
  dragging: boolean;
  onOpen: (id: number, opener: HTMLElement) => void;
  onMove: (id: number, status: TaskStatus) => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
}) {
  const open = (element: HTMLElement) => onOpen(task.id, element);
  return (
    <li
      data-task-id={task.id}
      data-selected={selected ? "" : undefined}
      draggable
      onDragStart={(event: DragEvent) => {
        event.dataTransfer?.setData("text/plain", `#${task.id}`);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      className={cn("group/card rounded-lg border border-hairline/40 bg-card p-2.5 transition-colors hover:border-hairline", dragging && "opacity-40", selected && "border-accent")}
    >
      <div
        role="button"
        tabIndex={0}
        data-task-open=""
        onClick={(event) => open(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          open(event.currentTarget);
        }}
        className="block cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="line-clamp-3 block text-[13.5px] font-medium leading-snug text-ink">{task.title}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
          <span className="tabular-nums" data-task-number="">#{task.id}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{taskHint(task)}</span>
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={REVEAL}>
          <Select
            variant="icon"
            aria-label={t("board.card.moveTo")}
            value={task.status}
            onChange={(event) => onMove(task.id, event.target.value as TaskStatus)}
            triggerClassName="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-secondary hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-focus"
            icon={<><MoveRight size={12} aria-hidden="true" /><span>{t("board.card.moveTo")}</span></>}
          >
            {TASK_STATUSES.map((status) => <option key={status} value={status}>{t(COLUMN_LABEL[status])}</option>)}
          </Select>
        </span>
        <AssigneeAvatar assignee={task.assignee} directory={directory} />
      </div>
    </li>
  );
}

export function TaskBoard({ tasks, filter, directory, selectedId, onOpen, onMove, onAdd }: {
  tasks: readonly BoardTask[];
  filter: string;
  directory: Directory;
  selectedId: number | null;
  onOpen: (id: number, opener: HTMLElement) => void;
  onMove: (id: number, status: TaskStatus) => void;
  onAdd: (title: string, status: TaskStatus) => Promise<boolean>;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const columns = groupByColumn(tasks, filter);
  const finishDrag = () => { setDragging(null); setOver(null); };
  return (
    <div data-testid="board-columns" className="flex h-full min-h-0 gap-3 overflow-x-auto px-6 py-4 max-md:px-3">
      {TASK_STATUSES.map((status) => {
        const cards = columns[status];
        return (
          <section
            key={status}
            aria-labelledby={`board-column-${status}`}
            data-board-column={status}
            onDragOver={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
              setOver(status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => current === status ? null : current);
            }}
            onDrop={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              const id = dragging;
              finishDrag();
              if (tasks.find((task) => task.id === id)?.status !== status) onMove(id, status);
            }}
            className={cn("flex min-h-0 min-w-[250px] flex-1 flex-col rounded-xl bg-panel ring-2 ring-transparent transition-shadow", over === status && "ring-accent/60")}
          >
            <header className="flex items-center gap-2 px-3 pb-2 pt-3">
              <h2 id={`board-column-${status}`} className="text-[13px] font-semibold text-ink">{t(COLUMN_LABEL[status])}</h2>
              <span data-column-count="" aria-label={t("board.column.countLabel", { count: cards.length })} className="rounded-full bg-raised px-2 py-0.5 text-[11.5px] tabular-nums text-ink-secondary">{cards.length}</span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {cards.length === 0 && <p className="px-1 py-3 text-[12.5px] text-ink-tertiary">{t("board.column.empty")}</p>}
              <ul className="flex flex-col gap-2">
                {cards.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    directory={directory}
                    selected={selectedId === task.id}
                    dragging={dragging === task.id}
                    onOpen={onOpen}
                    onMove={onMove}
                    onDragStart={setDragging}
                    onDragEnd={finishDrag}
                  />
                ))}
              </ul>
            </div>
            <QuickAdd status={status} onAdd={onAdd} />
          </section>
        );
      })}
    </div>
  );
}
