import { useEffect, useRef, useState } from "react";
import { listenToasts, TOAST_MS } from "@/lib/toast";

export function ToastHost() {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const stop = listenToasts((next) => {
      setText(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setText(null), TOAST_MS);
    });
    return () => {
      stop();
      clearTimeout(timer.current);
    };
  }, []);
  return (
    <div role="status" aria-live="polite" data-toast-host=""
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}>
      {text && (
        <span className="rounded-full border border-hairline/50 bg-menu px-4 py-2 text-[13px] text-ink shadow-xl shadow-black/30">{text}</span>
      )}
    </div>
  );
}
