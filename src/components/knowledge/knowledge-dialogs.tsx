import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { knowledgeErrorText } from "@/lib/knowledge-ui";

/** A centered card over a dimmed page. Escape and a click outside close it; focus goes in and comes back. */
export function Modal({ title, onClose, children, wide = false, labelledBy = "knowledge-dialog-title" }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; labelledBy?: string }) {
  const card = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = card.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-modal-close])");
    (first ?? card.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn("animate-pop-in max-h-full w-full overflow-y-auto rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl outline-none", wide ? "max-w-[34rem]" : "max-w-[26rem]")}
      >
        <h2 id={labelledBy} className="text-[15px] font-semibold text-ink">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogButtons({ confirm, onCancel, pending = false, disabled = false, danger = false, submit = true, onConfirm }: {
  confirm: string;
  onCancel: () => void;
  pending?: boolean;
  disabled?: boolean;
  danger?: boolean;
  submit?: boolean;
  onConfirm?: () => void;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onCancel} disabled={pending} className="rounded-xl px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">
        {t("drive.cancel")}
      </button>
      <button
        type={submit ? "submit" : "button"}
        onClick={submit ? undefined : onConfirm}
        disabled={pending || disabled}
        className={cn("rounded-xl px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50", danger ? "bg-danger" : "bg-accent")}
      >
        {confirm}
      </button>
    </div>
  );
}

export function ConfirmBox({ title, body, confirm, onConfirm, onCancel, pending, error }: { title: string; body: string; confirm: string; onConfirm: () => void; onCancel: () => void; pending?: boolean; error?: string | null }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="mt-2 flex items-start gap-2.5">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <p className="text-[13px] leading-relaxed text-ink-secondary">{body}</p>
      </div>
      {error && <p role="alert" className="mt-3 text-[12.5px] text-danger">{error}</p>}
      <DialogButtons confirm={confirm} onCancel={onCancel} onConfirm={onConfirm} pending={pending} danger submit={false} />
    </Modal>
  );
}

/** One line of text: a new folder's name, or where a file goes. */
export function TextBox({ title, label, initial = "", confirm, hint, onSubmit, onCancel }: {
  title: string;
  label: string;
  initial?: string;
  confirm: string;
  hint?: string;
  onSubmit: (value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (reason) {
      setError(knowledgeErrorText(reason));
      setPending(false);
    }
  };
  return (
    <Modal title={title} onClose={onCancel}>
      <form onSubmit={(event) => void submit(event)} className="mt-3">
        <label className="flex flex-col gap-1.5 text-[12.5px] text-ink-secondary">
          {label}
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            dir="auto"
            maxLength={1000}
            className="rounded-lg border border-hairline bg-control px-3 py-2 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </label>
        {hint && <p className="mt-1.5 text-[12px] text-ink-tertiary">{hint}</p>}
        {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
        <DialogButtons confirm={confirm} onCancel={onCancel} pending={pending} disabled={!value.trim()} />
      </form>
    </Modal>
  );
}
