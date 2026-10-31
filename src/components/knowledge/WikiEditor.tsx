import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { Eye, Pencil } from "lucide-react";

import type { KnowledgeSpaceId, WikiPageDetail, WikiPageSummary } from "../../../shared/knowledge";
import { createWikiResolver, scanWikiLinks } from "../../../shared/wiki-markdown";
import { cn } from "@/lib/cn";
import { wikiApi } from "@/lib/knowledge-api";
import { isKnowledgeCode, knowledgeErrorText } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { wikiMarkdown } from "@/lib/wiki-render";
import { ConfirmBox } from "./knowledge-dialogs";
import { WikiMarkdown } from "./WikiMarkdown";

interface EditorProps {
  space: KnowledgeSpaceId;
  /** The page being edited; null when this is a new one. */
  page: WikiPageDetail | null;
  seed?: { title?: string; folder?: string };
  onSaved: (page: WikiPageDetail) => void;
  onCancel: () => void;
}

const FIELD = "w-full rounded-lg border border-hairline bg-control px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-tertiary focus-visible:ring-2 focus-visible:ring-focus";

export function WikiEditor({ space, page, seed, onSaved, onCancel }: EditorProps) {
  const initial = useMemo(() => ({ title: page?.title ?? seed?.title ?? "", folder: page?.folder ?? seed?.folder ?? "", content: page?.content ?? "" }), [page, seed]);
  const [title, setTitle] = useState(initial.title);
  const [folder, setFolder] = useState(initial.folder);
  const [content, setContent] = useState(initial.content);
  const [summary, setSummary] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    let live = true;
    wikiApi.list(space).then(
      (listing) => { if (live) { setPages(listing.pages); setFolders(listing.folders); } },
      () => undefined,
    );
    return () => { live = false; };
  }, [space]);

  const dirty = title !== initial.title || folder !== initial.folder || content !== initial.content;
  const links = useMemo(() => {
    if (tab !== "preview") return {};
    const resolve = createWikiResolver(pages);
    const found: Record<string, string | null> = {};
    for (const link of scanWikiLinks(content)) if (!link.embed) found[link.target] = resolve(link.target, folder);
    return found;
  }, [tab, pages, content, folder]);
  const preview = useMemo(() => (tab === "preview" ? wikiMarkdown({ content, links, files: {} }) : ""), [tab, content, links]);

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving || !title.trim()) return;
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      const note = summary.trim() || undefined;
      const saved = page
        ? await wikiApi.update(space, page.id, {
          content,
          ...(title.trim() !== page.title ? { title: title.trim() } : {}),
          ...(folder.trim() !== page.folder ? { folder: folder.trim() } : {}),
          expectedVersion: page.version,
          ...(note ? { summary: note } : {}),
        })
        : await wikiApi.create({ space, title: title.trim(), content, ...(folder.trim() ? { folder: folder.trim() } : {}), ...(note ? { summary: note } : {}) });
      onSaved(saved.page);
    } catch (reason) {
      if (isKnowledgeCode(reason, "conflict")) setConflict(true);
      setError(knowledgeErrorText(reason));
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  };
  const cancel = () => (dirty ? setConfirmDiscard(true) : onCancel());

  return (
    <form onSubmit={(event) => void save(event)} onKeyDown={onKeyDown} className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
          {t("wiki.editor.title")}
          <input value={title} onChange={(event) => setTitle(event.target.value)} dir="auto" maxLength={120} required placeholder={t("wiki.editor.newTitle")} className={cn(FIELD, "text-[16px] font-semibold")} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
          {t("wiki.editor.folder")}
          <input value={folder} onChange={(event) => setFolder(event.target.value)} dir="auto" list="wiki-folders" className={FIELD} />
          <datalist id="wiki-folders">{folders.map((entry) => <option key={entry} value={entry} />)}</datalist>
        </label>
      </div>

      <div role="tablist" aria-label={t("wiki.editor.content")} className="flex gap-1">
        <button type="button" role="tab" aria-selected={tab === "write"} onClick={() => setTab("write")} className={cn("ui-button ui-button-md", tab === "write" && "bg-raised")}><Pencil size={13} aria-hidden="true" />{t("wiki.editor.write")}</button>
        <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")} className={cn("ui-button ui-button-md", tab === "preview" && "bg-raised")}><Eye size={13} aria-hidden="true" />{t("wiki.editor.preview")}</button>
      </div>

      {tab === "write" ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            dir="auto"
            spellCheck
            aria-label={t("wiki.editor.content")}
            className={cn(FIELD, "min-h-[24rem] resize-y font-mono text-[13px] leading-6")}
          />
          <p className="text-[12px] text-ink-tertiary">{t("wiki.editor.hint")}</p>
        </div>
      ) : (
        <div className="min-h-[24rem] rounded-lg border border-hairline/40 bg-card/40 px-4 py-3">
          {content.trim() ? <WikiMarkdown markdown={preview} links={links} /> : <p className="text-[13px] text-ink-tertiary">{t("wiki.editor.emptyPreview")}</p>}
        </div>
      )}

      <label className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
        {t("wiki.editor.summary")}
        <input value={summary} onChange={(event) => setSummary(event.target.value)} dir="auto" maxLength={200} className={FIELD} />
      </label>

      {error && (
        <div role="alert" className="flex flex-col items-start gap-2 text-[13px] text-danger">
          <p>{error}</p>
          {conflict && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="ui-button ui-button-md text-ink"
                onClick={() => { void navigator.clipboard?.writeText(content).then(() => setCopied(true), () => undefined); }}
              >
                {copied ? t("wiki.conflict.copied") : t("wiki.conflict.copy")}
              </button>
              <button type="button" className="ui-button ui-button-md text-ink" onClick={onCancel}>{t("wiki.conflict.seeCurrent")}</button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={cancel} disabled={saving} className="rounded-xl px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">{t("drive.cancel")}</button>
        <button type="submit" disabled={saving || !title.trim() || (page !== null && !dirty)} className="ui-button ui-button-primary px-5">{saving ? t("wiki.saving") : t("wiki.save")}</button>
      </div>

      {confirmDiscard && (
        <ConfirmBox title={t("wiki.discard.title")} body={t("wiki.discard.body")} confirm={t("wiki.discard.confirm")} onCancel={() => setConfirmDiscard(false)} onConfirm={onCancel} />
      )}
    </form>
  );
}
