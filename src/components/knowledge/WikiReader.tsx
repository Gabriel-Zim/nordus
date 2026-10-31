import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Pencil, RotateCcw, Tag, Trash2 } from "lucide-react";

import type { KnowledgeSpaceId, WikiPageDetail, WikiVersionItem } from "../../../shared/knowledge";
import { previewKindFor } from "../../../shared/knowledge";
import { cn } from "@/lib/cn";
import { driveApi, wikiApi } from "@/lib/knowledge-api";
import { fullDate, knowledgeErrorText, relativeTime, formatBytes, versionNote } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { headingKey, plainLine, wikiMarkdown, type WikiLinkTarget } from "@/lib/wiki-render";
import { ActorBadge, Loading } from "./knowledge-shared";
import { WikiMarkdown } from "./WikiMarkdown";

interface ReaderProps {
  space: KnowledgeSpaceId;
  page: WikiPageDetail;
  /** A section to scroll to once the page is shown. */
  heading: string | null;
  onOpenPage: (target: WikiLinkTarget, id: string | null) => void;
  onOpenById: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** The page changed here (a version was brought back). */
  onChanged: (page: WikiPageDetail) => void;
}

export function WikiReader({ space, page, heading, onOpenPage, onOpenById, onEdit, onDelete, onChanged }: ReaderProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<{ n: number; content: string } | null>(null);

  useEffect(() => {
    setViewing(null);
  }, [page.id, page.version]);

  const shown = viewing ? viewing.content : page.content;
  const markdown = useMemo(() => wikiMarkdown({ content: shown, links: page.links, files: page.files }), [shown, page.links, page.files]);
  const fileUrl = useCallback((drivePath: string) => (["image", "pdf"].includes(previewKindFor(drivePath)) ? driveApi.previewUrl(space, drivePath) : driveApi.downloadUrl(space, drivePath)), [space]);

  useEffect(() => {
    if (!heading) return;
    const wanted = headingKey(heading);
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-heading]")).find((node) => node.dataset.heading === wanted);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [heading, page.id, markdown]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <article className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-label={page.title}>
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <header className="mb-4">
            {page.folder && <p dir="auto" className="mb-1 truncate text-[12.5px] text-ink-tertiary">{page.folder}</p>}
            <h2 dir="auto" className="break-words text-[26px] font-semibold leading-9">{page.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-secondary">
              <span title={fullDate(page.updatedAt)}>{t("wiki.updatedBy", { when: relativeTime(page.updatedAt) })}</span>
              <ActorBadge actor={page.updatedBy} size={16} />
            </div>
            {page.tags.length > 0 && (
              <ul aria-label={t("wiki.tags")} className="mt-2 flex flex-wrap gap-1.5">
                {page.tags.map((tag) => (
                  <li key={tag} className="inline-flex items-center gap-1 rounded-full bg-inset px-2 py-0.5 text-[12px] text-ink-secondary"><Tag size={11} aria-hidden="true" />{tag}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button type="button" className="ui-button ui-button-md" onClick={onEdit}><Pencil size={14} aria-hidden="true" />{t("wiki.edit")}</button>
              <button type="button" className={cn("ui-button ui-button-md", historyOpen && "bg-raised")} aria-pressed={historyOpen} onClick={() => setHistoryOpen((value) => !value)}>
                <History size={14} aria-hidden="true" />{t("wiki.history")}
              </button>
              {page.canDelete && <button type="button" className="ui-button ui-button-md text-danger" onClick={onDelete}><Trash2 size={14} aria-hidden="true" />{t("wiki.delete")}</button>}
            </div>
          </header>

          {viewing && (
            <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-[13px]">
              <span className="me-auto">{t("wiki.history.viewing", { n: viewing.n })}</span>
              <RestoreButton space={space} page={page} version={viewing.n} onRestored={onChanged} />
              <button type="button" className="ui-button ui-button-sm" onClick={() => setViewing(null)}>{t("wiki.history.back")}</button>
            </div>
          )}

          {shown.trim() ? <WikiMarkdown markdown={markdown} links={page.links} files={page.files} fileUrl={fileUrl} onOpenPage={onOpenPage} /> : <p className="text-[13.5px] text-ink-tertiary">{t("wiki.page.emptyText")}</p>}

          <section aria-labelledby="wiki-backlinks" className="mt-10 border-t border-hairline/40 pt-4">
            <h3 id="wiki-backlinks" className="mb-2 text-[13px] font-semibold">{t("wiki.backlinks")}</h3>
            {page.backlinks.length === 0 ? <p className="text-[13px] text-ink-tertiary">{t("wiki.backlinks.none")}</p> : (
              <ul className="flex flex-col gap-1.5">
                {page.backlinks.map((link) => (
                  <li key={link.id}>
                    <button type="button" onClick={() => onOpenById(link.id)} className="w-full rounded-lg border border-hairline/40 px-3 py-2 text-start hover:bg-raised/50">
                      <span dir="auto" className="block truncate text-[13.5px] font-medium">{link.folder ? `${link.folder} / ${link.title}` : link.title}</span>
                      {link.excerpt && <span dir="auto" className="mt-0.5 block truncate text-[12.5px] text-ink-secondary">{plainLine(link.excerpt)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </article>
      {historyOpen && (
        <WikiHistory
          space={space}
          page={page}
          viewing={viewing?.n ?? null}
          onView={(n, content) => setViewing({ n, content })}
          onRestored={(restored) => { setViewing(null); onChanged(restored); }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

function RestoreButton({ space, page, version, onRestored }: { space: KnowledgeSpaceId; page: WikiPageDetail; version: number; onRestored: (page: WikiPageDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      onRestored((await wikiApi.restore(space, page.id, version)).page);
    } catch (reason) {
      setError(knowledgeErrorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void restore()} className="ui-button ui-button-sm"><RotateCcw size={12} aria-hidden="true" />{t("wiki.history.restore")}</button>
      {error && <span role="alert" className="text-[12px] text-danger">{error}</span>}
    </>
  );
}

function WikiHistory({ space, page, viewing, onView, onRestored, onClose }: {
  space: KnowledgeSpaceId;
  page: WikiPageDetail;
  viewing: number | null;
  onView: (n: number, content: string) => void;
  onRestored: (page: WikiPageDetail) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<WikiVersionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    wikiApi.versions(space, page.id).then(
      (list) => { if (live) setVersions(list); },
      (reason: unknown) => { if (live) setError(knowledgeErrorText(reason)); },
    );
    return () => { live = false; };
  }, [space, page.id, page.version]);

  const view = async (n: number) => {
    setLoading(n);
    setError(null);
    try {
      onView(n, (await wikiApi.version(space, page.id, n)).content);
    } catch (reason) {
      setError(knowledgeErrorText(reason));
    } finally {
      setLoading(null);
    }
  };

  return (
    <aside aria-label={t("wiki.history")} className="flex min-h-0 w-full flex-col overflow-y-auto border-hairline/40 bg-card/40 lg:w-80 lg:shrink-0 lg:border-s">
      <div className="flex items-center gap-2 px-4 pt-4">
        <h3 className="me-auto flex items-center gap-1.5 text-[13px] font-semibold"><History size={14} aria-hidden="true" />{t("wiki.history")}</h3>
        <button type="button" className="ui-button ui-button-sm" onClick={onClose}>{t("drive.detail.close")}</button>
      </div>
      {error && <p role="alert" className="px-4 pt-2 text-[12.5px] text-danger">{error}</p>}
      {!versions ? <Loading /> : (
        <ol className="flex flex-col gap-1.5 p-4">
          {versions.map((version) => (
            <li key={version.n} className={cn("rounded-lg border px-2.5 py-2 text-[12.5px]", viewing === version.n ? "border-accent/50 bg-accent/5" : "border-hairline/40")}>
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">v{version.n}</span>
                {version.current && <span className="rounded-full bg-accent/15 px-1.5 text-[11px] text-accent-text">{t("wiki.history.current")}</span>}
                <span className="ms-auto text-ink-secondary" title={fullDate(version.at)}>{relativeTime(version.at)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-ink-secondary">
                <ActorBadge actor={version.by} size={16} className="flex-1" />
                <span className="shrink-0 tabular-nums">{formatBytes(version.size)}</span>
              </div>
              {version.summary && <p dir="auto" className="mt-1 break-words text-ink-secondary">{versionNote(version.summary)}</p>}
              {!version.current && (
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" disabled={loading !== null} onClick={() => void view(version.n)} className="ui-button ui-button-sm">{t("wiki.history.view")}</button>
                  <RestoreButton space={space} page={page} version={version.n} onRestored={onRestored} />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
