// Pull to refresh on a phone, the UIRefreshControl way: at the top of a list or a conversation the
// content follows the finger on the rubber band, the spinner draws its ticks in as it comes down,
// and past the trigger a release loads again while the spinner turns. One listener on `root`
// serves every scroller inside it (the list, the open conversation and the screens pushed over them).
import { IOS_POP_MS, PULL_REST, PULL_TRIGGER, haptic, rubberBand } from "@/lib/ios-motion";

const TICKS = 8;

function spinnerFor(frame: HTMLElement): HTMLElement {
  const found = frame.querySelector<HTMLElement>(":scope > .nb-ptr");
  if (found) return found;
  const spinner = document.createElement("div");
  spinner.className = "nb-ptr";
  spinner.setAttribute("aria-hidden", "true");
  for (let i = 0; i < TICKS; i++) {
    const tick = document.createElement("i");
    tick.style.setProperty("--i", String(i));
    spinner.append(tick);
  }
  frame.prepend(spinner);
  return spinner;
}

export function installPullToRefresh(root: HTMLElement, onRefresh: () => Promise<unknown>): () => void {
  let pull: { scroller: HTMLElement; content: HTMLElement; spinner: HTMLElement; y: number; x: number; d: number; on: boolean } | null = null;
  let busy = false;

  const place = (d: number, spinning: boolean) => {
    if (!pull) return;
    pull.content.style.transform = d ? `translateY(${d}px)` : "";
    pull.spinner.style.setProperty("--pull", String(Math.min(1, d / PULL_TRIGGER)));
    pull.spinner.style.transform = `translateY(${Math.max(0, d - PULL_REST) / 2}px)`;
    pull.spinner.toggleAttribute("data-spinning", spinning);
  };

  const settle = (target: HTMLElement, content: HTMLElement, spinner: HTMLElement) => {
    content.style.transition = `transform ${IOS_POP_MS}ms var(--ios-push-ease)`;
    spinner.style.transition = `opacity ${IOS_POP_MS}ms ease, transform ${IOS_POP_MS}ms var(--ios-push-ease)`;
    content.style.transform = "";
    spinner.style.transform = "";
    spinner.style.setProperty("--pull", "0");
    spinner.removeAttribute("data-spinning");
    window.setTimeout(() => {
      content.style.transition = "";
      spinner.style.transition = "";
      target.removeAttribute("data-pulling");
    }, IOS_POP_MS);
  };

  const start = (event: TouchEvent) => {
    if (busy || event.touches.length !== 1 || !(event.target instanceof Element)) return;
    // The list and the conversation (a glass scroller), or the body of a screen pushed over them.
    const scroller = event.target.closest<HTMLElement>(".glass-scroller, [data-layer-body]");
    const frame = scroller?.parentElement;
    const content = scroller?.matches("[data-layer-body]") ? scroller : scroller?.firstElementChild as HTMLElement | null;
    if (!scroller || !frame || !content || !root.contains(scroller) || scroller.scrollTop > 0) return;
    // Only the screen in front: not the conversation behind the list, nor the list behind a conversation.
    // A sheet drags down to close instead (sheet-drag.ts).
    if (scroller.closest("[inert], [data-mobile-stack][data-screen='chat'] > aside, .glass-popup")) return;
    const touch = event.touches[0]!;
    pull = { scroller, content, spinner: spinnerFor(frame), y: touch.clientY, x: touch.clientX, d: 0, on: false };
  };

  const move = (event: TouchEvent) => {
    if (!pull) return;
    const touch = event.touches[0]!;
    const dy = touch.clientY - pull.y;
    if (!pull.on) {
      // A sideways drag or a scroll down belongs to someone else.
      if (Math.abs(touch.clientX - pull.x) > Math.abs(dy) || dy <= 0 || pull.scroller.scrollTop > 0) {
        if (Math.abs(dy) > 6 || Math.abs(touch.clientX - pull.x) > 6) pull = null;
        return;
      }
      pull.on = true;
      pull.scroller.setAttribute("data-pulling", "");
    }
    event.preventDefault();
    pull.d = rubberBand(Math.max(0, dy), window.innerHeight);
    place(pull.d, false);
  };

  const end = () => {
    const done = pull;
    pull = null;
    if (!done?.on) return;
    const { scroller, content, spinner } = done;
    if (done.d < PULL_TRIGGER) {
      settle(scroller, content, spinner);
      return;
    }
    busy = true;
    haptic("light");
    content.style.transition = `transform ${IOS_POP_MS}ms var(--ios-push-ease)`;
    pull = done;
    place(PULL_REST, true);
    pull = null;
    const shown = new Promise((resolve) => window.setTimeout(resolve, 600));
    void Promise.allSettled([onRefresh(), shown]).then(() => {
      busy = false;
      settle(scroller, content, spinner);
    });
  };

  root.addEventListener("touchstart", start, { passive: true });
  root.addEventListener("touchmove", move, { passive: false });
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", end);
  return () => {
    root.removeEventListener("touchstart", start);
    root.removeEventListener("touchmove", move);
    root.removeEventListener("touchend", end);
    root.removeEventListener("touchcancel", end);
  };
}
