import { useEffect } from "react";

import { startDirect, syncDirect } from "@/state/direct-messages";
import { useStore } from "@/state/store";
import { useViewer } from "./use-viewer";

/** Keeps direct messages current for the whole window: it listens from the start and asks again after each reconnect. */
export function useDirectSync(): void {
  const { state } = useStore();
  const { email } = useViewer();
  useEffect(() => { startDirect(email); }, [email]);
  useEffect(() => {
    if (state.connected) void syncDirect();
  }, [state.connected, email]);
}
