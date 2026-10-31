import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, History, Pencil, RotateCcw, Trash2, X } from "lucide-react";

import type { DriveFileItem, DriveVersionItem, KnowledgeSpaceId } from "../../../shared/knowledge";
import { cn } from "@/lib/cn";
import { driveApi } from "@/lib/knowledge-api";
import { formatBytes, fullDate, knowledgeErrorText, relativeTime, versionNote } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { TABLE_FILE_MAX_BYTES, type TextTable, tableDelimiter } from "@/lib/table-data";
import { RichTable } from "../RichTable";
import { ActorBadge, FileGlyph, Loading, Problem } from "./knowledge-shared";
import { WikiMarkdown } from "./WikiMarkdown";

interface DetailProps {
  space: KnowledgeSpaceId;
  file: DriveFileItem;
  /** Changes made here that the list must show. */
  onChanged: () => void;
  onClose: () => void;
  onRename: (file: DriveFileItem) => void;
  onDelete: (file: DriveFileItem) => void;
}

export function DriveDetail({ space, file, onChanged, onClose, onRename, onDelete }: DetailProps) {
  const [versions, setVersions] = useState<DriveVersionItem[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(null);
    driveApi.info(space, file.path).then(
      (info) => { if (live) setVersions(info.versions); },
      (error: unknown) => { if (live) setFailed(knowledgeErrorText(error)); },
    );
    return () => { live = false; };
  }, [space, file.path, file.updatedAt, revision]);

  const restore = useCallback(async (version: number) => {
    setBusy(version);
    setFailed(null);
    try {
      await driveApi.restore(space, file.path, version);
      setRevision((value) => value + 1);
      onChanged();
    } catch (error) {
      setFailed(knowledgeErrorText(error));
    } finally {
      setBusy(null);
    }
  }, [space, file.path, onChanged]);

  return (
    <aside aria-label={file.name} className="flex min-h-0 w-full flex-col overflow-y-auto border-hairline/40 bg-card/40 lg:w-[26rem] lg:shrink-0 lg:border-s">
      <div className="flex items-start gap-2 px-4 pb-2 pt-4">
        <FileGlyph item={file} size={20} />
        <div className="min-w-0 flex-1">
          <h2 dir="auto" className="break-words text-[15px] font-semibold leading-5">{file.name}</h2>
          <p className="mt-0.5 text-[12px] text-ink-secondary">
            {formatBytes(file.size)} · <time dateTime={new Date(file.updatedAt).toISOString()} title={fullDate(file.updatedAt)}>{relativeTime(file.updatedAt)}</time>
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("drive.detail.close")} title={t("drive.detail.close")} className="ui-icon-button -me-1 -mt-1 hover:bg-raised">
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        <a href={driveApi.downloadUrl(space, file.path)} download={file.name} className="ui-button ui-button-md"><Download size={14} aria-hidden="true" />{t("drive.download")}</a>
        <button type="button" className="ui-button ui-button-md" onClick={() => onRename(file)}><Pencil size={14} aria-hidden="true" />{t("drive.rename")}</button>
        {file.canDelete && <button type="button" className="ui-button ui-button-md text-danger" onClick={() => onDelete(file)}><Trash2 size={14} aria-hidden="true" />{t("drive.delete")}</button>}
      </div>

      <div className="px-4 pb-4">
        <FilePreview key={`${file.path}:${file.updatedAt}`} space={space} file={file} />
      </div>

      <section className="border-t border-hairline/40 px-4 py-3" aria-labelledby="drive-history-title">
        <h3 id="drive-history-title" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><History size={14} aria-hidden="true" />{t("drive.history.title")}</h3>
        {failed && <p role="alert" className="mb-2 text-[12.5px] text-danger">{failed}</p>}
        {!versions ? <Loading /> : (
          <ol className="flex flex-col gap-1.5">
            {versions.map((version) => (
              <li key={version.n} className={cn("rounded-lg border px-2.5 py-2 text-[12.5px]", version.current ? "border-accent/40 bg-accent/5" : "border-hairline/40")}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">v{version.n}</span>
                  {version.current && <span className="rounded-full bg-accent/15 px-1.5 text-[11px] text-accent-text">{t("drive.history.current")}</span>}
                  <span className="ms-auto text-ink-secondary" title={fullDate(version.at)}>{relativeTime(version.at)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-ink-secondary">
                  <ActorBadge actor={version.by} size={16} className="flex-1" />
                  <span className="shrink-0 tabular-nums">{formatBytes(version.size)}</span>
                </div>
                {version.note && <p dir="auto" className="mt-1 break-words text-ink-secondary">{versionNote(version.note)}</p>}
                <div className="mt-1.5 flex gap-1.5">
                  <a href={driveApi.downloadUrl(space, file.path, version.n)} download={file.name} className="ui-button ui-button-sm"><Download size={12} aria-hidden="true" />{t("drive.history.open")}</a>
                  {!version.current && (
                    <button type="button" disabled={busy !== null} onClick={() => void restore(version.n)} className="ui-button ui-button-sm">
                      <RotateCcw size={12} aria-hidden="true" />{t("drive.history.restore")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}

function FilePreview({ space, file }: { space: KnowledgeSpaceId; file: DriveFileItem }) {
  const url = driveApi.previewUrl(space, file.path);
  switch (file.preview) {
    case "image":
      return <img src={url} alt={file.name} className="max-h-[26rem] w-full rounded-lg bg-inset object-contain" />;
    case "pdf":
      return (
        <div className="flex flex-col gap-2">
          <iframe title={file.name} src={url} className="h-[30rem] w-full rounded-lg border border-hairline/40 bg-inset" />
          <a href={url} target="_blank" rel="noreferrer noopener" className="text-[12.5px] text-accent-text underline">{t("drive.preview.openPdf")}</a>
        </div>
      );
    case "audio":
      return <audio controls src={url} className="w-full" />;
    case "video":
      return <video controls src={url} className="max-h-[26rem] w-full rounded-lg bg-black" />;
    case "markdown":
    case "text":
      return <TextPreview url={url} markdown={file.preview === "markdown"} />;
    case "csv":
      return <CsvPreview url={url} name={file.name} />;
    default:
      return <p className="rounded-lg bg-inset px-3 py-4 text-[13px] text-ink-secondary">{t("drive.preview.none")}</p>;
  }
}

type Fetched = { state: "loading" } | { state: "failed" } | { state: "ready"; text: string; truncated: boolean };

function useFetchedText(url: string, maxBytes: number): [Fetched, () => void] {
  const [result, setResult] = useState<Fetched>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ state: "loading" });
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("preview");
        const text = await response.text();
        if (text.length > maxBytes * 2) throw new Error("size");
        setResult({ state: "ready", text, truncated: response.headers.get("x-knowledge-truncated") === "1" });
      } catch {
        if (!controller.signal.aborted) setResult({ state: "failed" });
      }
    })();
    return () => controller.abort();
  }, [url, maxBytes, attempt]);
  return [result, () => setAttempt((value) => value + 1)];
}

function TextPreview({ url, markdown }: { url: string; markdown: boolean }) {
  const [result, retry] = useFetchedText(url, 1024 * 1024);
  if (result.state === "loading") return <Loading label={t("drive.preview.loading")} />;
  if (result.state === "failed") return <Problem text={t("drive.preview.failed")} onRetry={retry} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[30rem] overflow-auto rounded-lg border border-hairline/40 bg-inset/60 p-3">
        {markdown
          ? <WikiMarkdown markdown={result.text} />
          : <pre dir="auto" className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5">{result.text}</pre>}
      </div>
      {result.truncated && <p className="text-[12px] text-ink-secondary">{t("drive.preview.truncated")}</p>}
    </div>
  );
}

function CsvPreview({ url, name }: { url: string; name: string }) {
  const [result, retry] = useFetchedText(url, TABLE_FILE_MAX_BYTES);
  const [table, setTable] = useState<TextTable | null>(null);
  const [invalid, setInvalid] = useState(false);
  const delimiter = tableDelimiter(name) ?? ",";
  const text = result.state === "ready" ? result.text : null;
  useEffect(() => {
    setTable(null);
    setInvalid(false);
    if (text === null) return;
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL("../../lib/table-file.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ table?: TextTable; error?: string }>) => {
        if (event.data.table) setTable(event.data.table);
        else setInvalid(true);
        worker?.terminate();
      };
      worker.onerror = () => { setInvalid(true); worker?.terminate(); };
      worker.postMessage({ text, delimiter });
    } catch {
      setInvalid(true);
    }
    return () => worker?.terminate();
  }, [text, delimiter]);
  const data = useMemo(() => table && { columns: table.headers.map((cell) => ({ text: cell })), rows: table.rows.map((row) => row.map((cell) => ({ text: cell }))) }, [table]);
  if (result.state === "loading") return <Loading label={t("drive.preview.loading")} />;
  if (result.state === "failed") return <Problem text={t("drive.preview.failed")} onRetry={retry} />;
  if (invalid) return <Problem text={t("table.invalid")} />;
  if (!data) return <Loading label={t("table.loading")} />;
  return (
    <div className="flex flex-col gap-2">
      <RichTable {...data} name={name} />
      {result.truncated && <p className="text-[12px] text-ink-secondary">{t("drive.preview.truncated")}</p>}
    </div>
  );
}
