import { useRef, useState } from "react";
import { FolderUp, LoaderCircle } from "lucide-react";

import type { ImportSkipReason, KnowledgeSpaceId } from "../../../shared/knowledge";
import { WIKI_ATTACHMENTS_FOLDER } from "../../../shared/knowledge";
import { wikiApi } from "@/lib/knowledge-api";
import { isHiddenPath, knowledgeErrorText, vaultFilesOf, type VaultFile } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { runVaultImport, type ImportApi, type ImportOutcome, type ImportProgress } from "@/lib/wiki-import";
import type { LocaleKey } from "@/locales";
import { Modal } from "./knowledge-dialogs";

const REASONS: Readonly<Record<ImportSkipReason, LocaleKey>> = {
  hidden: "wiki.import.reason.hidden",
  unsupported: "wiki.import.reason.unsupported",
  "too-large": "wiki.import.reason.tooLarge",
  "bad-path": "wiki.import.reason.badPath",
  conflict: "wiki.import.reason.conflict",
  limit: "wiki.import.reason.limit",
};

const adapter: ImportApi = {
  start: (space, root) => wikiApi.importStart(space, root),
  file: (space, session, path, body, signal) => wikiApi.importFile(space, session, path, body, signal),
  finish: (space, session) => wikiApi.importFinish(space, session),
  cancel: (space, session) => wikiApi.importCancel(space, session),
};

const isNote = (path: string) => /\.(md|markdown)$/i.test(path);

export function WikiImportDialog({ space, onClose, onDone }: { space: KnowledgeSpaceId; onClose: () => void; onDone: () => void }) {
  const [vault, setVault] = useState<{ root: string; files: VaultFile[] } | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = progress !== null && outcome === null;

  const counts = vault && {
    notes: vault.files.filter((entry) => !isHiddenPath(entry.path) && isNote(entry.path)).length,
    others: vault.files.filter((entry) => !isHiddenPath(entry.path) && !isNote(entry.path)).length,
  };

  const start = async () => {
    if (!vault || running) return;
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setProgress({ phase: "sending", sent: 0, total: 0 });
    try {
      const result = await runVaultImport({ api: adapter, space, root: vault.root, files: vault.files, signal: controller.signal, onProgress: setProgress });
      setOutcome(result);
      onDone();
    } catch (reason) {
      setProgress(null);
      if (!controller.signal.aborted) setError(knowledgeErrorText(reason));
    } finally {
      abort.current = null;
    }
  };

  const cancel = () => {
    if (running) abort.current?.abort();
    else onClose();
  };

  return (
    <Modal title={t("wiki.import.title")} onClose={running ? () => undefined : onClose} wide>
      {!outcome && (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{t("wiki.import.intro", { folder: WIKI_ATTACHMENTS_FOLDER })}</p>
          <p className="mt-1.5 text-[12.5px] text-ink-tertiary">{t("wiki.import.zipNote")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className={`ui-button ${running ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
              <FolderUp size={15} aria-hidden="true" />
              {t("wiki.import.choose")}
              <input
                type="file"
                multiple
                className="sr-only"
                disabled={running}
                ref={(input) => input?.setAttribute("webkitdirectory", "")}
                onChange={(event) => {
                  const chosen = event.target.files;
                  setVault(chosen && chosen.length > 0 ? vaultFilesOf(chosen) : null);
                  setError(null);
                  event.target.value = "";
                }}
              />
            </label>
            {vault && counts && <p className="text-[13px]" role="status">{t("wiki.import.found", { name: vault.root || "?", notes: counts.notes, files: counts.others })}</p>}
          </div>
          {vault && counts && counts.notes === 0 && <p className="mt-2 text-[12.5px] text-danger">{t("wiki.import.noNotes")}</p>}
          {progress && (
            <div className="mt-4" role="status">
              <div className="flex items-center gap-2 text-[13px]">
                <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                {progress.phase === "finishing" ? t("wiki.import.finishing") : t("wiki.import.sending", { sent: progress.sent, total: progress.total })}
              </div>
              <progress value={progress.phase === "finishing" ? 1 : progress.total > 0 ? progress.sent / progress.total : 0} max={1} className="mt-2 h-1.5 w-full accent-[var(--color-accent)]" aria-label={t("wiki.import.title")} />
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-[13px] text-danger">{t("wiki.import.failed")} {error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={cancel} className="rounded-xl px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">{running ? t("wiki.import.cancel") : t("drive.cancel")}</button>
            <button type="button" onClick={() => void start()} disabled={!vault || running || counts?.notes === 0} className="ui-button ui-button-primary px-5">{t("wiki.import.start")}</button>
          </div>
        </>
      )}
      {outcome && (
        <>
          <p className="mt-2 text-[14px] font-medium">{t("wiki.import.done")}</p>
          <ul className="mt-3 flex flex-col gap-1 text-[13px]">
            <li>{t("wiki.import.summary.pages", outcome.summary.pages)}</li>
            <li>{t("wiki.import.summary.files", { ...outcome.summary.attachments, folder: WIKI_ATTACHMENTS_FOLDER })}</li>
            <li>{t("wiki.import.summary.links", outcome.summary.links)}</li>
          </ul>
          {outcome.hitLimit && <p role="status" className="mt-3 text-[12.5px] text-danger">{t("wiki.import.hitLimit")}</p>}
          {outcome.leftOut > 0 && <p className="mt-2 text-[12.5px] text-ink-secondary">{t("wiki.import.leftOut", { count: outcome.leftOut })}</p>}
          {outcome.summary.skippedCount > 0 && (
            <details className="mt-2 text-[12.5px] text-ink-secondary">
              <summary className="cursor-pointer">{t("wiki.import.skipped", { count: outcome.summary.skippedCount })}</summary>
              <ul className="mt-1 max-h-40 overflow-y-auto ps-4">
                {outcome.summary.skipped.map((entry) => <li key={entry.path} dir="auto" className="truncate">{entry.path}: {t(REASONS[entry.reason])}</li>)}
              </ul>
            </details>
          )}
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onClose} className="ui-button ui-button-primary px-5">{t("wiki.import.close")}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
