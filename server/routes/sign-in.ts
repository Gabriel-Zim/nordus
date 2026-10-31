import type { SignInPlace } from "../../shared/sign-in-request.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

type SignInResult = { messageId: string; site: string; place: SignInPlace } | { status: number; error: string };

/** Only dispatch inside the internal capability gate, with its guarded body
 * reader. The global route table must never register this endpoint. */
export function createInternalSignInRoutes(deps: {
  readBody(): ReturnType<RouteContext["readBody"]>;
  request(site: unknown, reason: unknown): Promise<SignInResult> | SignInResult;
}): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (method !== "POST" || path !== "/api/internal/request-sign-in") return PASS;
    const body = await deps.readBody();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(res, 400, { error: "request body must be a JSON object" });
    }
    const result = await deps.request(body.site, body.reason);
    return "error" in result ? json(res, result.status, { error: result.error }) : json(res, 201, result);
  };
}
