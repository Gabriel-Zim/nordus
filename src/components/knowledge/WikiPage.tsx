import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveRestore, ArrowLeft, BookOpen, FolderUp, Network, Plus, Search, Trash2, X } from "lucide-react";

import { nameOf, parentOf } from "../../../shared/knowledge-path";
import type { KnowledgeSpaceId, WikiListing, WikiPageDetail, WikiTrashItem } from "../../../shared/knowledge";
import { cn } from "@/lib/cn";
import { wikiApi } from "@/lib/knowledge-api";
import { isKnowledgeCode, knowledgeErrorText, relativeTime } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import type { WikiLinkTarget } from "@/lib/wiki-render";
import { ConfirmBox } from "./knowledge-dialogs";
import { KnowledgeShell, Loading, NoAccess, Problem, SpaceSwitcher, useKnowledgeSpaces } from "./knowledge-shared";
import { WikiEditor } from "./WikiEditor";
import { WikiGraphView } from "./WikiGraphView";
import { WikiImportDialog } from "./WikiImportDialog";
import { WikiReader } from "./WikiReader";

type Mode =
  | { kind: "idle" }
  | { kind: "read"; id: string; heading: string | null }
  | { kind: "edit"; id: string | null; seed?: { title?: string; folder?: string } }
  | { kind: "graph" }
  | { kind: "trash" };

const ALL = "";

export function WikiPage() {
  const { spaces, space, setSpace, failed, reload: reloadSpaces } = useKnowledgeSpaces();
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [listing, setListing] = useState<WikiListing | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState(ALL);
  const [tag, setTag] = useState(ALL);
  const [detail, setDetail] = useState<WikiPageDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<{ pending: boolean; error: string | null } | null>(null);
  const requests = useRef(0);

  const loadList = useCallback(async () => {
    if (!space) return;
    const id = ++requests.current;
    try {
      const next = await wikiApi.list(space, { q: query.trim() || undefined, folder: folder || undefined, tag: tag || undefined });
      if (id !== requests.current) return;
      setListing(next);
      setListError(null);
    } catch (reason) {
      if (id === requests.current) setListError(knowledgeErrorText(reason));
    }
  }, [space, query, folder, tag]);

  useEffect(() => {
    const handle = setTimeout(() => void loadList(), query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [loadList, query]);

  useEffect(() => {
    setMode({ kind: "idle" });
    setListing(null);
    setDetail(null);
    setQuery("");
    setFolder(ALL);
    setTag(ALL);
  }, [space]);

  const openId = mode.kind === "read" ? mode.id : mode.kind === "edit" ? mode.id : null;
  const reading = mode.kind === "read";

  const refreshDetail = useCallback(() => {
    if (!space || !openId) return;
    wikiApi.page(space, openId).then((page) => setDetail((current) => (current && current.id === page.id ? page : current)), () => undefined);
  }, [space, openId]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadList();
      if (reading) refreshDetail();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadList, refreshDetail, reading]);

  useEffect(() => {
    if (!space || !openId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let live = true;
    setDetailError(null);
    wikiApi.page(space, openId).then(
      (page) => { if (live) setDetail(page); },
      (reason: unknown) => {
        if (!live) return;
        setDetail(null);
        if (isKnowledgeCode(reason, "not_found")) {
          setMode({ kind: "idle" });
          void loadList();
        } else setDetailError(knowledgeErrorText(reason));
      },
    );
    return () => { live = false; };
  }, [space, openId, loadList]);

  const openById = useCallback((id: string) => setMode({ kind: "read", id, heading: null }), []);
  const openLink = useCallback((target: WikiLinkTarget, id: string | null) => {
    if (id) {
      setMode({ kind: "read", id, heading: target.heading ?? null });
      return;
    }
    const written = target.target.replace(/\/+$/, "");
    const place = written.includes("/") ? parentOf(written) : (detail?.folder ?? "");
    setMode({ kind: "edit", id: null, seed: { title: nameOf(written), folder: place } });
  }, [detail?.folder]);

  const saved = (page: WikiPageDetail) => {
    setDetail(page);
    setMode({ kind: "read", id: page.id, heading: null });
    void loadList();
  };

  const confirmRemove = async () => {
    if (!space || !detail) return;
    setRemoving({ pending: true, error: null });
    try {
      await wikiApi.remove(space, detail.id);
      setRemoving(null);
      setDetail(null);
      setMode({ kind: "idle" });
      void loadList();
    } catch (reason) {
      setRemoving({ pending: false, error: knowledgeErrorText(reason) });
    }
  };

  const idle = mode.kind === "idle";
  const header = (
    <>
      {spaces && <SpaceSwitcher spaces={spaces} space={space} onChange={setSpace} />}
      {space && (
        <>
          <button type="button" className="ui-button ui-button-primary" onClick={() => setMode({ kind: "edit", id: null })}><Plus size={15} aria-hidden="true" />{t("wiki.new")}</button>
          <button type="button" className="ui-button" onClick={() => setImporting(true)}><FolderUp size={15} aria-hidden="true" />{t("wiki.import")}</button>
          <button type="button" className={cn("ui-button", mode.kind === "graph" && "bg-raised")} aria-pressed={mode.kind === "graph"} onClick={() => setMode(mode.kind === "graph" ? { kind: "idle" } : { kind: "graph" })}><Network size={15} aria-hidden="true" />{t("wiki.graph.title")}</button>
          <button type="button" className={cn("ui-button", mode.kind === "trash" && "bg-raised")} aria-pressed={mode.kind === "trash"} onClick={() => setMode(mode.kind === "trash" ? { kind: "idle" } : { kind: "trash" })}><Trash2 size={15} aria-hidden="true" />{t("drive.trash")}</button>
        </>
      )}
    </>
  );

  let main;
  if (!space) main = null;
  else if (mode.kind === "graph") main = <WikiGraphView space={space} current={detail?.id ?? null} onOpen={openById} />;
  else if (mode.kind === "trash") main = <WikiTrash space={space} onRestored={(id) => { void loadList(); openById(id); }} />;
  else if (mode.kind === "edit") {
    main = mode.id && !detail
      ? (detailError ? <Problem text={detailError} /> : <Loading />)
      : <WikiEditor key={mode.id ?? `new:${mode.seed?.title ?? ""}`} space={space} page={mode.id ? detail : null} {...(mode.seed ? { seed: mode.seed } : {})} onSaved={saved} onCancel={() => { setMode(mode.id ? { kind: "read", id: mode.id, heading: null } : { kind: "idle" }); if (mode.id) refreshDetail(); }} />;
  } else if (mode.kind === "read") {
    main = detailError ? <Problem text={detailError} /> : !detail || detail.id !== mode.id ? <Loading /> : (
      <WikiReader
        space={space}
        page={detail}
        heading={mode.heading}
        onOpenPage={openLink}
        onOpenById={openById}
        onEdit={() => setMode({ kind: "edit", id: detail.id })}
        onDelete={() => setRemoving({ pending: false, error: null })}
        onChanged={(page) => { setDetail(page); void loadList(); }}
      />
    );
  } else main = <IdleMain empty={listing?.pages.length === 0 && !query && !folder && !tag} onNew={() => setMode({ kind: "edit", id: null })} onImport={() => setImporting(true)} />;

  let body;
  if (failed) body = <Problem text={t("drive.error.generic")} onRetry={reloadSpaces} />;
  else if (!spaces) body = <Loading />;
  else if (!space) body = <NoAccess />;
  else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav aria-label={t("wiki.title")} className={cn("min-h-0 w-full flex-col border-hairline/40 lg:flex lg:w-72 lg:shrink-0 lg:border-e", idle ? "flex flex-1" : "hidden")}>
          <PageList listing={listing} error={listError} query={query} folder={folder} tag={tag} current={openId} onQuery={setQuery} onFolder={setFolder} onTag={setTag} onOpen={openById} onRetry={() => void loadList()} />
        </nav>
        <section className={cn("min-h-0 min-w-0 flex-1 flex-col", idle ? "hidden lg:flex" : "flex")}>
          {!idle && (
            <button type="button" onClick={() => setMode({ kind: "idle" })} className="ui-button ui-button-md m-3 self-start lg:hidden"><ArrowLeft size={14} aria-hidden="true" />{t("wiki.back")}</button>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{main}</div>
        </section>
      </div>
    );
  }

  return (
    <KnowledgeShell icon={<BookOpen size={18} />} title={t("wiki.title")} subtitle={t("wiki.subtitle")} actions={header}>
      {body}
      {importing && space && <WikiImportDialog space={space} onClose={() => setImporting(false)} onDone={() => void loadList()} />}
      {removing && detail && (
        <ConfirmBox
          title={t("wiki.delete.title", { title: detail.title })}
          body={t("wiki.delete.body")}
          confirm={t("wiki.delete")}
          pending={removing.pending}
          error={removing.error}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void confirmRemove()}
        />
      )}
    </KnowledgeShell>
  );
}

function IdleMain({ empty, onNew, onImport }: { empty: boolean; onNew: () => void; onImport: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <BookOpen size={26} className="text-ink-tertiary" aria-hidden="true" />
      <p className="text-[15px] font-medium">{empty ? t("wiki.list.empty") : t("wiki.page.pick")}</p>
      {empty && <p className="max-w-sm text-[13px] text-ink-secondary">{t("wiki.list.emptyHint")}</p>}
      {empty && (
        <div className="mt-2 flex gap-2">
          <button type="button" className="ui-button ui-button-primary" onClick={onNew}><Plus size={15} aria-hidden="true" />{t("wiki.new")}</button>
          <button type="button" className="ui-button" onClick={onImport}><FolderUp size={15} aria-hidden="true" />{t("wiki.import")}</button>
        </div>
      )}
    </div>
  );
}

function PageList({ listing, error, query, folder, tag, current, onQuery, onFolder, onTag, onOpen, onRetry }: {
  listing: WikiListing | null;
  error: string | null;
  query: string;
  folder: string;
  tag: string;
  current: string | null;
  onQuery: (value: string) => void;
  onFolder: (value: string) => void;
  onTag: (value: string) => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-hairline/30 p-3">
        <label className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute start-2.5 text-ink-tertiary" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t("wiki.search.placeholder")}
            aria-label={t("wiki.search.placeholder")}
            className="h-8 w-full rounded-lg border border-hairline bg-control ps-8 pe-7 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus-visible:ring-2 focus-visible:ring-focus"
          />
          {query && <button type="button" onClick={() => onQuery("")} aria-label={t("drive.search.clear")} className="absolute end-1.5 text-ink-tertiary hover:text-ink"><X size={13} /></button>}
        </label>
        {listing && (listing.folders.length > 0 || listing.tags.length > 0) && (
          <div className="flex gap-2">
            {listing.folders.length > 0 && (
              <select value={folder} onChange={(event) => onFolder(event.target.value)} aria-label={t("wiki.filter.folder")} className="ui-button ui-button-md min-w-0 flex-1 cursor-pointer appearance-none truncate">
                <option value={ALL}>{t("wiki.filter.allFolders")}</option>
                {listing.folders.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            )}
            {listing.tags.length > 0 && (
              <select value={tag} onChange={(event) => onTag(event.target.value)} aria-label={t("wiki.filter.tag")} className="ui-button ui-button-md min-w-0 flex-1 cursor-pointer appearance-none truncate">
                <option value={ALL}>{t("wiki.filter.allTags")}</option>
                {listing.tags.map((entry) => <option key={entry.tag} value={entry.tag}>{`${entry.tag} (${entry.count})`}</option>)}
              </select>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <Problem text={error} onRetry={onRetry} /> : !listing ? <Loading /> : listing.pages.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-secondary">{query.trim() ? t("wiki.list.noResults", { query: query.trim() }) : folder || tag ? t("wiki.list.noneHere") : t("wiki.list.empty")}</p>
        ) : (
          <ul>
            {listing.pages.map((page) => (
              <li key={page.id} className="border-b border-hairline/15">
                <button type="button" onClick={() => onOpen(page.id)} aria-current={page.id === current ? "page" : undefined} className={cn("block w-full px-4 py-2.5 text-start hover:bg-raised/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus", page.id === current && "bg-raised")}>
                  <span dir="auto" className="block truncate text-[13.5px] font-medium">{page.title}</span>
                  {page.folder && <span dir="auto" className="block truncate text-[11.5px] text-ink-tertiary">{page.folder}</span>}
                  {page.snippet && <span dir="auto" className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-ink-secondary">{page.snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function WikiTrash({ space, onRestored }: { space: KnowledgeSpaceId; onRestored: (id: string) => void }) {
  const [items, setItems] = useState<WikiTrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    wikiApi.trash(space).then((list) => { setItems(list); setError(null); }, (reason: unknown) => setError(knowledgeErrorText(reason)));
  }, [space]);
  useEffect(load, [load]);
  const restore = async (id: string) => {
    try {
      await wikiApi.restoreFromTrash(space, id);
      onRestored(id);
    } catch (reason) {
      setError(knowledgeErrorText(reason));
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-5">
      <p className="text-[12.5px] text-ink-secondary">{t("wiki.trash.hint")}</p>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {!items ? <Loading /> : items.length === 0 ? <p className="py-10 text-center text-[13.5px] text-ink-secondary">{t("drive.trash.empty")}</p> : (
        <ul className="divide-y divide-hairline/25 rounded-xl border border-hairline/40">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate font-medium">{item.folder ? `${item.folder} / ${item.title}` : item.title}</p>
                <p className="truncate text-[12px] text-ink-secondary">{t("drive.trash.deleted", { when: relativeTime(item.deletedAt), name: item.deletedBy.name })}</p>
              </div>
              <button type="button" className="ui-button ui-button-md" onClick={() => void restore(item.id)}><ArchiveRestore size={14} aria-hidden="true" />{t("drive.trash.restore")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
