import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, SquareKanban } from "lucide-react";
import { cn } from "@/lib/cn";
import { FILTER_ALL, FILTER_NONE, filterFor, makeDirectory } from "@/lib/board";
import { takeBoardFocus } from "@/lib/board-compose";
import { dispatchLine } from "@/lib/board-text";
import { t } from "@/lib/i18n";
import { useMe } from "@/lib/message-author";
import { useShowThreads } from "@/lib/thread-preferences";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useBoard } from "@/state/board";
import { openThread, useStore } from "@/state/store";
import { assigneeKind } from "../../shared/board";
import type { BoardActor, BoardTask, TaskStatus } from "../../shared/board";
import { useCaptionChrome } from "./DesktopCapabilities";
import { Select } from "./Select";
import { MissionDialog } from "./board/MissionDialog";
import { MissionList } from "./board/MissionList";
import { MissionView } from "./board/MissionView";
import { TaskBoard } from "./board/TaskBoard";
import { TaskPanel } from "./board/TaskPanel";

const TABS = ["tasks", "missions"] as const;
type Tab = (typeof TABS)[number];
const NOTICE_MS = 6_000;

function Waiting({ error, loading, onRetry }: { error: string | null; loading: boolean; onRetry: () => void }) {
  return error && !loading ? (
    <div role="alert" className="m-6 flex flex-wrap items-center gap-3 rounded-xl bg-card px-4 py-3 text-[13px]">
      <span className="text-danger">{t("board.loadFailed", { error })}</span>
      <button type="button" className="ui-button ui-button-sm" onClick={onRetry}>{t("common.tryAgain")}</button>
    </div>
  ) : (
    <div role="status" className="m-6 flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{t("board.loading")}</div>
  );
}

export function BoardPage() {
  const { dragProps, noDragStyle } = useCaptionChrome();
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const board = useBoard();
  const me = useMe(state.config?.profile);
  const admin = useOwnerOrAdmin() === true;
  const bots = useMemo(() => state.bots.filter((bot) => !bot.hidden), [state.bots]);
  const directory = useMemo(() => makeDirectory({ bots, people: board.people, me }), [bots, board.people, me]);
  const [tab, setTab] = useState<Tab>("tasks");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState(FILTER_ALL);
  const [notice, setNotice] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { actions } = board;

  useEffect(() => {
    const focus = takeBoardFocus();
    if (focus?.taskId !== undefined) setSelectedId(focus.taskId);
    if (focus?.missionId) {
      setTab("missions");
      setMissionId(focus.missionId);
    }
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const task = board.tasks.find((candidate) => candidate.id === selectedId);
  const mission = board.missions.find((candidate) => candidate.id === missionId);
  useEffect(() => {
    if (selectedId !== null && board.tasksLoad === "ready" && !task) setSelectedId(null);
  }, [board.tasksLoad, selectedId, task]);

  const owners = useMemo(() => [...new Set(board.tasks.flatMap((candidate) => candidate.assignee ?? []))], [board.tasks]);
  const activeFilter = filter === FILTER_ALL || filter === FILTER_NONE || owners.some((id) => filterFor(id) === filter) ? filter : FILTER_ALL;
  const mine = (actor: BoardActor) => admin || directory.isMe(actor);

  const openTask = (id: number, element: HTMLElement) => {
    opener.current = element;
    setSelectedId(id);
  };
  const closePanel = () => {
    setSelectedId(null);
    const element = opener.current;
    opener.current = null;
    if (element?.isConnected) element.focus();
  };
  const move = async (id: number, status: TaskStatus) => {
    const result = await actions.moveTask(id, status);
    if (!result.ok) return setNotice(t("board.move.failed", { id, error: result.error }));
    const owner = result.value.task.assignee;
    const line = owner && assigneeKind(owner) === "bot" ? dispatchLine(result.value, directory.assigneeName(owner)) : null;
    if (line) setNotice(line);
  };
  const add = async (title: string, status: TaskStatus) => {
    const result = await actions.createTask({ title, status });
    if (!result.ok) setNotice(t("board.add.failed", { error: result.error }));
    return result.ok;
  };
  const chatFor = (candidate: BoardTask) => {
    const threadId = candidate.thread?.threadId ?? candidate.source?.threadId;
    if (!threadId) return undefined;
    const botId = candidate.thread?.botId ?? (candidate.assignee && assigneeKind(candidate.assignee) === "bot" ? candidate.assignee : "");
    return () => { openThread(dispatch, { botId, threadId }, state, showThreads); };
  };
  const chooseTab = (next: Tab) => {
    setTab(next);
    if (next === "missions") setMissionId(null);
  };
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!;
    chooseTab(next);
    document.getElementById(`board-tab-${next}`)?.focus();
  };

  const segment = (active: boolean) => cn("rounded-md px-3 py-1.5 text-[12px] font-medium", active ? "bg-raised text-ink shadow-sm" : "text-ink-secondary hover:text-ink");
  const tasksPane = board.tasksLoad === "ready"
    ? <TaskBoard tasks={board.tasks} filter={activeFilter} directory={directory} selectedId={selectedId} onOpen={openTask} onMove={(id, status) => void move(id, status)} onAdd={add} />
    : <Waiting error={board.tasksError} loading={board.tasksLoad === "loading"} onRetry={actions.reload} />;
  const missionsPane = board.missionsLoad !== "ready"
    ? <Waiting error={board.missionsError} loading={board.missionsLoad === "loading"} onRetry={actions.reload} />
    : missionId === null
      ? <div className="min-h-0 flex-1 overflow-y-auto"><MissionList missions={board.missions} tasks={board.tasks} directory={directory} onOpen={setMissionId} onNew={() => setCreating(true)} /></div>
      : mission
        ? (
          <MissionView
            mission={mission}
            tasks={board.tasks}
            directory={directory}
            actions={actions}
            canDelete={mine(mission.createdBy)}
            onBack={() => setMissionId(null)}
            onOpenTask={openTask}
            onOpenRoom={() => { openThread(dispatch, { botId: mission.leadBotId, threadId: mission.threadId }, state, showThreads); }}
            onNotice={setNotice}
          />
        )
        : (
          <div className="m-6 flex flex-wrap items-center gap-3 rounded-xl bg-card px-4 py-3 text-[13px]">
            <span>{t("missions.notFound")}</span>
            <button type="button" className="ui-button ui-button-sm" onClick={() => setMissionId(null)}>{t("missions.back")}</button>
          </div>
        );

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink" data-testid="board-page">
      <header {...dragProps} className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-hairline/40 px-6 py-4 max-md:pl-12">
        <SquareKanban size={18} className="text-ink-secondary" aria-hidden="true" />
        <h1 className="text-[17px] font-semibold">{t("board.title")}</h1>
        <div role="tablist" aria-label={t("board.tabs.label")} style={noDragStyle} onKeyDown={tabKeys} className="ml-3 flex items-center rounded-lg border border-hairline/50 bg-panel p-0.5">
          {TABS.map((name) => (
            <button key={name} type="button" role="tab" id={`board-tab-${name}`} aria-selected={tab === name} aria-controls="board-tabpanel" tabIndex={tab === name ? 0 : -1} onClick={() => chooseTab(name)} className={segment(tab === name)}>
              {t(name === "tasks" ? "board.tab.tasks" : "board.tab.missions")}
            </button>
          ))}
        </div>
        {tab === "tasks" && board.tasks.length > 0 && (
          <div style={noDragStyle} className="ml-auto">
            <Select size="sm" aria-label={t("board.filter.label")} value={activeFilter} onChange={(event) => setFilter(event.target.value)}>
              <option value={FILTER_ALL}>{t("board.filter.all")}</option>
              <option value={FILTER_NONE}>{t("board.filter.none")}</option>
              {owners.map((id) => <option key={id} value={filterFor(id)}>{directory.assigneeName(id)}</option>)}
            </Select>
          </div>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <div id="board-tabpanel" role="tabpanel" aria-labelledby={`board-tab-${tab}`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {tab === "tasks" ? tasksPane : missionsPane}
        </div>
        {task && (
          <TaskPanel
            key={task.id}
            task={task}
            directory={directory}
            bots={bots}
            people={board.people}
            missionTitle={board.missions.find((candidate) => candidate.id === task.missionId)?.title}
            canDelete={mine(task.createdBy)}
            onClose={closePanel}
            onUpdate={(patch) => actions.updateTask(task.id, patch)}
            onDelete={() => actions.deleteTask(task.id)}
            onOpenChat={chatFor(task)}
            onOpenMission={task.missionId ? () => { opener.current = null; setSelectedId(null); setTab("missions"); setMissionId(task.missionId!); } : undefined}
            onNotice={setNotice}
          />
        )}
      </div>
      <div role="status" aria-live="polite" data-board-notice="" className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}>
        {notice && <span className="pointer-events-auto max-w-xl rounded-full border border-hairline/50 bg-menu px-4 py-2 text-[13px] text-ink shadow-xl shadow-black/30">{notice}</span>}
      </div>
      {creating && (
        <MissionDialog
          bots={bots}
          onClose={() => setCreating(false)}
          onCreate={actions.createMission}
          onCreated={(created) => { setCreating(false); setTab("missions"); setMissionId(created.id); }}
        />
      )}
    </main>
  );
}
