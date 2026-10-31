import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArchiveRestore, ChevronRight, FolderPlus, HardDrive, Pencil, Search, Trash2, Upload, Users, X } from "lucide-react";

import { joinPath, parentOf } from "../../../shared/knowledge-path";
import type { DriveFileItem, DriveItem, DriveListing, DriveTrashItem, KnowledgeSpaceId } from "../../../shared/knowledge";
import { cn } from "@/lib/cn";
import { driveApi, uploadToDrive } from "@/lib/knowledge-api";
import { formatBytes, fullDate, isKnowledgeCode, knowledgeErrorText, relativeTime } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { ConfirmBox, TextBox } from "./knowledge-dialogs";
import { InternalPeopleBox } from "./InternalPeopleBox";
import { ActorBadge, FileGlyph, KnowledgeShell, Loading, NoAccess, Problem, SpaceSwitcher, useKnowledgeSpaces } from "./knowledge-shared";
import { DriveDetail } from "./DriveDetail";

type Dialog = { kind: "folder" } | { kind: "access" } | { kind: "move"; item: DriveItem } | { kind: "delete"; item: DriveItem };

interface UploadRow {
  id: number;
  name: string;
  progress: number;
  state: "sending" | "done" | "failed";
  message?: string;
}

const COLUMNS = "md:grid-cols-[minmax(0,1fr)_10rem_7rem_4rem_6.5rem]";
const byName = (a: DriveItem, b: DriveItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

function sorted(items: readonly DriveItem[]): DriveItem[] {
  return [...items.filter((item) => item.kind === "folder").sort(byName), ...items.filter((item) => item.kind === "file").sort(byName)];
}

/** What a drop carries: files to send, and how many folders were dropped (those are not sent). */
function droppedFiles(event: DragEvent): { files: File[]; folders: number } {
  const files: File[] = [];
  let folders = 0;
  const items = Array.from(event.dataTransfer.items ?? []);
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== "file") continue;
      if (item.webkitGetAsEntry?.()?.isDirectory) folders += 1;
      else {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return { files, folders };
  }
  return { files: Array.from(event.dataTransfer.files), folders: 0 };
}

export function DrivePage() {
  const { spaces, space, setSpace, admin, failed, reload: reloadSpaces } = useKnowledgeSpaces();
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriveFileItem[] | null>(null);
  const [view, setView] = useState<"files" | "trash">("files");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const requests = useRef(0);
  const uploadIds = useRef(0);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    if (!space) return;
    const id = ++requests.current;
    try {
      const next = await driveApi.list(space, path);
      if (id !== requests.current) return;
      setListing(next);
      setError(null);
    } catch (reason) {
      if (id !== requests.current) return;
      if (path && isKnowledgeCode(reason, "not_found")) setPath("");
      else setError(knowledgeErrorText(reason));
    }
  }, [space, path]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPath("");
    setListing(null);
    setSelected(null);
    setQuery("");
    setResults(null);
    setView("files");
  }, [space]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    const text = query.trim();
    if (!space || !text) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      driveApi.search(space, text).then(setResults, (reason: unknown) => setError(knowledgeErrorText(reason)));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, space]);

  const items = useMemo(() => (results ? sorted(results) : sorted(listing?.items ?? [])), [results, listing]);
  const selectedFile = useMemo(() => items.find((item): item is DriveFileItem => item.kind === "file" && item.path === selected) ?? null, [items, selected]);

  const sendFiles = useCallback(async (files: File[], target: string) => {
    if (!space || files.length === 0) return;
    const max = listing?.maxFileBytes ?? Number.POSITIVE_INFINITY;
    const rows = files.map((file) => ({ file, id: ++uploadIds.current }));
    setUploads((current) => [...current, ...rows.map(({ file, id }) => ({ id, name: file.name, progress: 0, state: "sending" as const }))]);
    for (const { file, id } of rows) {
      const update = (patch: Partial<UploadRow>) => setUploads((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
      if (file.size > max) {
        update({ state: "failed", message: t("drive.error.tooLargeMax", { max: formatBytes(max) }) });
        continue;
      }
      try {
        const result = await uploadToDrive({ space }, joinPath(target, file.name), file, { onProgress: (fraction) => update({ progress: fraction }) });
        update({
          state: "done",
          progress: 1,
          message: result.outcome === "updated" ? t("drive.upload.newVersion", { n: result.version }) : result.outcome === "unchanged" ? t("drive.upload.unchanged") : undefined,
        });
      } catch (reason) {
        update({ state: "failed", message: knowledgeErrorText(reason) });
      }
    }
    void load();
  }, [space, listing?.maxFileBytes, load]);

  useEffect(() => {
    if (!uploads.some((row) => row.state === "done") || uploads.some((row) => row.state === "sending")) return;
    const handle = setTimeout(() => setUploads((current) => current.filter((row) => row.state !== "done")), 6000);
    return () => clearTimeout(handle);
  }, [uploads]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (view !== "files" || results) return;
    const dropped = droppedFiles(event);
    setNotice(dropped.folders > 0 ? t("drive.upload.noFolders") : null);
    void sendFiles(dropped.files, path);
  };
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  const confirmRemove = async (item: DriveItem) => {
    if (!space) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await driveApi.remove(space, item.path);
      if (selected && (selected === item.path || selected.startsWith(`${item.path}/`))) setSelected(null);
      setDialog(null);
      void load();
    } catch (reason) {
      setRemoveError(knowledgeErrorText(reason));
    } finally {
      setRemoving(false);
    }
  };

  const open = (item: DriveItem) => {
    if (item.kind === "folder") {
      setQuery("");
      setResults(null);
      setSelected(null);
      setPath(item.path);
    } else setSelected(item.path);
  };

  const header = (
    <>
      {spaces && <SpaceSwitcher spaces={spaces} space={space} onChange={setSpace} />}
      {space && view === "files" && (
        <>
          <label className="relative flex items-center">
            <Search size={14} className="pointer-events-none absolute start-2.5 text-ink-tertiary" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("drive.search.placeholder")}
              aria-label={t("drive.search.placeholder")}
              className="h-8 w-44 rounded-lg border border-hairline bg-control ps-8 pe-7 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus-visible:ring-2 focus-visible:ring-focus"
            />
            {query && <button type="button" onClick={() => setQuery("")} aria-label={t("drive.search.clear")} className="absolute end-1.5 text-ink-tertiary hover:text-ink"><X size={13} /></button>}
          </label>
          <button type="button" className="ui-button" onClick={() => setDialog({ kind: "folder" })}><FolderPlus size={15} aria-hidden="true" />{t("drive.newFolder")}</button>
          <button type="button" className="ui-button ui-button-primary" onClick={() => picker.current?.click()}><Upload size={15} aria-hidden="true" />{t("drive.upload")}</button>
        </>
      )}
      {admin && space === "internal" && (
        <button type="button" className="ui-button" onClick={() => setDialog({ kind: "access" })}><Users size={15} aria-hidden="true" />{t("drive.access.button")}</button>
      )}
      {space && (
        <button type="button" className={cn("ui-button", view === "trash" && "bg-raised")} aria-pressed={view === "trash"} onClick={() => setView(view === "trash" ? "files" : "trash")}>
          <Trash2 size={15} aria-hidden="true" />{t("drive.trash")}
        </button>
      )}
    </>
  );

  let body;
  if (failed) body = <Problem text={t("drive.error.generic")} onRetry={reloadSpaces} />;
  else if (!spaces) body = <Loading />;
  else if (!space) body = <NoAccess />;
  else if (view === "trash") body = <TrashPanel space={space} onRestored={() => void load()} onBack={() => setView("files")} />;
  else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label={t("drive.title")}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          onDragEnter={(event) => { if (hasFiles(event)) { dragDepth.current += 1; setDragging(true); } }}
          onDragOver={(event) => { if (hasFiles(event)) event.preventDefault(); }}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); }}
          onDrop={onDrop}
        >
          {!results && (
            <nav aria-label={t("drive.breadcrumb.label")} className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-hairline/30 px-4 py-2 text-[13px]">
              <Crumb label={t("drive.breadcrumb.root")} last={!path} onClick={() => setPath("")} />
              {(listing?.breadcrumb ?? []).map((crumb, index, all) => (
                <span key={crumb.path} className="flex items-center gap-0.5">
                  <ChevronRight size={13} className="text-ink-tertiary" aria-hidden="true" />
                  <Crumb label={crumb.name} last={index === all.length - 1} onClick={() => setPath(crumb.path)} />
                </span>
              ))}
            </nav>
          )}
          {results && <p className="shrink-0 border-b border-hairline/30 px-4 py-2 text-[12.5px] text-ink-secondary" role="status">{results.length === 0 ? t("drive.search.none") : t(results.length === 1 ? "drive.search.one" : "drive.search.many", { count: results.length })}</p>}
          {notice && <p role="status" className="shrink-0 px-4 pt-2 text-[12.5px] text-ink-secondary">{notice}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error ? <Problem text={error} onRetry={() => void load()} />
              : !listing && !results ? <Loading />
                : items.length === 0 && !results ? <EmptyFolder />
                  : (
                    <>
                      <div role="presentation" className={cn("hidden gap-3 border-b border-hairline/30 px-4 py-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-tertiary md:grid", COLUMNS)}>
                        <span>{t("drive.col.name")}</span><span>{t("drive.col.by")}</span><span>{t("drive.col.updated")}</span><span className="text-end">{t("drive.col.versions")}</span><span className="text-end">{t("drive.col.size")}</span>
                      </div>
                      <ul>
                        {items.map((item) => (
                          <Row key={`${item.kind}:${item.path}`} item={item} showPath={Boolean(results)} selected={item.path === selected} onOpen={open} onMove={(target) => setDialog({ kind: "move", item: target })} onDelete={(target) => { setRemoveError(null); setDialog({ kind: "delete", item: target }); }} />
                        ))}
                      </ul>
                    </>
                  )}
          </div>
          {uploads.length > 0 && <UploadTray rows={uploads} onDismiss={(id) => setUploads((current) => current.filter((row) => row.id !== id))} />}
          {dragging && !results && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent/60 bg-app/80 text-[14px] font-medium text-accent-text">
              {t("drive.drop", { folder: path || t("drive.breadcrumb.root") })}
            </div>
          )}
        </section>
        {selectedFile && space && (
          <DriveDetail
            space={space}
            file={selectedFile}
            onChanged={() => void load()}
            onClose={() => setSelected(null)}
            onRename={(file) => setDialog({ kind: "move", item: file })}
            onDelete={(file) => { setRemoveError(null); setDialog({ kind: "delete", item: file }); }}
          />
        )}
      </div>
    );
  }

  return (
    <KnowledgeShell icon={<HardDrive size={18} />} title={t("drive.title")} subtitle={t("drive.subtitle")} actions={header}>
      {body}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          setNotice(null);
          void sendFiles(Array.from(event.target.files ?? []), path);
          event.target.value = "";
        }}
      />
      {dialog?.kind === "access" && <InternalPeopleBox onClose={() => setDialog(null)} />}
      {dialog?.kind === "folder" && space && (
        <TextBox
          title={t("drive.newFolder")}
          label={t("drive.folderName")}
          confirm={t("drive.create")}
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            await driveApi.createFolder(space, joinPath(path, name));
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === "move" && space && (
        <TextBox
          title={t("drive.rename.title")}
          label={t("drive.rename.label")}
          hint={t("drive.rename.hint")}
          initial={dialog.item.path}
          confirm={t("drive.rename.save")}
          onCancel={() => setDialog(null)}
          onSubmit={async (target) => {
            const from = dialog.item.path;
            await driveApi.move(space, from, target);
            if (selected === from) setSelected(target);
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmBox
          title={t(dialog.item.kind === "folder" ? "drive.deleteFolder.title" : "drive.delete.title", { name: dialog.item.name })}
          body={t(dialog.item.kind === "folder" ? "drive.deleteFolder.body" : "drive.delete.body")}
          confirm={t("drive.delete")}
          pending={removing}
          error={removeError}
          onCancel={() => setDialog(null)}
          onConfirm={() => void confirmRemove(dialog.item)}
        />
      )}
    </KnowledgeShell>
  );
}

function Crumb({ label, last, onClick }: { label: string; last: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={last ? "page" : undefined} className={cn("rounded-md px-1.5 py-0.5 hover:bg-raised", last ? "font-semibold text-ink" : "text-ink-secondary")}>
      {label}
    </button>
  );
}

function EmptyFolder() {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
      <Upload size={26} className="text-ink-tertiary" aria-hidden="true" />
      <p className="text-[15px] font-medium">{t("drive.empty.title")}</p>
      <p className="max-w-sm text-[13px] text-ink-secondary">{t("drive.empty.hint")}</p>
    </div>
  );
}

function Row({ item, selected, showPath, onOpen, onMove, onDelete }: { item: DriveItem; selected: boolean; showPath: boolean; onOpen: (item: DriveItem) => void; onMove: (item: DriveItem) => void; onDelete: (item: DriveItem) => void }) {
  const folder = item.kind === "folder";
  const where = showPath ? parentOf(item.path) : "";
  return (
    <li className="group relative border-b border-hairline/15">
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-current={selected ? "true" : undefined}
        className={cn("grid w-full items-center gap-3 px-4 py-2 text-start text-[13.5px] hover:bg-raised/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus", COLUMNS, selected && "bg-raised")}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <FileGlyph item={item} />
          <span className="min-w-0">
            <span dir="auto" className="block truncate">{item.name}</span>
            {where && <span className="block truncate text-[11.5px] text-ink-tertiary">{where}</span>}
          </span>
        </span>
        <span className="hidden min-w-0 text-[12.5px] text-ink-secondary md:block">{item.kind === "file" && <ActorBadge actor={item.by} />}</span>
        <span className="hidden text-[12.5px] text-ink-secondary md:block" title={fullDate(item.updatedAt)}>{relativeTime(item.updatedAt)}</span>
        <span className="hidden text-end text-[12.5px] tabular-nums text-ink-secondary md:block">{item.kind === "file" ? item.versions : ""}</span>
        <span className="hidden truncate text-end text-[12.5px] tabular-nums text-ink-secondary md:block">
          {item.kind === "file" ? formatBytes(item.size) : t(item.items === 1 ? "drive.folder.one" : "drive.folder.many", { count: item.items })}
        </span>
      </button>
      <div className="absolute end-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-raised px-0.5 group-focus-within:flex group-hover:flex">
        <button type="button" onClick={() => onMove(item)} aria-label={t("drive.rename")} title={t("drive.rename")} className="ui-icon-button hover:text-ink"><Pencil size={14} /></button>
        {(folder || (item.kind === "file" && item.canDelete)) && (
          <button type="button" onClick={() => onDelete(item)} aria-label={t("drive.delete")} title={t("drive.delete")} className="ui-icon-button hover:text-danger"><Trash2 size={14} /></button>
        )}
      </div>
    </li>
  );
}

function UploadTray({ rows, onDismiss }: { rows: readonly UploadRow[]; onDismiss: (id: number) => void }) {
  return (
    <ul aria-label={t("drive.upload")} className="max-h-40 shrink-0 overflow-y-auto border-t border-hairline/40 bg-card/70 px-4 py-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 py-1 text-[12.5px]">
          <span dir="auto" className="min-w-0 flex-1 truncate">{row.name}</span>
          {row.state === "sending" && <progress value={row.progress} max={1} aria-label={t("drive.upload.progress", { name: row.name })} className="h-1.5 w-28 accent-[var(--color-accent)]" />}
          {row.message && <span className={cn("max-w-[18rem] truncate", row.state === "failed" ? "text-danger" : "text-ink-secondary")} role={row.state === "failed" ? "alert" : "status"}>{row.message}</span>}
          {row.state === "done" && !row.message && <span className="text-success" role="status">{t("drive.upload.done")}</span>}
          {row.state !== "sending" && <button type="button" onClick={() => onDismiss(row.id)} aria-label={t("drive.detail.close")} className="text-ink-tertiary hover:text-ink"><X size={13} /></button>}
        </li>
      ))}
    </ul>
  );
}

function TrashPanel({ space, onRestored, onBack }: { space: KnowledgeSpaceId; onRestored: () => void; onBack: () => void }) {
  const [items, setItems] = useState<DriveTrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    driveApi.trash(space).then((list) => { setItems(list); setError(null); }, (reason: unknown) => setError(knowledgeErrorText(reason)));
  }, [space]);
  useEffect(load, [load]);
  const restore = async (id: string) => {
    try {
      await driveApi.restoreFromTrash(space, id);
      load();
      onRestored();
    } catch (reason) {
      setError(knowledgeErrorText(reason));
    }
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-5">
        <div className="flex items-center gap-3">
          <button type="button" className="ui-button ui-button-md" onClick={onBack}>{t("drive.trash.back")}</button>
          <p className="text-[12.5px] text-ink-secondary">{t("drive.trash.hint")}</p>
        </div>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        {!items ? <Loading /> : items.length === 0 ? <p className="py-10 text-center text-[13.5px] text-ink-secondary">{t("drive.trash.empty")}</p> : (
          <ul className="divide-y divide-hairline/25 rounded-xl border border-hairline/40">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate font-medium">{item.path}</p>
                  <p className="truncate text-[12px] text-ink-secondary">{t("drive.trash.deleted", { when: relativeTime(item.deletedAt), name: item.deletedBy.name })}</p>
                </div>
                <button type="button" className="ui-button ui-button-md" onClick={() => void restore(item.id)}><ArchiveRestore size={14} aria-hidden="true" />{t("drive.trash.restore")}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
