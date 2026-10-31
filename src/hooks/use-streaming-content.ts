// Copyright 2026 Hodle Tecnologia Ltda and touri contributors.
// Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0).
// Adapted from ui/src/components/useStreamingContent.ts; modified for this codebase (names and formatting).
import { useEffect, useRef, useState } from "react";

/** While `streaming`, hands back the newest `content` at most once per 100 ms and the next frame; never a backlog. */
export function useStreamingContent(content: string, streaming: boolean): string {
  const [displayed, setDisplayed] = useState(content);
  const latest = useRef(content);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    latest.current = content;
    if (!streaming) {
      if (pending.current !== null) clearTimeout(pending.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      pending.current = null;
      frame.current = null;
      setDisplayed(content);
      return;
    }
    if (pending.current !== null || frame.current !== null) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setDisplayed(latest.current);
      });
    }, 100);
  }, [content, streaming]);

  useEffect(() => () => {
    if (pending.current !== null) clearTimeout(pending.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    pending.current = null;
    frame.current = null;
  }, []);

  return streaming ? displayed : content;
}
