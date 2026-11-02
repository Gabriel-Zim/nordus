import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
  type WheelEvent,
} from "react";
import { BOTTOM_FOLLOW_THRESHOLD, shouldResumeBottomFollow } from "@/lib/bottom-follow";
import { useFocusMessage } from "@/lib/focus-message";
import { resolveTranscriptWindow } from "@/lib/transcript-window";
import { reducedMotion } from "@/lib/onboarding";
import { useStore } from "@/state/store";

/** Expanding or collapsing one of these keeps the reader's line still; a menu button opens a popup, not a block. */
const DISCLOSURE_CONTROLS = "summary, [aria-expanded]:not([aria-haspopup])";

type ReadingAnchor = { element: Element; top: number; scrollTop: number };

const WIDGETS_WITH_OWN_ARROW_KEYS = '[role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="grid"], [role="tablist"], [role="radiogroup"], [role="slider"], select, [contenteditable="true"]';

export function useTranscriptViewport<T extends { id: string; role?: string }>({
  ownerId,
  threadId,
  messages,
  pinOn,
  transcriptShown = true,
  hasMore = false,
}: {
  ownerId: string;
  threadId: string;
  messages: readonly T[];
  pinOn: DependencyList;
  transcriptShown?: boolean;
  hasMore?: boolean;
}) {
  const { state, dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Follow breaks only on an upward user gesture: content growth flickers "at bottom" false for a frame.
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const previousScrollTop = useRef(0);
  const touchY = useRef(0);

  const transcriptKey = `${ownerId}:${threadId}`;
  const { visible: renderedMessages } = useMemo(() => resolveTranscriptWindow(messages), [messages]);

  const readingAnchor = useRef<ReadingAnchor | null>(null);
  const setBottomFollow = useCallback((next: boolean) => {
    if (next) readingAnchor.current = null;
    followRef.current = next;
    setFollow(next);
  }, []);

  // The only writer of scrollTop besides the reader. Each write is remembered so its scroll event is not read as theirs.
  const programmaticTop = useRef<number | null>(null);
  const markProgrammatic = (el: HTMLElement) => {
    programmaticTop.current = el.scrollTop;
    previousScrollTop.current = el.scrollTop;
  };
  const pinToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
    markProgrammatic(el);
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const transcript = transcriptRef.current;
    if (!transcriptShown || !scroller || !transcript) return;
    const observer = new ResizeObserver(() => {
      const anchor = readingAnchor.current;
      if (anchor && anchor.element.isConnected) {
        const delta = anchor.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
        markProgrammatic(scroller);
        anchor.scrollTop = scroller.scrollTop;
        const collapsed = anchor.element.matches("summary")
          ? !(anchor.element.parentElement as HTMLDetailsElement | null)?.open
          : anchor.element.getAttribute("aria-expanded") === "false";
        if (collapsed && atEnd()) setBottomFollow(true);
      } else if (followRef.current) {
        pinToEnd();
      }
    });
    // border-box: the composer's room is padding on the transcript, so its growth must count as growth.
    observer.observe(transcript, { box: "border-box" });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- atEnd reads refs only
  }, [transcriptShown, transcriptKey, pinToEnd, setBottomFollow]);

  useEffect(() => setBottomFollow(true), [transcriptKey, setBottomFollow]);

  const appliedFocus = useRef<number | null>(null);
  useEffect(() => {
    const focus = state.focusMessage;
    if (!focus || focus.consumed || focus.threadId !== threadId || appliedFocus.current === focus.nonce) return;
    if (!messages.some((message) => message.id === focus.messageId)) return;
    appliedFocus.current = focus.nonce;
    setBottomFollow(false);
  }, [threadId, messages, setBottomFollow, state.focusMessage]);
  useFocusMessage(threadId, messages.length > 0);

  // `follow` is omitted on purpose: re-arming only arms future content and never scrolls.
  // Following never coexists with a held line: holding one stops following, and following again drops it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !followRef.current) return;
    el.scrollTo({ top: el.scrollHeight });
    markProgrammatic(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinOn is the caller's dependency list
  }, [transcriptKey, messages.length, ...pinOn]);

  // Shift scrollTop by the growth after commit (scroll anchoring is off here); a switch drops the capture.
  const preExpandHeight = useRef<{ key: string; height: number } | null>(null);

  // Every dispatch captures the height; whether it restores depends on where the reader is when the page lands.
  const capturePrependHeight = () => {
    preExpandHeight.current = scrollRef.current ? { key: transcriptKey, height: scrollRef.current.scrollHeight } : null;
  };
  const oldestId = messages[0]?.id;
  const olderPending = Boolean(state.loadingOlder[threadId]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const captured = preExpandHeight.current;
    if (!captured || !el) return;
    preExpandHeight.current = olderPending && captured.key === transcriptKey ? { key: transcriptKey, height: el.scrollHeight } : null;
    if (captured.key !== transcriptKey || followRef.current) return;
    el.scrollTop += el.scrollHeight - captured.height;
    markProgrammatic(el);
  }, [oldestId, olderPending, transcriptKey]);

  const olderFailed = Boolean(state.olderFailed[threadId]);
  const loadOlder = () => {
    capturePrependHeight();
    if (!atEnd()) setBottomFollow(false);
    dispatch({ type: "loadOlderMessages", threadId });
  };

  // An open conversation pulls its own older pages, with or without a scroll gesture, until the server says it has none.
  useEffect(() => {
    if (!transcriptShown || olderPending || olderFailed || !hasMore) return;
    capturePrependHeight();
    dispatch({ type: "loadOlderMessages", threadId });
  }, [dispatch, hasMore, olderFailed, olderPending, threadId, transcriptShown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      const ownKeys = typeof (e.target as Element | null)?.closest === "function" &&
        Boolean((e.target as Element).closest(WIDGETS_WITH_OWN_ARROW_KEYS));
      if (ownKeys || !canScroll()) return;
      if (e.key === "PageUp" || ((e.key === "Home" || e.key === "ArrowUp") && !typing)) {
        setBottomFollow(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBottomFollow]);

  const canScroll = () => {
    const el = scrollRef.current;
    return Boolean(el && el.scrollHeight - el.clientHeight >= 1);
  };
  const atEnd = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_FOLLOW_THRESHOLD;
  };
  const jumpToLatest = () => {
    setBottomFollow(true);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    });
  };

  const scrollHandlers = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      // Grabbing the scrollbar is a scroll gesture: its lane lies past clientWidth.
      const el = scrollRef.current;
      if (el && e.target === el && e.nativeEvent.offsetX >= el.clientWidth) setBottomFollow(false);
    },
    onWheel: (e: WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0 && canScroll()) setBottomFollow(false);
      else if (atEnd()) setBottomFollow(true);
    },
    onTouchStart: (e: TouchEvent<HTMLDivElement>) => {
      touchY.current = e.touches[0]?.clientY ?? 0;
    },
    onTouchMove: (e: TouchEvent<HTMLDivElement>) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > touchY.current + 4 && canScroll()) setBottomFollow(false);
      else if (atEnd()) setBottomFollow(true);
    },
    onClickCapture: (e: MouseEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      const target = e.target as Element | null;
      const control = el && typeof target?.closest === "function" ? target.closest(DISCLOSURE_CONTROLS) : null;
      if (!el || !control || !el.contains(control)) return;
      readingAnchor.current = {
        element: control,
        top: control.getBoundingClientRect().top - el.getBoundingClientRect().top,
        scrollTop: el.scrollTop,
      };
      setBottomFollow(false);
    },
    onScroll: () => {
      const el = scrollRef.current;
      if (!el) return;
      const scrollTop = el.scrollTop;
      const expected = programmaticTop.current;
      programmaticTop.current = null;
      if (expected !== null && Math.abs(scrollTop - expected) <= 1) {
        previousScrollTop.current = scrollTop;
        return;
      }
      const anchor = readingAnchor.current;
      if (anchor && Math.abs(scrollTop - anchor.scrollTop) > 2) readingAnchor.current = null;
      if (readingAnchor.current) return;
      const resume = shouldResumeBottomFollow({
        following: followRef.current,
        previousScrollTop: previousScrollTop.current,
        scrollTop,
        distanceFromBottom: el.scrollHeight - scrollTop - el.clientHeight,
      });
      previousScrollTop.current = scrollTop;
      if (resume) setBottomFollow(true);
    },
  };

  return {
    scrollRef,
    transcriptRef,
    transcriptKey,
    following: follow,
    renderedMessages,
    olderPending,
    olderFailed,
    loadOlder,
    jumpToLatest,
    scrollHandlers,
  };
}
