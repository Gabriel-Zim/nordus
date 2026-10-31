const TOAST_EVENT = "nordus:toast";

export const TOAST_MS = 2200;

export function showToast(text: string): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: text }));
}

export function listenToasts(onToast: (text: string) => void): () => void {
  const handler = (event: Event) => onToast((event as CustomEvent<string>).detail);
  window.addEventListener(TOAST_EVENT, handler);
  return () => window.removeEventListener(TOAST_EVENT, handler);
}
