import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { commonModelPrefix, filterModels, type PickerModel } from "@/lib/account-moves";

interface Props {
  /** "" is the rule's own choice. */
  value: string;
  onChange: (value: string) => void;
  models: PickerModel[];
  /** What the rule would pick, shown in parentheses on the first option. */
  ruleHint: string;
  ariaLabel: string;
  disabled?: boolean;
}

const WIDE = "(min-width: 640px)";

/**
 * A model chooser with a search box: the whole id is always shown (it wraps, never ellipsis), a friendly name sits
 * above the id when the catalog has one, and a provider prefix common to every model is written once in a group header.
 * A phone gets a bottom sheet; a wider screen gets a panel above the field.
 */
export function ModelSearchPicker({ value, onChange, models, ruleHint, ariaLabel, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const prefix = useMemo(() => commonModelPrefix(models.map((model) => model.id)), [models]);
  const shown = useMemo(() => filterModels(models, query), [models, query]);
  // Row 0 is the rule while nothing is typed.
  const rows = useMemo(() => [...(query.trim() ? [] : [{ id: "" }]), ...shown], [query, shown]);
  const firstModel = rows.findIndex((row) => row.id !== "");
  const rule = `${t("accounts.bar.modelRule")}${ruleHint ? ` (${ruleHint})` : ""}`;

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const openPanel = () => {
    if (disabled) return;
    const rect = trigger.current?.getBoundingClientRect();
    const wide = typeof window.matchMedia === "function" ? window.matchMedia(WIDE).matches : true;
    if (wide && rect) {
      const width = Math.max(420, rect.width);
      setBox({
        position: "fixed",
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 4,
        width,
        maxHeight: Math.max(240, Math.min(window.innerHeight * 0.6, rect.top - 16)),
      });
    } else {
      setBox(null);
    }
    setQuery("");
    const index = rows.findIndex((row) => row.id === value);
    setActive(Math.max(0, index));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (id: string) => {
    onChange(id);
    close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      // Only a model the catalog offers is ever chosen.
      if (row) choose(row.id);
    }
  };

  const text = (id: string) => {
    const model = models.find((candidate) => candidate.id === id);
    return { id, name: model?.name, rest: prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id };
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-model-picker=""
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={openPanel}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[3px] border border-hairline/40 bg-inset px-3 py-1.5 text-left text-[13px] leading-snug text-ink hover:border-hairline/70 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8"
      >
        <span data-model-picker-value="" className="min-w-0 whitespace-normal break-all">{value || rule}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-secondary" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[90]" data-model-picker-layer="">
          <div className="absolute inset-0 bg-black/40 sm:bg-transparent" onClick={close} />
          <div
            data-model-picker-panel=""
            style={box ?? undefined}
            className={cn(
              "flex flex-col overflow-hidden rounded-[3px] border border-hairline/50 bg-raised/95 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl",
              !box && "absolute inset-x-0 bottom-0 top-[10%] rounded-b-none",
            )}
          >
            <div className="flex items-center gap-2 border-b border-hairline/30 px-3">
              <Search size={14} className="shrink-0 text-ink-secondary" />
              <input
                ref={input}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
                aria-label={t("accounts.picker.search")}
                placeholder={t("accounts.picker.search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKey}
                className="min-h-12 w-full bg-transparent text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none sm:min-h-10 sm:text-[13px]"
              />
              <button type="button" className="ui-button ui-button-sm min-h-9 shrink-0 rounded-[3px] sm:hidden" onClick={close}>
                {t("accounts.picker.close")}
              </button>
            </div>
            <div id={listId} role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto py-1">
              {rows.length === 0 && (
                <div role="status" data-picker-empty="" className="px-3 py-4 text-[13px] text-ink-secondary">{t("accounts.picker.noMatch")}</div>
              )}
              {rows.map((row, index) => {
                const label = row.id ? text(row.id) : null;
                return (
                  <Fragment key={row.id || "rule"}>
                  {prefix && row.id && index === firstModel && (
                    <div data-picker-group="" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-secondary">{prefix}</div>
                  )}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    data-model-option={row.id || "rule"}
                    aria-selected={row.id === value}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(row.id)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 sm:min-h-8",
                      index === active && "bg-control",
                    )}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal break-words">
                      {label ? (
                        <>
                          {label.name && label.name !== label.id && <span data-option-name="" className="block text-[14px] text-ink sm:text-[13px]">{label.name}</span>}
                          <span data-option-id="" className={cn("block break-all", label.name && label.name !== label.id ? "text-[11px] text-ink-secondary" : "text-[14px] text-ink sm:text-[13px]")}>{label.rest}</span>
                        </>
                      ) : (
                        <span className="block text-[14px] text-ink sm:text-[13px]">{rule}</span>
                      )}
                    </span>
                    {row.id === value && <Check size={14} className="shrink-0 text-accent" />}
                  </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
