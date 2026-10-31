import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function read(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
