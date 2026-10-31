// Nordus: answers a card exactly as a click on it would, by the answer route, as the same person: no second copy of the
// rules about who may answer and what each kind of card does with the answer.
import type { ServerResponse } from "node:http";
import type { RouteContext } from "./routes/table.ts";

export interface RespondBody {
  requestId: string;
  behavior: "allow" | "deny";
  message?: string;
}

export interface Responded {
  status: number;
  body: Record<string, unknown>;
}

export type Dispatch = (ctx: RouteContext) => Promise<boolean>;

export async function respondAsClick(dispatch: Dispatch, ctx: RouteContext, threadId: string, body: RespondBody): Promise<Responded> {
  let status = 0;
  let sent = "";
  const capture = {
    headersSent: false, writableEnded: false, req: { headers: {} },
    setHeader() {}, writeHead(code: number) { status = code; return capture; },
    end(data?: unknown) { sent = typeof data === "string" ? data : String(data ?? ""); capture.writableEnded = true; },
  };
  await dispatch({
    ...ctx, res: capture as unknown as ServerResponse, path: `/api/threads/${threadId}/respond`, method: "POST",
    readBody: (async () => body) as RouteContext["readBody"],
  });
  try {
    const parsed: unknown = JSON.parse(sent);
    return { status, body: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {} };
  } catch {
    return { status: status || 500, body: {} };
  }
}
