import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { toolDoneLabel } from "@/lib/tool-step-label";
import type { Message } from "@/state/store";

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** What a turn did, in plain words and in the past ("Abri uma página"); empty when the bot only talked.
 *  Cost and tokens never reach the chat; they live under Uso in the profile menu. */
export function whatItDidLines(digestMessage: Message | undefined): string[] {
  const digest = digestMessage?.digest;
  if (!digest) return [];
  const byLabel = new Map<string, { name: string; count: number; failed: number }>();
  for (const tool of digest.tools) {
    const key = toolDoneLabel(tool.name);
    if (!key) continue;
    const entry = byLabel.get(key) ?? { name: tool.name, count: 0, failed: 0 };
    entry.count += tool.count;
    entry.failed += tool.failed;
    byLabel.set(key, entry);
  }
  // A step that failed and was then done another way is not news: only a step that never worked says so.
  const lines = [...byLabel.values()].map(({ name, count, failed }) => {
    const done = count - failed;
    const label = toolDoneLabel(name, Math.max(done, 1)) ?? "";
    return done > 0 ? label : `${label} (${t("whatItDid.someFailed")})`;
  });
  const files = digest.files ? [...digest.files.added, ...digest.files.changed, ...digest.files.deleted] : [];
  if (files.length > 0) lines.push(t("whatItDid.filesList", { files: files.slice(0, 4).map(fileName).join(", ") + (files.length > 4 ? "…" : "") }));
  if (digest.memory.length > 0) lines.push(t("whatItDid.memoryPlain"));
  return lines;
}

const OPEN_WHAT_IT_DID = "nordus:what-it-did";

/** Nothing sits under the bubbles: the "⋯" menu opens these steps in a side panel. */
type Shown = { name: string; lines: string[]; save?: () => void };

export function openWhatItDid(name: string, lines: string[], save?: () => void) {
  window.dispatchEvent(new CustomEvent<Shown>(OPEN_WHAT_IT_DID, { detail: { name, lines, ...(save ? { save } : {}) } }));
}

export function WhatItDidPanel() {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    const open = (event: Event) => setShown((event as CustomEvent<Shown>).detail);
    window.addEventListener(OPEN_WHAT_IT_DID, open);
    return () => window.removeEventListener(OPEN_WHAT_IT_DID, open);
  }, []);
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setShown(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);
  if (!shown) return null;
  return createPortal(
    <aside
      data-what-it-did-panel=""
      aria-label={t("whatItDid.panelTitle", { name: shown.name })}
      className="animate-panel-in fixed inset-y-0 right-0 z-40 flex w-[360px] max-w-full flex-col border-l border-ink/10 bg-[color-mix(in_srgb,var(--color-panel)_88%,transparent)]"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold text-ink">{t("whatItDid.panelTitle", { name: shown.name })}</span>
        <button type="button" onClick={() => setShown(null)} aria-label={t("whatItDid.close")} title={t("whatItDid.close")} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink">
          <X size={18} />
        </button>
      </div>
      <ul className="grid gap-2 overflow-y-auto px-4 pb-4 text-[14px] text-ink-secondary">
        {shown.lines.map((line) => (
          <li key={line} className="rounded-[10px] bg-ink/[0.04] px-3 py-2">{line}</li>
        ))}
      </ul>
      {shown.save && (
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => { shown.save?.(); setShown(null); }}
            className="flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] text-ink-secondary hover:bg-ink/[0.06] hover:text-ink"
          >
            <BookmarkPlus size={13} aria-hidden="true" />
            {t("chat.verify.save")}
          </button>
        </div>
      )}
    </aside>,
    document.body,
  );
}

/** Each turn's digest lands after its bot's last reply (in a room, several bots interleave): that reply's "⋯" menu
 *  is where its steps open. */
export function digestsByReply(messages: readonly Message[]): Map<string, Message> {
  const byReply = new Map<string, Message>();
  const lastReply = new Map<string | undefined, string>();
  for (const message of messages) {
    if (message.kind === "text" && message.role === "user") lastReply.clear();
    else if (message.kind === "text") lastReply.set(message.from?.botId, message.id);
    else if (message.kind === "digest") {
      const owner = message.digest?.botId;
      const key = lastReply.has(owner) ? owner : undefined;
      const reply = lastReply.get(key);
      if (!reply) continue;
      byReply.set(reply, message);
      lastReply.delete(key);
    }
  }
  return byReply;
}
