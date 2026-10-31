import { useCallback, useEffect, useState } from "react";
import { BROWSER_STAGE_CLOSE_EVENT, BROWSER_STAGE_EVENT, clearPendingBrowserStage, takeAnyPendingBrowserStage } from "@/lib/browser-stage";
import { useStore } from "@/state/store";
import { LiveBrowser } from "./BrowserPanel";

/**
 * The bot's browser as a full window stage, opened from the chat (a chip, a thumbnail, a sign-in card) without the side
 * panel. It mounts only while the stage is open, so closing it also drops its connection.
 */
export function BrowserStageHost() {
  const { state } = useStore();
  const [botId, setBotId] = useState<string | null>(null);
  useEffect(() => {
    const early = takeAnyPendingBrowserStage();
    if (early) setBotId(early);
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ botId?: string }>).detail?.botId;
      if (!id) return;
      clearPendingBrowserStage(id);
      setBotId(id);
    };
    const shut = (event: Event) => {
      const id = (event as CustomEvent<{ botId?: string }>).detail?.botId;
      setBotId((current) => (current === id ? null : current));
    };
    window.addEventListener(BROWSER_STAGE_EVENT, open);
    window.addEventListener(BROWSER_STAGE_CLOSE_EVENT, shut);
    return () => { window.removeEventListener(BROWSER_STAGE_EVENT, open); window.removeEventListener(BROWSER_STAGE_CLOSE_EVENT, shut); };
  }, []);
  const close = useCallback(() => setBotId(null), []);
  const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
  useEffect(() => { if (botId && !bot) setBotId(null); }, [botId, bot]);
  if (!bot || bot.browser === false) return null;
  return <LiveBrowser key={bot.id} bot={bot} stageOnly onStageClose={close} />;
}
