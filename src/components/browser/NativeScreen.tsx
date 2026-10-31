import { useEffect, useRef } from "react";
import type RFB from "@novnc/novnc";

/**
 * The bot's Chrome as a window: its own display, shown as it is, with the tabs, address bar and profile picture Chrome
 * draws. Only pixels and input cross; the page never runs here. What the person does reaches the window only while they
 * hold control (the control itself is the browser stream's), otherwise the view is watch-only.
 */
export function NativeScreen({ botId, interactive, onConnected }: { botId: string; interactive: boolean; onConnected: (connected: boolean) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const client = useRef<RFB | null>(null);
  const live = useRef(interactive);
  live.current = interactive;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const open = async () => {
      if (stopped || !holder.current) return;
      const { default: Viewer } = await import("@novnc/novnc");
      if (stopped || !holder.current) return;
      const url = new URL(`/api/bots/${encodeURIComponent(botId)}/browser/native`, location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const rfb = new Viewer(holder.current, url.href, { credentials: { password: "", username: "", target: "" } });
      client.current = rfb;
      rfb.scaleViewport = true;
      rfb.background = "#ffffff";
      rfb.focusOnClick = true;
      rfb.viewOnly = !live.current;
      rfb.addEventListener("connect", () => { attempt = 0; onConnected(true); });
      rfb.addEventListener("disconnect", () => {
        if (client.current === rfb) client.current = null;
        onConnected(false);
        if (stopped) return;
        timer = setTimeout(() => { void open(); }, Math.min(1000 * 2 ** attempt++, 8000));
      });
    };
    void open();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      client.current?.disconnect();
      client.current = null;
    };
  }, [botId, onConnected]);
  useEffect(() => {
    const rfb = client.current;
    if (!rfb) return;
    rfb.viewOnly = !interactive;
    if (interactive) rfb.focus();
    else rfb.blur();
  }, [interactive]);
  return <div ref={holder} data-testid="browser-native-screen" className="absolute inset-0 z-[5] overflow-hidden bg-white" />;
}
