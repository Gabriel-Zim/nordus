import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Plus, Tag, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { BOT_TAG_AREAS, BOT_TAG_MAX, cleanBotTag, tagSearchKey, tagSuggestionRequest, type BotTagArea, type BotTagSuggestionRequest } from "../../shared/bot-tags";
import { useHeldMenuMotion } from "./MenuMotion";

/** Absent: nothing asked. "loading": Jev is on it. An empty list: Jev had nothing to offer. */
export type TagSuggestions = readonly string[] | "loading" | undefined;

export interface TagPickerChoices {
  /** The typed text as a new tag, when it is not already in the catalog. */
  typed: string | null;
  areas: BotTagArea[];
}

export function tagPickerChoices(query: string): TagPickerChoices {
  const wanted = tagSearchKey(query);
  const areas = BOT_TAG_AREAS
    .map(({ area, tags }) => ({
      area,
      tags: wanted && !tagSearchKey(area).includes(wanted) ? tags.filter((tag) => tagSearchKey(tag).includes(wanted)) : tags,
    }))
    .filter((area) => area.tags.length > 0);
  const typed = cleanBotTag(query);
  const known = areas.some((area) => area.tags.some((tag) => tagSearchKey(tag) === wanted));
  return { typed: typed && !known ? typed : null, areas };
}

export function useTagSuggestions(bot: BotTagSuggestionRequest | null, delayMs = 0): TagSuggestions {
  const decider = useStore().state.config?.decider;
  const asked = bot && decider?.enabled && decider.jobs.tagSuggest !== false ? tagSuggestionRequest(bot) : null;
  const key = asked ? JSON.stringify(asked) : "";
  const [asking, setAsking] = useState("");
  const [answer, setAnswer] = useState<{ key: string; tags: readonly string[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setAsking(key);
      void api<{ tags: string[] }>("/api/bot-tag-suggestions", { method: "POST", body: key, signal: controller.signal })
        .then((reply) => Array.isArray(reply.tags) ? reply.tags : [], () => [])
        .then((tags) => { if (!controller.signal.aborted) setAnswer({ key, tags }); });
    }, delayMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, delayMs]);
  if (!key) return undefined;
  if (answer?.key === key) return answer.tags;
  return asking === key ? "loading" : undefined;
}

const PICKER_WIDTH = 288;

export function TagPicker({ anchor, value, suggestions, onPick, onClose }: {
  anchor: { x: number; y: number } | null;
  value: string | undefined;
  suggestions: TagSuggestions;
  /** An empty string removes the tag. */
  onPick: (tag: string) => void;
  onClose: () => void;
}) {
  const motion = useHeldMenuMotion(anchor);
  const shown = motion.value;
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const heldValue = useRef(value);
  if (anchor) heldValue.current = value;
  const current = heldValue.current;

  useEffect(() => {
    if (!anchor) return;
    setQuery("");
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [anchor]);
  useEffect(() => {
    if (!anchor) return;
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-tag-picker]")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [anchor, onClose]);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !shown) return;
    const { height } = element.getBoundingClientRect();
    element.style.top = `${Math.max(8, Math.min(shown.y, window.innerHeight - height - 8))}px`;
    element.style.left = `${Math.max(8, Math.min(shown.x, window.innerWidth - PICKER_WIDTH - 8))}px`;
  });

  if (!motion.shown || !shown) return null;
  const { typed, areas } = tagPickerChoices(query);
  const jevTags = Array.isArray(suggestions) && !query.trim() ? suggestions : [];
  const pick = (tag: string) => { onPick(tag); onClose(); };
  const firstChoice = query.trim() ? areas[0]?.tags[0] ?? typed : jevTags[0];
  const moveFocus = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = [...(panel.current?.querySelectorAll<HTMLElement>("[data-tag-option]") ?? [])];
    if (!options.length) return;
    event.preventDefault();
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (at < 0) { (event.key === "ArrowDown" ? options[0] : input.current)?.focus(); return; }
    const next = at + (event.key === "ArrowDown" ? 1 : -1);
    (next < 0 ? input.current : options[Math.min(next, options.length - 1)])?.focus();
  };
  const row = (tag: string, icon?: React.ReactNode, label = tag) => (
    <button key={tag} type="button" data-tag-option="" onClick={() => pick(tag)}
      className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink outline-none focus-visible:bg-raised/70",
        tag === current ? "bg-raised" : "hover:bg-raised/70")}>
      <span className="flex min-w-0 items-center gap-2">{icon}<span className="truncate">{label}</span></span>
      {tag === current && <Check size={14} className="shrink-0 text-accent" />}
    </button>
  );
  const heading = (label: React.ReactNode, key: string) => (
    <div key={key} className="flex items-center gap-1.5 px-2.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{label}</div>
  );

  return createPortal(
    <div ref={panel} data-tag-picker="" role="dialog" aria-label={current ? t("tags.edit") : t("tags.create")} onKeyDown={moveFocus}
      style={{ top: shown.y, left: shown.x, width: PICKER_WIDTH }}
      className={cn("fixed z-[80] flex max-h-[min(440px,calc(100dvh-16px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-hairline/50 bg-menu shadow-2xl shadow-black/60", motion.className)}
      {...motion.exitProps}>
      <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{current ? t("tags.edit") : t("tags.create")}</div>
      <div className="px-2 pb-1.5">
        <input ref={input} value={query} maxLength={BOT_TAG_MAX} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && firstChoice) { event.preventDefault(); pick(firstChoice); } }}
          placeholder={t("tags.search")} aria-label={t("tags.search")}
          className="w-full rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
        {suggestions === "loading" && !query.trim() && (
          <div role="status" className="flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-ink-secondary">
            <Loader2 size={13} className="animate-spin" />{t("tags.jevThinking")}
          </div>
        )}
        {jevTags.length > 0 && <>
          {heading(t("tags.jevSuggests"), "jev")}
          {jevTags.map((tag) => row(tag))}
        </>}
        {areas.map(({ area, tags }) => [heading(area, `area:${area}`), ...tags.map((tag) => row(tag))])}
        {typed && row(typed, <Plus size={14} className="shrink-0 text-ink-secondary" />, t("tags.createTyped", { tag: typed }))}
      </div>
      {current && (
        <div className="border-t border-hairline/40 px-1.5 py-1">
          <button type="button" data-tag-option="" onClick={() => pick("")}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-danger outline-none hover:bg-raised/70 focus-visible:bg-raised/70">
            <X size={14} />{t("tags.remove")}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

const EDIT_BOT_TAG_EVENT = "nordus:edit-bot-tag";

interface BotTagAnchor { botId: string; x: number; y: number }

/** The bot menu's "Criar tag" / "Editar tag" row. It asks the mounted `BotTagPicker` to open at the menu's corner. */
export function botTagMenuItem(
  item: (icon: React.ReactNode, label: string, onClick: () => void) => React.ReactNode,
  bot: { id: string; tag?: string },
  at: { x: number; y: number },
): React.ReactNode {
  return item(<Tag size={16} className="text-ink-secondary" />, bot.tag ? t("tags.edit") : t("tags.create"), () =>
    window.dispatchEvent(new CustomEvent<BotTagAnchor>(EDIT_BOT_TAG_EVENT, { detail: { botId: bot.id, x: at.x, y: at.y } })));
}

export function BotTagPicker() {
  const { state, dispatch } = useStore();
  const [anchor, setAnchor] = useState<BotTagAnchor | null>(null);
  useEffect(() => {
    const open = (event: Event) => setAnchor((event as CustomEvent<BotTagAnchor>).detail);
    window.addEventListener(EDIT_BOT_TAG_EVENT, open);
    return () => window.removeEventListener(EDIT_BOT_TAG_EVENT, open);
  }, []);
  const held = useRef(anchor);
  if (anchor) held.current = anchor;
  const bot = held.current ? state.bots.find((candidate) => candidate.id === held.current!.botId) : undefined;
  const suggestions = useTagSuggestions(anchor && bot && !bot.tag ? bot : null);
  return <TagPicker anchor={bot ? anchor : null} value={bot?.tag} suggestions={suggestions} onClose={() => setAnchor(null)}
    onPick={(tag) => { if (bot && tag !== (bot.tag ?? "")) dispatch({ type: "updateBot", botId: bot.id, patch: { tag } }); }} />;
}
