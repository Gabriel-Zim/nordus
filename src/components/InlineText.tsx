import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** Text that edits in place: a pencil on hover, Enter saves, Esc cancels. */
export function InlineText({ id, value, label, placeholder, maxLength, className, startEditing = false, onSave }: {
  id?: string; value: string; label: string; placeholder?: string; maxLength?: number; className?: string; startEditing?: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) requestAnimationFrame(() => input.current?.select()); }, [editing]);
  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };
  if (editing) {
    return (
      <input
        ref={input}
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commit(); }
          if (event.key === "Escape") { event.preventDefault(); setDraft(value); setEditing(false); }
        }}
        className={cn("w-full max-w-[16rem] rounded-lg border border-white/12 bg-white/[0.05] px-2 py-0.5 text-center focus:border-accent-border focus:outline-none", className)}
      />
    );
  }
  return (
    <button type="button" data-inline-edit={label} onClick={start} aria-label={`${t("botSettings.simple.edit")}: ${label}`}
      className="group/inline relative flex max-w-full items-center gap-1.5 rounded-md px-1">
      <span id={id} className={cn("min-w-0 truncate", className, !value && "text-ink-tertiary")}>{value || placeholder}</span>
      <Pencil size={12} aria-hidden="true" className="shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover/inline:opacity-100 group-focus-within/inline:opacity-100 touch:opacity-100" />
    </button>
  );
}
