// Runs against a small stand-in for React's hooks (no DOM) and a scroller whose height is its mounted row count.
import type { DependencyList } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const react = vi.hoisted(() => {
  type Committed = { deps?: DependencyList; cleanup?: void | (() => void) };
  type Pending = { slot: number; layout: boolean; deps?: DependencyList; run: () => void | (() => void) };
  const runtime = { slots: [] as unknown[], cursor: 0, dirty: false, pending: [] as Pending[] };
  const same = (a?: DependencyList, b?: DependencyList) =>
    Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
  const effect = (layout: boolean) => (run: () => void | (() => void), deps?: DependencyList) => {
    const slot = runtime.cursor++;
    if (same((runtime.slots[slot] as Committed | undefined)?.deps, deps)) return;
    runtime.pending.push({ slot, layout, deps, run });
  };
  const memo = <T,>(factory: () => T, deps: DependencyList): T => {
    const slot = runtime.cursor++;
    const held = runtime.slots[slot] as { value: T; deps: DependencyList } | undefined;
    if (held && same(held.deps, deps)) return held.value;
    const value = factory();
    runtime.slots[slot] = { value, deps };
    return value;
  };
  const hooks = {
    useState<T>(initial: T | (() => T)) {
      const slot = runtime.cursor++;
      if (!runtime.slots[slot]) {
        const cell = {
          value: typeof initial === "function" ? (initial as () => T)() : initial,
          set: (next: T | ((current: T) => T)) => {
            const value = typeof next === "function" ? (next as (current: T) => T)(cell.value) : next;
            if (Object.is(value, cell.value)) return;
            cell.value = value;
            runtime.dirty = true;
          },
        };
        runtime.slots[slot] = cell;
      }
      const cell = runtime.slots[slot] as { value: T; set: (next: T | ((current: T) => T)) => void };
      return [cell.value, cell.set] as const;
    },
    useRef<T>(initial: T) {
      const slot = runtime.cursor++;
      return (runtime.slots[slot] ??= { current: initial }) as { current: T };
    },
    useMemo: memo,
    useCallback: <T,>(callback: T, deps: DependencyList) => memo(() => callback, deps),
    useEffect: effect(false),
    useLayoutEffect: effect(true),
  };
  /** A render-phase update re-renders before committing, as React does; layout effects run before passive ones. */
  function render(draw: () => void, commit: () => void) {
    for (let pass = 0; pass < 20; pass++) {
      runtime.cursor = 0;
      runtime.dirty = false;
      runtime.pending = [];
      draw();
      if (runtime.dirty) continue;
      commit();
      const pending = [...runtime.pending.filter((e) => e.layout), ...runtime.pending.filter((e) => !e.layout)];
      for (const { slot, deps, run } of pending) {
        (runtime.slots[slot] as Committed | undefined)?.cleanup?.();
        runtime.slots[slot] = { deps, cleanup: run() };
      }
      if (!runtime.dirty) return;
    }
    throw new Error("render did not settle");
  }
  return { runtime, hooks, render };
});
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), ...react.hooks }));

const store = vi.hoisted(() => ({
  state: {
    focusMessage: null as null | { threadId: string; messageId: string; nonce: number; consumed: boolean },
    loadingOlder: {} as Record<string, true>,
    olderFailed: {} as Record<string, true>,
  },
  dispatch: (() => {}) as (action: unknown) => void,
}));
vi.mock("@/state/store", () => ({ useStore: () => store }));
// Scrolling a hit into view needs the real DOM; this suite checks the window around it.
vi.mock("@/lib/focus-message", () => ({ useFocusMessage: () => {} }));

import { useTranscriptViewport } from "./use-transcript-viewport";

type Row = { id: string; role?: "user" | "bot" };
const rows = (count: number, from = 0): Row[] => Array.from({ length: count }, (_, index) => ({ id: `m${from + index}` }));

const ROW = 50;
class Scroller {
  rows = 0;
  extra = 0;
  scrollTop = 0;
  clientHeight = 400;
  clientWidth = 400;
  calls: ScrollToOptions[] = [];
  get scrollHeight() {
    return this.rows * ROW + this.extra;
  }
  get bottom() {
    return Math.max(0, this.scrollHeight - this.clientHeight);
  }
  getBoundingClientRect() {
    return { top: 0 } as DOMRect;
  }
  contains() {
    return true;
  }
  scrollTo(options: ScrollToOptions) {
    this.calls.push(options);
    this.scrollTop = Math.max(0, Math.min(options.top ?? this.scrollTop, this.bottom));
  }
}

type Props = Parameters<typeof useTranscriptViewport<Row>>[0];
let scroller: Scroller;
let frames: FrameRequestCallback[];
let keyListeners: Set<(event: Partial<KeyboardEvent>) => void>;
let observers: number;
let resizeObservers: Array<{ callback: ResizeObserverCallback; disconnected: boolean }>;
let dispatched: unknown[];

function mount(initial: Partial<Props> = {}) {
  let props: Props = { ownerId: "bot", threadId: "thread", messages: rows(10), pinOn: [false], ...initial };
  let result!: ReturnType<typeof useTranscriptViewport<Row>>;
  const draw = () => {
    result = useTranscriptViewport(props);
  };
  // React's commit before layout effects; a browser clamps scrollTop when content gets shorter.
  const commit = () => {
    result.scrollRef.current = scroller as unknown as HTMLDivElement;
    result.transcriptRef.current = {} as HTMLDivElement;
    scroller.rows = result.renderedMessages.length;
    scroller.scrollTop = Math.min(scroller.scrollTop, scroller.bottom);
  };
  const flushFrames = () => {
    const queued = frames;
    frames = [];
    for (const frame of queued) frame(0);
  };
  react.render(draw, commit);
  return {
    get current() {
      return result;
    },
    rerender(next: Partial<Props>) {
      props = { ...props, ...next };
      react.render(draw, commit);
    },
    act(handler: () => void) {
      handler();
      react.render(draw, commit);
      flushFrames();
    },
    unmount() {
      for (const slot of react.runtime.slots as Array<{ cleanup?: () => void }>) slot.cleanup?.();
      react.runtime.slots = [];
    },
  };
}

beforeEach(() => {
  react.runtime.slots = [];
  scroller = new Scroller();
  frames = [];
  keyListeners = new Set();
  observers = 0;
  resizeObservers = [];
  dispatched = [];
  store.state.focusMessage = null;
  store.state.loadingOlder = {};
  store.state.olderFailed = {};
  store.dispatch = (action) => dispatched.push(action);
  vi.stubGlobal("window", {
    addEventListener: (_: string, listener: (event: Partial<KeyboardEvent>) => void) => keyListeners.add(listener),
    removeEventListener: (_: string, listener: (event: Partial<KeyboardEvent>) => void) => keyListeners.delete(listener),
  });
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal("ResizeObserver", class {
    disconnected = false;
    constructor(readonly callback: ResizeObserverCallback) {
      observers++;
      resizeObservers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  });
  vi.stubGlobal("IntersectionObserver", class {
    constructor() {}
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("HTMLTextAreaElement", class {});
  vi.stubGlobal("HTMLInputElement", class {});
  return () => vi.unstubAllGlobals();
});

const press = (key: string, target: unknown = {}) => {
  for (const listener of keyListeners) listener({ key, target } as unknown as KeyboardEvent);
};
const resize = () => {
  for (const observer of resizeObservers) observer.callback([], observer as unknown as ResizeObserver);
};

describe("transcript viewport", () => {
  it("follows new rows to the bottom until the reader scrolls up", () => {
    const view = mount({ messages: rows(10) });
    expect(view.current.following).toBe(true);
    expect(scroller.scrollTop).toBe(scroller.bottom);

    view.rerender({ messages: rows(11) });
    expect(scroller.scrollTop).toBe(11 * ROW - 400);

    scroller.extra = 80;
    view.rerender({ pinOn: [true] });
    expect(scroller.scrollTop).toBe(11 * ROW + 80 - 400);

    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    expect(view.current.following).toBe(false);
    const reading = scroller.scrollTop;
    view.rerender({ messages: rows(12) });
    expect(scroller.scrollTop).toBe(reading);
  });

  it("treats scrollbar grabs, scroll keys and a dragging finger as leaving the bottom", () => {
    const view = mount({ messages: rows(30) });
    view.act(() =>
      view.current.scrollHandlers.onPointerDown({ target: scroller, nativeEvent: { offsetX: 404 } } as never),
    );
    expect(view.current.following).toBe(false);

    view.act(() => {
      scroller.scrollTop = 200;
      view.current.scrollHandlers.onScroll();
    });
    expect(view.current.following).toBe(false);
    view.act(() => {
      scroller.scrollTop = scroller.bottom;
      view.current.scrollHandlers.onScroll();
    });
    expect(view.current.following).toBe(true);

    view.act(() => press("ArrowUp", new HTMLTextAreaElement()));
    expect(view.current.following).toBe(true);
    view.act(() => press("PageUp"));
    expect(view.current.following).toBe(false);

    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: 30 } as never));
    expect(view.current.following).toBe(true);
    view.act(() => view.current.scrollHandlers.onTouchStart({ touches: [{ clientY: 100 }] } as never));
    view.act(() => view.current.scrollHandlers.onTouchMove({ touches: [{ clientY: 110 }] } as never));
    expect(view.current.following).toBe(false);
  });

  it("renders the whole thread and re-arms on another thread", () => {
    const view = mount({ messages: rows(300) });
    expect(view.current.renderedMessages).toHaveLength(300);
    expect(view.current.renderedMessages[0]?.id).toBe("m0");

    view.rerender({ threadId: "other", messages: [{ id: "ask", role: "user" }, ...rows(299, 1_001)] });
    expect(view.current.transcriptKey).toBe("bot:other");
    expect(view.current.renderedMessages).toHaveLength(300);
    expect(view.current.renderedMessages[0]?.id).toBe("ask");
  });

  it("keeps every earlier row mounted while the reader follows new rows", () => {
    const view = mount({ messages: rows(300) });
    for (let total = 301; total <= 900; total++) {
      view.rerender({ messages: rows(total) });
      expect(view.current.renderedMessages).toHaveLength(total);
      expect(scroller.scrollTop).toBe(scroller.bottom);
    }
    expect(view.current.renderedMessages[0]?.id).toBe("m0");
    expect(view.current.renderedMessages.at(-1)?.id).toBe("m899");
  });

  it("keeps the person's newest message mounted while a long turn follows it", () => {
    let thread: Row[] = [...rows(30), { id: "ask", role: "user" }];
    const view = mount({ messages: thread });
    for (let step = 0; step < 150; step++) {
      thread = [...thread, { id: `step${step}`, role: "bot" }];
      view.rerender({ messages: thread });
      expect(view.current.renderedMessages.map((row) => row.id)).toContain("ask");
      expect(scroller.scrollTop).toBe(scroller.bottom);
    }
    expect(view.current.renderedMessages[0]?.id).toBe("m0");
    expect(view.current.renderedMessages).toHaveLength(181);

    view.rerender({ messages: [...thread, { id: "ask2", role: "user" }] });
    expect(view.current.renderedMessages).toHaveLength(182);
    expect(view.current.renderedMessages.at(-1)?.id).toBe("ask2");
  });

  it("keeps the person's newest message mounted when many steps arrive at once", () => {
    const asked: Row[] = [...rows(30), { id: "ask", role: "user" }];
    const view = mount({ messages: asked });
    view.rerender({ messages: [...asked, ...rows(150, 100)] });
    expect(view.current.renderedMessages[0]?.id).toBe("m0");
    expect(view.current.renderedMessages).toHaveLength(181);
    expect(scroller.scrollTop).toBe(scroller.bottom);
  });

  it("holds the reader's rows and their scroll position once they have scrolled away", () => {
    const view = mount({ messages: rows(300) });
    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    scroller.scrollTop = 2_000;
    for (let total = 301; total <= 900; total++) view.rerender({ messages: rows(total) });
    expect(view.current.renderedMessages).toHaveLength(900);
    expect(scroller.scrollTop).toBe(2_000);
  });

  it("shows the whole thread even when it shrinks", () => {
    const view = mount({ messages: rows(300) });
    view.rerender({ messages: rows(400) });
    view.rerender({ messages: rows(150) });
    expect(view.current.renderedMessages).toHaveLength(150);

    view.act(() => press("PageUp"));
    view.rerender({ messages: rows(20) });
    expect(view.current.renderedMessages).toHaveLength(20);
  });

  it("keeps the reader's row in place when an older page arrives from the server", () => {
    const view = mount({ messages: rows(50, 100) });
    scroller.scrollTop = 300;
    view.act(() => view.current.loadOlder());
    expect(dispatched).toEqual([{ type: "loadOlderMessages", threadId: "thread" }]);
    expect(view.current.following).toBe(false);

    store.state.loadingOlder = { thread: true };
    view.rerender({});
    expect(view.current.olderPending).toBe(true);

    store.state.loadingOlder = {};
    view.rerender({ messages: [...rows(50, 50), ...rows(50, 100)] });
    expect(view.current.olderPending).toBe(false);
    expect(view.current.renderedMessages).toHaveLength(100);
    expect(scroller.scrollTop).toBe(300 + 50 * ROW);
  });

  it("drops a height capture taken in the thread the reader left", () => {
    const view = mount({ messages: rows(50, 100) });
    scroller.scrollTop = 300;
    view.act(() => view.current.loadOlder());
    view.rerender({ threadId: "other", messages: rows(80, 500) });
    expect(view.current.following).toBe(true);
    expect(scroller.scrollTop).toBe(scroller.bottom);
    expect(scroller.scrollTop).not.toBe(300);
  });

  it("drops the capture on a switch even when the next thread opens on the same first row", () => {
    const view = mount({ messages: rows(50, 100) });
    scroller.scrollTop = 300;
    view.act(() => view.current.loadOlder());
    view.rerender({ threadId: "other" });
    expect(scroller.scrollTop).toBe(scroller.bottom);
    expect(view.current.following).toBe(true);
    view.rerender({ threadId: "thread", messages: [...rows(50, 50), ...rows(50, 100)] });
    expect(view.current.following).toBe(true);
    expect(scroller.scrollTop).toBe(scroller.bottom);
  });

  it("jumps to a search result without trimming the transcript", () => {
    store.state.focusMessage = { threadId: "thread", messageId: "m10", nonce: 1, consumed: false };
    const view = mount({ messages: rows(300) });
    expect(view.current.renderedMessages.map((row) => row.id)).toContain("m10");
    expect(view.current.renderedMessages).toHaveLength(300);
    expect(view.current.following).toBe(false);
  });

  it("jumps back to the latest rows and resumes following", () => {
    const view = mount({ messages: rows(300) });
    view.act(() => press("PageUp"));
    expect(view.current.following).toBe(false);

    view.act(() => view.current.jumpToLatest());
    expect(view.current.following).toBe(true);
    expect(scroller.calls.at(-1)).toEqual({ top: 300 * ROW, behavior: "smooth" });
  });

  it("jumps without the smooth animation when motion is reduced", () => {
    const view = mount({ messages: rows(300) });
    view.act(() => press("PageUp"));
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }),
    });
    view.act(() => view.current.jumpToLatest());
    expect(view.current.following).toBe(true);
    expect(scroller.calls.at(-1)).toEqual({ top: 300 * ROW, behavior: "auto" });
  });

  it("keeps following a transcript too short to scroll, so Jump to latest never shows over nothing", () => {
    const view = mount({ messages: rows(4) });
    expect(scroller.scrollHeight).toBeLessThan(scroller.clientHeight);
    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    view.act(() => press("PageUp"));
    view.act(() => press("ArrowUp"));
    view.act(() => view.current.scrollHandlers.onTouchStart({ touches: [{ clientY: 100 }] } as never));
    view.act(() => view.current.scrollHandlers.onTouchMove({ touches: [{ clientY: 200 }] } as never));
    expect(view.current.following).toBe(true);
  });

  it("keeps following when arrow keys move through a menu or list", () => {
    const view = mount({ messages: rows(30) });
    const inMenu = { closest: (selector: string) => (selector.includes('[role="menu"]') ? {} : null) };
    view.act(() => press("ArrowUp", inMenu));
    view.act(() => press("Home", inMenu));
    view.act(() => press("PageUp", inMenu));
    expect(view.current.following).toBe(true);
    view.act(() => press("ArrowUp", { closest: () => null }));
    expect(view.current.following).toBe(false);
  });

  it("re-arms following when another bot or room opens", () => {
    const view = mount({ messages: rows(30) });
    view.act(() => press("PageUp"));
    expect(view.current.following).toBe(false);
    view.rerender({ ownerId: "other-bot", threadId: "other", messages: rows(30, 100) });
    expect(view.current.following).toBe(true);
  });

  it("re-arms following when the same bot opens another thread", () => {
    const view = mount({ messages: rows(30) });
    view.act(() => press("PageUp"));
    scroller.scrollTop = 200;
    scroller.calls = [];
    expect(view.current.following).toBe(false);
    view.rerender({ threadId: "other", messages: rows(30, 100) });
    expect(view.current.transcriptKey).toBe("bot:other");
    expect(view.current.following).toBe(true);
    expect(scroller.scrollTop).toBe(scroller.bottom);
    expect(scroller.calls).toHaveLength(1);
  });

  it("still stops following when a search jump lands in the thread just opened", () => {
    const view = mount({ messages: rows(300) });
    view.act(() => press("PageUp"));
    scroller.calls = [];
    store.state.focusMessage = { threadId: "other", messageId: "m10", nonce: 1, consumed: false };
    view.rerender({ threadId: "other", messages: rows(300) });
    expect(view.current.following).toBe(false);
    expect(view.current.renderedMessages.map((row) => row.id)).toContain("m10");
    expect(scroller.calls).toHaveLength(0);
  });

  it("follows growth inside a row with one instant scroll, and leaves a reader who scrolled up alone", () => {
    const view = mount({ messages: rows(20) });
    scroller.calls = [];
    scroller.extra = 120;
    resize();
    expect(scroller.scrollTop).toBe(scroller.bottom);
    expect(scroller.calls).toEqual([{ top: scroller.scrollHeight }]);

    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    view.act(() => {
      scroller.scrollTop = 100;
      view.current.scrollHandlers.onScroll();
    });
    scroller.extra = 300;
    resize();
    expect(scroller.scrollTop).toBe(100);
  });

  it("stays detached after its own prepend scroll is reported back", () => {
    const view = mount({ messages: rows(20, 100) });
    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    view.act(() => {
      scroller.scrollTop = 100;
      view.current.scrollHandlers.onScroll();
    });
    view.act(() => view.current.loadOlder());
    view.rerender({ messages: [...rows(20, 80), ...rows(20, 100)] });
    expect(scroller.scrollTop).toBe(100 + 20 * ROW);
    // The prepend shifts scrollTop down by the new rows; the browser then reports that write as a scroll.
    view.act(() => view.current.scrollHandlers.onScroll());
    expect(view.current.following).toBe(false);
  });

  it("holds the line being read still when a block above the end opens", () => {
    const view = mount({ messages: rows(30) });
    let controlTop = 200;
    const control = {
      isConnected: true,
      getBoundingClientRect: () => ({ top: controlTop - scroller.scrollTop }) as DOMRect,
      matches: () => false,
      getAttribute: () => "true",
    };
    const target = { closest: () => control };
    scroller.scrollTop = 600;
    view.act(() => view.current.scrollHandlers.onClickCapture({ target } as never));
    expect(view.current.following).toBe(false);

    // The block opens; content above the control grows by 90px, pushing the control down.
    controlTop += 90;
    scroller.extra = 90;
    resize();
    expect(control.getBoundingClientRect().top).toBe(200 - 600);

    view.rerender({ messages: rows(31) });
    expect(control.getBoundingClientRect().top).toBe(200 - 600);
  });

  it("keeps following after a menu button opens, and jumping to the latest drops a held line", () => {
    const view = mount({ messages: rows(30) });
    // Matches the two selector forms the hook uses, against a control's attributes.
    const control = (attributes: Record<string, string>) => ({
      isConnected: true,
      getBoundingClientRect: () => ({ top: 100 }) as DOMRect,
      matches: () => false,
      getAttribute: (name: string) => attributes[name] ?? null,
      closest(selector: string) {
        const hit = selector.split(",").map((part) => part.trim()).some((part) =>
          part === "[aria-expanded]:not([aria-haspopup])"
            ? "aria-expanded" in attributes && !("aria-haspopup" in attributes)
            : part === "[aria-expanded]" && "aria-expanded" in attributes,
        );
        return hit ? this : null;
      },
    });
    const menu = control({ "aria-expanded": "false", "aria-haspopup": "menu" });
    view.act(() => view.current.scrollHandlers.onClickCapture({ target: menu } as never));
    expect(view.current.following).toBe(true);

    const disclosure = control({ "aria-expanded": "false" });
    view.act(() => view.current.scrollHandlers.onClickCapture({ target: disclosure } as never));
    expect(view.current.following).toBe(false);
    view.act(() => view.current.jumpToLatest());
    expect(view.current.following).toBe(true);
    view.rerender({ messages: rows(31) });
    expect(scroller.scrollTop).toBe(scroller.bottom);
  });

  it("watches the transcript for growth only while it is on screen", () => {
    const view = mount({ messages: rows(10), transcriptShown: false });
    expect(observers).toBe(0);
    view.rerender({ transcriptShown: true });
    expect(observers).toBe(1);
  });

  it("pulls every older page on its own until the server has none", () => {
    const view = mount({ messages: rows(50, 200), hasMore: true });
    expect(dispatched).toEqual([{ type: "loadOlderMessages", threadId: "thread" }]);
    expect(view.current.following).toBe(true);

    store.state.loadingOlder = { thread: true };
    view.rerender({});
    expect(view.current.olderPending).toBe(true);
    expect(dispatched).toHaveLength(1);

    store.state.loadingOlder = {};
    view.rerender({ messages: [...rows(50, 150), ...rows(50, 200)] });
    expect(dispatched).toHaveLength(2);
    expect(view.current.renderedMessages).toHaveLength(100);
    expect(scroller.scrollTop).toBe(scroller.bottom);

    store.state.loadingOlder = {};
    view.rerender({ messages: [...rows(50, 100), ...rows(50, 150), ...rows(50, 200)], hasMore: false });
    expect(dispatched).toHaveLength(2);
    expect(view.current.renderedMessages).toHaveLength(150);
  });

  it("stops on a failed page and pages again when the reader retries at the bottom", () => {
    const view = mount({ messages: rows(50, 200), hasMore: true });
    expect(dispatched).toHaveLength(1);

    store.state.loadingOlder = { thread: true };
    view.rerender({});
    store.state.loadingOlder = {};
    store.state.olderFailed = { thread: true };
    view.rerender({});
    expect(view.current.olderFailed).toBe(true);
    expect(dispatched).toHaveLength(1);

    view.rerender({ pinOn: [true] });
    expect(dispatched).toHaveLength(1);

    expect(view.current.following).toBe(true);
    view.act(() => view.current.loadOlder());
    expect(dispatched).toHaveLength(2);
    expect(view.current.following).toBe(true);
  });

  it("keeps the reader's place when a retry is pressed while scrolled up", () => {
    const view = mount({ messages: rows(50, 200), hasMore: true });
    store.state.loadingOlder = { thread: true };
    view.rerender({});
    store.state.loadingOlder = {};
    store.state.olderFailed = { thread: true };
    view.rerender({});
    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    expect(view.current.following).toBe(false);

    view.act(() => view.current.loadOlder());
    expect(dispatched).toHaveLength(2);
    expect(view.current.following).toBe(false);
  });

  it("restores the reader's rows when following stopped while the page was in flight", () => {
    const view = mount({ messages: rows(50, 200), hasMore: true });
    expect(dispatched).toHaveLength(1);
    store.state.loadingOlder = { thread: true };
    view.rerender({});

    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    scroller.scrollTop = 500;
    store.state.loadingOlder = {};
    view.rerender({ messages: [...rows(50, 150), ...rows(50, 200)] });

    expect(scroller.scrollTop).toBe(500 + 50 * ROW);
  });

  it("holds a scrolled-up reader still while the loading placeholder comes and goes above them", () => {
    const SKELETON = 170;
    const view = mount({ messages: rows(50, 200), hasMore: true });
    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    scroller.scrollTop = 500;

    scroller.extra = SKELETON;
    store.state.loadingOlder = { thread: true };
    view.rerender({});
    resize();
    expect(scroller.scrollTop).toBe(500 + SKELETON);

    scroller.extra = 0;
    store.state.loadingOlder = {};
    view.rerender({ messages: [...rows(50, 150), ...rows(50, 200)] });
    resize();
    expect(scroller.scrollTop).toBe(500 + 50 * ROW);
  });

  it("keeps the reader's rows when the placeholder showed while following and the reader left before the page landed", () => {
    const SKELETON = 170;
    const view = mount({ messages: rows(50, 200), hasMore: true });
    scroller.extra = SKELETON;
    store.state.loadingOlder = { thread: true };
    view.rerender({});

    view.act(() => view.current.scrollHandlers.onWheel({ deltaY: -40 } as never));
    scroller.scrollTop = 500;
    scroller.extra = 0;
    store.state.loadingOlder = {};
    view.rerender({ messages: [...rows(50, 150), ...rows(50, 200)] });

    expect(scroller.scrollTop).toBe(500 - SKELETON + 50 * ROW);
  });

  it("stops paging a thread once the view has switched away", () => {
    const view = mount({ messages: rows(50, 200), hasMore: true });
    expect(dispatched).toEqual([{ type: "loadOlderMessages", threadId: "thread" }]);
    store.state.loadingOlder = { thread: true };

    view.rerender({ threadId: "other", messages: rows(10, 500), hasMore: false });
    expect(view.current.transcriptKey).toBe("bot:other");
    expect(dispatched).toHaveLength(1);

    store.state.loadingOlder = {};
    view.rerender({ threadId: "other", messages: rows(20, 500), hasMore: false });
    expect(dispatched).toHaveLength(1);
  });

  it("does not start another page after unmount", () => {
    const view = mount({ messages: rows(50, 200), hasMore: true });
    expect(dispatched).toHaveLength(1);
    view.unmount();
    expect(dispatched).toHaveLength(1);
  });

  it("tears down its key listener and growth observer on unmount without paging or re-rendering", () => {
    const view = mount({ messages: rows(50, 200), hasMore: true, transcriptShown: true });
    expect(dispatched).toHaveLength(1);
    const observer = resizeObservers.at(-1)!;
    expect(keyListeners.size).toBeGreaterThan(0);

    store.state.loadingOlder = { thread: true };
    view.rerender({});
    view.unmount();
    expect(keyListeners.size).toBe(0);
    expect(observer.disconnected).toBe(true);

    observer.callback([], observer as unknown as ResizeObserver);
    for (const frame of frames.splice(0)) frame(0);

    expect(dispatched).toHaveLength(1);
    expect(react.runtime.dirty).toBe(false);
  });

  it("does not page when the server says the thread has nothing older", () => {
    mount({ messages: rows(300), hasMore: false });
    expect(dispatched).toEqual([]);
  });

  it("waits until the conversation is on screen before paging it", () => {
    const view = mount({ messages: rows(50, 200), hasMore: true, transcriptShown: false });
    expect(dispatched).toEqual([]);
    view.rerender({ transcriptShown: true });
    expect(dispatched).toEqual([{ type: "loadOlderMessages", threadId: "thread" }]);
  });
});
