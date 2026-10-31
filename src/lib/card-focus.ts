/** Nordus: a tap on an approval or question banner lands on its card, not just on the conversation. */

const REQUEST_ID = /^[\w:.-]{1,200}$/;
const WAIT_MS = 8_000;

export const CARD_REQUEST_ATTRIBUTE = "data-card-request";

/** A request id from a push payload or a URL, or null when it is not one. */
export function requestIdFrom(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

const cardSelector = (requestId: string) => `[${CARD_REQUEST_ATTRIBUTE}="${requestId}"]`;

/** Lands on the card: through its transcript row when it has one (`onRow` turns off following the end), then focus. */
export function focusCard(root: ParentNode, requestId: string, onRow?: (messageId: string) => void): boolean {
  if (!requestIdFrom(requestId)) return false;
  const card = root.querySelector<HTMLElement>(cardSelector(requestId));
  if (!card) return false;
  const messageId = card.closest("[data-mid]")?.getAttribute("data-mid");
  if (messageId && onRow) onRow(messageId);
  else card.scrollIntoView({ block: "center" });
  card.focus({ preventScroll: true });
  return true;
}

let pending: (() => void) | null = null;

/** The conversation mounts after the tap, so this waits for the card; a newer tap replaces an older wait. */
export function focusCardWhenShown(requestId: string, onRow?: (messageId: string) => void, waitMs = WAIT_MS): () => void {
  pending?.();
  if (typeof document === "undefined" || typeof MutationObserver === "undefined" || !requestIdFrom(requestId)) return () => {};
  let done = false;
  const stop = () => {
    done = true;
    observer.disconnect();
    clearTimeout(timer);
    if (pending === stop) pending = null;
  };
  const settle = () => setTimeout(() => {
    if (!done && focusCard(document, requestId, onRow)) stop();
  }, 150);
  const observer = new MutationObserver(() => {
    if (document.querySelector(cardSelector(requestId))) settle();
  });
  const timer = setTimeout(stop, waitMs);
  pending = stop;
  observer.observe(document.body, { childList: true, subtree: true });
  if (document.querySelector(cardSelector(requestId))) settle();
  return stop;
}

/** What a card's wrapper carries so a banner's tap can find and focus it. */
export function cardFocusTarget(requestId: string | undefined): Record<string, string | number> {
  return requestId ? { [CARD_REQUEST_ATTRIBUTE]: requestId, tabIndex: -1 } : {};
}
