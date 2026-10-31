import { useContext, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, HardDrive, LoaderCircle } from "lucide-react";

import { uploadToDrive } from "@/lib/knowledge-api";
import { isKnowledgeCode, knowledgeErrorText, rememberSpace } from "@/lib/knowledge-ui";
import { t } from "@/lib/i18n";
import { StoreContext } from "@/state/store";
import { requestMessageFile, type MessageAttachmentContext } from "./AttachmentPreview";

type Saved = { state: "idle" } | { state: "saving" } | { state: "saved"; path: string; same: boolean } | { state: "failed"; reason: string };

function failureText(reason: unknown): string {
  if (isKnowledgeCode(reason, "no_space")) return t("drive.saveToDrive.noSpace");
  return reason instanceof Error && !("status" in reason) ? reason.message : knowledgeErrorText(reason);
}

/** "Salvar no Drive" beside a file in the chat: the browser says only which conversation it is, and the server decides the space it belongs to. */
export function SaveToDriveButton({ path, name, message }: { path: string; name: string; message: MessageAttachmentContext }) {
  const store = useContext(StoreContext);
  const [result, setResult] = useState<Saved>({ state: "idle" });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const save = async () => {
    if (result.state === "saving") return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setResult({ state: "saving" });
    try {
      const response = await requestMessageFile(path, message, controller.signal);
      const bytes = await response.blob();
      const target = `${t("drive.chatFolder")}/${name.replace(/[\\/]/g, "_")}`;
      const saved = await uploadToDrive({ conversation: message.threadId }, target, bytes, { signal: controller.signal });
      rememberSpace(saved.space);
      setResult({ state: "saved", path: saved.file.path, same: saved.outcome === "unchanged" });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setResult({ state: "failed", reason: failureText(reason) });
    }
  };

  const label = t("drive.saveToDrive.aria", { name });
  if (result.state === "saved") {
    const text = t(result.same ? "drive.saveToDrive.same" : "drive.saveToDrive.saved", { path: result.path });
    return (
      <>
        <button type="button" className="table-action text-success" title={text} aria-label={t("drive.saveToDrive.open")} onClick={() => store?.dispatch({ type: "showDrive" })}><Check size={14} /></button>
        <span role="status" className="sr-only">{text}</span>
      </>
    );
  }
  if (result.state === "failed") {
    return (
      <>
        <button type="button" className="table-action text-danger" title={result.reason} aria-label={label} onClick={() => void save()}><CircleAlert size={14} /></button>
        <span role="alert" className="sr-only">{result.reason}</span>
      </>
    );
  }
  return (
    <button type="button" className="table-action" title={t("drive.saveToDrive")} aria-label={label} disabled={result.state === "saving"} onClick={() => void save()}>
      {result.state === "saving" ? <LoaderCircle size={14} className="animate-spin" /> : <HardDrive size={14} />}
    </button>
  );
}
