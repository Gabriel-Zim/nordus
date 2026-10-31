import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { safeAreaInsets } from "@/lib/safe-area";

const VARIANTS = {
  field: "rounded-lg border border-hairline/40 bg-inset text-ink hover:border-hairline/70",
  pill: "h-8 rounded-full border border-hairline/40 bg-raised/60 font-medium text-ink hover:bg-raised",
  /** Only the `icon` shows; the call site's wrapper draws the hit area. */
  icon: "flex items-center justify-center text-inherit",
} as const;

// The 14px chevron draws its stroke ~3.5px inside its box, so the box sits that much nearer the edge than the text's padding.
const SIZES = {
  lg: { select: "py-2.5 pl-3 pr-9 text-[15px]", chevron: "right-2", item: "text-[14px]" },
  md: { select: "py-2 pl-3 pr-9 text-[13px]", chevron: "right-2", item: "text-[13px]" },
  sm: { select: "py-1.5 pl-2.5 pr-8 text-[12.5px]", chevron: "right-1.5", item: "text-[13px]" },
} as const;

type Item = { kind: "option"; value: string; label: string; description?: string; disabled: boolean; group?: string } | { kind: "group"; label: string };

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The `<option>`s and `<optgroup>`s a call site passes, flattened through fragments and arrays. */
function readItems(children: ReactNode, group?: string, out: Item[] = []): Item[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    const props = child.props;
    if (child.type === Fragment) {
      readItems(props.children as ReactNode, group, out);
    } else if (child.type === "optgroup") {
      const label = String(props.label ?? "");
      if (label) out.push({ kind: "group", label });
      readItems(props.children as ReactNode, label, out);
    } else if (child.type === "option") {
      if (props.hidden) return;
      const label = textOf(props.children as ReactNode);
      const value = props.value === undefined ? label : String(props.value);
      const description = typeof props["data-description"] === "string" ? props["data-description"] : undefined;
      out.push({ kind: "option", value, label, description, disabled: Boolean(props.disabled), group });
    }
  });
  return out;
}

type Placement = { top: number; left: number; width: number; maxHeight: number; up: boolean };

const GAP = 6;
const EDGE = 8;

function place(trigger: HTMLElement, menu: HTMLElement | null, wide: boolean): Placement {
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Clear of the clock, the home indicator and a landscape notch, not only of the window's edge.
  const inset = safeAreaInsets();
  const edge = { top: EDGE + inset.top, right: EDGE + inset.right, bottom: EDGE + inset.bottom, left: EDGE + inset.left };
  const width = Math.min(Math.max(rect.width, wide ? 280 : 220), vw - edge.left - edge.right);
  const left = Math.min(Math.max(edge.left, rect.left), vw - width - edge.right);
  const natural = menu?.scrollHeight ?? 320;
  const below = vh - rect.bottom - GAP - edge.bottom;
  const above = rect.top - GAP - edge.top;
  const up = natural > below && above > below;
  const maxHeight = Math.max(120, Math.min(420, up ? above : below));
  const top = up ? Math.max(edge.top, rect.top - GAP - Math.min(natural, maxHeight)) : rect.bottom + GAP;
  return { top, left, width, maxHeight, up };
}

const SEALED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "touchstart", "touchend"] as const;
let layer: HTMLElement | null = null;

/**
 * The lists open in one layer on <body>, so a popup or glass panel around the
 * trigger never clips them. The layer lets React handle a press first, then
 * stops it there: the menus around the trigger, which close on a press that
 * reaches the document or window outside them, never see it.
 */
function selectLayer(): HTMLElement {
  if (layer?.isConnected) return layer;
  layer = document.createElement("div");
  layer.dataset.nordusSelectLayer = "";
  document.body.appendChild(layer);
  return layer;
}
let sealed = false;
function sealLayer(target: HTMLElement): void {
  if (sealed) return;
  sealed = true;
  for (const type of SEALED) target.addEventListener(type, (event) => event.stopPropagation());
}

/**
 * The Nordus dropdown: a pill or field trigger and a dark glass list with
 * group titles, optional one-line descriptions and the accent check. It reads
 * the same `<option>` / `<optgroup>` children a native select takes; give an
 * option `data-description` for its grey line. A hidden native select keeps
 * the value and fires the real change event, so call sites keep reading
 * `event.target.value`; it never opens.
 */
export function Select({
  className,
  variant = "field",
  size = "md",
  children,
  value,
  defaultValue,
  disabled,
  onChange,
  id,
  title,
  style,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-labelledby": ariaLabelledBy,
  placeholder,
  icon,
  triggerClassName,
  ...rest
}: Omit<ComponentProps<"select">, "size"> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  /** Shown, in the tertiary ink, while no option matches the value. */
  placeholder?: string;
  /** The trigger's content for `variant="icon"`. */
  icon?: ReactNode;
  /** A kit with its own field look (bot-built widgets) styles the trigger itself. */
  triggerClassName?: string;
}) {
  // data-* hooks and aria-invalid belong to what people focus; the hidden select keeps value, name and required.
  const triggerData = Object.fromEntries(Object.entries(rest).filter(([key]) => key.startsWith("data-") || key === "aria-invalid"));
  const nativeProps = Object.fromEntries(Object.entries(rest).filter(([key]) => !(key.startsWith("data-") || key === "aria-invalid")));
  const items = useMemo(() => readItems(children), [children]);
  const options = useMemo(() => items.filter((item): item is Extract<Item, { kind: "option" }> => item.kind === "option"), [items]);
  const [inner, setInner] = useState(() => String(defaultValue ?? options[0]?.value ?? ""));
  const current = value === undefined ? inner : String(value);
  const selected = options.find((option) => option.value === current) ?? (value === undefined ? options[0] : undefined);
  const wide = options.some((option) => option.description);
  const shown = selected ?? (placeholder === undefined ? options[0] : undefined);
  const bare = variant === "icon";

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const enabled = useCallback((index: number) => index >= 0 && index < options.length && !options[index]!.disabled, [options]);
  const step = useCallback((from: number, delta: number) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + delta * i + options.length * 4) % options.length;
      if (enabled(next)) return next;
    }
    return from;
  }, [enabled, options.length]);

  const show = useCallback(() => {
    if (disabled || options.length === 0) return;
    const at = options.findIndex((option) => option.value === current);
    setActive(enabled(at) ? at : step(-1, 1));
    setOpen(true);
  }, [current, disabled, enabled, options, step]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPlacement(null);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const choose = useCallback((index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close(true);
    if (option.value === current) return;
    if (value === undefined) setInner(option.value);
    const native = nativeRef.current;
    if (native) {
      native.value = option.value;
      native.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, [close, current, options, value]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    setPlacement(place(triggerRef.current, menuRef.current, wide));
  }, [open, items, wide]);

  useEffect(() => {
    if (!open) return;
    // After React's own listener on the layer, so React still sees each press.
    if (layer && menuRef.current?.parentElement === layer) sealLayer(layer);
    menuRef.current?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const reflow = (event: Event) => {
      if (event.type === "scroll" && menuRef.current?.contains(event.target as Node)) return;
      const trigger = triggerRef.current;
      if (!trigger) return;
      // Follow the trigger while the page scrolls; let go once it leaves the screen.
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0) close(false);
      else setPlacement(place(trigger, menuRef.current, wide));
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [close, open, wide]);

  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const typeahead = (key: string) => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at > 600 ? "" : typed.current.text) + key.toLowerCase(), at: now };
    const query = typed.current.text;
    const start = query.length === 1 ? active + 1 : active;
    for (let i = 0; i < options.length; i++) {
      const index = (Math.max(0, start) + i) % options.length;
      if (enabled(index) && options[index]!.label.toLowerCase().startsWith(query)) return index;
    }
    return -1;
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((index) => step(index, 1)),
      ArrowUp: () => setActive((index) => step(index < 0 ? options.length : index, -1)),
      Home: () => setActive(step(-1, 1)),
      End: () => setActive(step(options.length, -1)),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: () => close(true),
      Tab: () => close(true),
    };
    const run = keys[event.key];
    if (run) {
      event.preventDefault();
      event.stopPropagation();
      run();
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const index = typeahead(event.key);
      if (index >= 0) setActive(index);
    }
  };

  // Focus can stay on the trigger (a popup around it may hold it), so an open list also listens here.
  const onTriggerKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open) {
      onMenuKey(event);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      show();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const index = typeahead(event.key);
      if (index >= 0) {
        event.preventDefault();
        choose(index);
      }
    }
  };

  // A modal <dialog> sits in the top layer, above <body>; its lists open inside it.
  const portalTarget = !open || typeof document === "undefined" ? null : (triggerRef.current?.closest("dialog[open]") as HTMLElement | null) ?? selectLayer();
  const menuStyle: CSSProperties = placement
    ? { top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }
    : { top: -9999, left: -9999, visibility: "hidden" };

  return (
    <div className={cn("relative inline-flex min-w-0", className)} style={style}>
      <select
        {...nativeProps}
        ref={nativeRef}
        aria-label={ariaLabel}
        value={value === undefined ? inner : value}
        onChange={(event) => {
          if (value === undefined) setInner(event.target.value);
          onChange?.(event);
        }}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        hidden
      >
        {children}
      </select>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        {...triggerData}
        value={current}
        data-nordus-select=""
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onTriggerKey}
        className={triggerClassName ? cn("peer cursor-pointer text-left outline-none", triggerClassName, !shown && "text-ink-tertiary") : cn(
          "peer w-full min-w-0 cursor-pointer truncate text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus/50 disabled:cursor-default disabled:opacity-50",
          VARIANTS[variant],
          !bare && SIZES[size].select,
          open && "border-hairline/80",
          !shown && "text-ink-tertiary",
        )}
      >
        {bare ? icon : shown?.label ?? placeholder ?? "\u00a0"}
      </button>
      {!bare && !triggerClassName && <ChevronDown
        size={14}
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-secondary transition-transform duration-100 peer-disabled:opacity-50",
          SIZES[size].chevron,
          open && "rotate-180",
        )}
      />}
      {open && portalTarget && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onKeyDown={onMenuKey}
          data-nordus-select-menu=""
          data-up={placement?.up ? "" : undefined}
          className="nordus-select-menu fixed z-[1000] overflow-y-auto overscroll-contain p-1.5 outline-none"
          style={menuStyle}
        >
          {items.map((item, position) => {
            if (item.kind === "group") {
              return (
                <div key={`g-${position}`} role="presentation" className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary first:pt-1.5">
                  {item.label}
                </div>
              );
            }
            const index = options.indexOf(item);
            const isSelected = item.value === current;
            return (
              <div
                key={`o-${item.value}-${position}`}
                id={`${listId}-${index}`}
                role="option"
                data-index={index}
                aria-selected={isSelected}
                aria-disabled={item.disabled || undefined}
                onPointerMove={() => !item.disabled && index !== active && setActive(index)}
                onClick={() => choose(index)}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-ink transition-colors duration-75",
                  SIZES[size].item,
                  index === active && "bg-ink/[0.07]",
                  item.disabled && "cursor-default opacity-40",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate leading-5", isSelected && "font-medium")}>{item.label}</span>
                  {item.description && <span className="mt-0.5 block text-[11.5px] leading-4 text-ink-secondary">{item.description}</span>}
                </span>
                <Check size={15} strokeWidth={2.5} aria-hidden="true" className={cn("mt-0.5 shrink-0 text-accent-text", !isSelected && "invisible")} />
              </div>
            );
          })}
        </div>,
        portalTarget,
      )}
    </div>
  );
}
