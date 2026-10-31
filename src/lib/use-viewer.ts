import { useEffect, useState } from "react";

import { sessionOnce, type SessionState } from "./session";
import { viewerOf, type Viewer } from "./viewer";
import { useStore } from "@/state/store";

let known: SessionState | null = null;

export function useViewer(): Viewer {
  const profileEmail = useStore().state.config?.profile?.email;
  const [session, setSession] = useState<SessionState | null>(known);
  useEffect(() => {
    let alive = true;
    void sessionOnce().then((state) => {
      known = state;
      if (alive) setSession(state);
    }, () => undefined);
    return () => { alive = false; };
  }, []);
  return viewerOf(session, profileEmail);
}

export function useGuest(): boolean {
  return useViewer().guest;
}
