// Nordus: ensinar uma tarefa (frente G). Cliente CDP pequeno COM eventos.
// O connectCdp de browser-sites.ts ignora eventos (so responde chamadas), por isso este e proprio.

export type CdpEventHandler = (method: string, params: Record<string, unknown>, sessionId?: string) => void;

export interface CdpEvents {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  /** Registra um ouvinte de eventos; devolve a funcao que o remove. */
  on(handler: CdpEventHandler): () => void;
  close(): void;
}

/** Somente o Chrome do proprio robo, nesta maquina (igual a trava de browser-sites.ts). */
export function isLoopbackCdpUrl(url: unknown): url is string {
  return typeof url === "string" && /^wss?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\//u.test(url);
}

/** Tenta ate achar o endereco do DevTools ou estourar o prazo (o navegador pode estar subindo). */
export async function waitForCdpUrl(
  once: () => Promise<string | null>,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let waited = 0;
  for (;;) {
    let found: string | null = null;
    try { found = await once(); } catch { found = null; }
    if (isLoopbackCdpUrl(found)) return found;
    if (waited >= timeoutMs) return null;
    await sleep(intervalMs);
    waited += intervalMs;
  }
}

export function connectCdpEvents(url: string, timeoutMs = 10_000): Promise<CdpEvents> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map<number, { done: (value: Record<string, unknown>) => void; fail: (error: Error) => void }>();
    const handlers = new Set<CdpEventHandler>();
    let next = 1;
    const failAll = (error: Error) => { for (const call of pending.values()) call.fail(error); pending.clear(); };
    const opening = setTimeout(() => { socket.close(); reject(new Error("O navegador não respondeu.")); }, timeoutMs);
    socket.addEventListener("error", () => {
      clearTimeout(opening);
      reject(new Error("Não consegui falar com o navegador."));
      failAll(new Error("A conexão com o navegador caiu."));
    });
    socket.addEventListener("close", () => failAll(new Error("A conexão com o navegador fechou.")));
    socket.addEventListener("message", (event) => {
      let message: { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: Record<string, unknown>; error?: { message?: string } };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (typeof message.id === "number") {
        const call = pending.get(message.id);
        if (!call) return;
        pending.delete(message.id);
        if (message.error) call.fail(new Error(message.error.message || "O navegador recusou o pedido."));
        else call.done(message.result ?? {});
        return;
      }
      if (typeof message.method === "string") {
        for (const handler of handlers) {
          try { handler(message.method, message.params ?? {}, message.sessionId); } catch {}
        }
      }
    });
    socket.addEventListener("open", () => {
      clearTimeout(opening);
      resolve({
        send: (method, params = {}, sessionId) => new Promise((done, fail) => {
          const id = next++;
          const timer = setTimeout(() => { pending.delete(id); fail(new Error("O navegador não respondeu.")); }, timeoutMs);
          pending.set(id, {
            done: (value) => { clearTimeout(timer); done(value); },
            fail: (error) => { clearTimeout(timer); fail(error); },
          });
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        }),
        on: (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
        close: () => { handlers.clear(); try { socket.close(); } catch {} },
      });
    });
  });
}
