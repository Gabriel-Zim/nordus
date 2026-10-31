import { useEffect } from "react";

export const CHAT_ERROR_CLEAR_MS = 6_000;

/** Informational notices clear themselves; an error someone has to act on stays until dismissed. */
export function useChatErrorClear(error: string | null, clear: () => void, persistent = true): void {
  useEffect(() => {
    if (!error || persistent) return;
    const timer = setTimeout(clear, CHAT_ERROR_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [error, clear, persistent]);
}
