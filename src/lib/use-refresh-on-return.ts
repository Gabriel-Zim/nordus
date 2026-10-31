import { useEffect } from "react";

/** Sign-ins happen in another tab: reload when this one is looked at again. */
export function useRefreshOnReturn(reload: () => void): void {
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);
}
