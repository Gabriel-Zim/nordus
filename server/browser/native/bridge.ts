// Carries one noVNC viewer's WebSocket to a profile's x11vnc Unix socket and back, byte for byte. The socket is the only
// thing it can reach: a viewer never names a host, a port or a path.
import { connect, type Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_BUFFER = 8 * 1024 * 1024;

const wss = new WebSocketServer({
  noServer: true, perMessageDeflate: false, maxPayload: MAX_MESSAGE_BYTES,
  handleProtocols: (protocols) => (protocols.has("binary") ? "binary" : false),
});

export interface NativeBridge { close(): void }

export function bridgeNative(options: { socketPath: string; req: IncomingMessage; socket: Duplex; head: Buffer; onClose?: () => void }): NativeBridge {
  let ws: WebSocket | null = null;
  let upstream: Socket | null = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    upstream?.destroy();
    try { ws?.terminate(); } catch {}
    options.socket.destroy();
    options.onClose?.();
  };
  wss.handleUpgrade(options.req, options.socket as never, options.head, (client) => {
    ws = client;
    if (closed) { client.terminate(); return; }
    const vnc = connect(options.socketPath);
    upstream = vnc;
    const pending: Buffer[] = [];
    let open = false;
    vnc.once("connect", () => { open = true; for (const chunk of pending) vnc.write(chunk); pending.length = 0; });
    vnc.on("data", (chunk) => {
      if (client.readyState !== client.OPEN) return;
      if (client.bufferedAmount > MAX_BUFFER) { close(); return; }
      client.send(chunk, { binary: true });
    });
    vnc.on("error", close);
    vnc.on("close", close);
    client.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      if (open) vnc.write(chunk); else pending.push(chunk);
    });
    client.on("error", close);
    client.on("close", close);
  });
  options.socket.once("close", close);
  return { close };
}
