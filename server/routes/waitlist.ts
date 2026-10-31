import type { WaitlistStore } from "../waitlist.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface WaitlistRouteDeps {
  store: WaitlistStore;
  /** True when the address is already on the owner's sign-in list (admins or members). */
  listed: (email: string) => boolean;
}

/** Settings → Pessoas: who asked for access. Admin only (no CLIENT_ALLOW entry), so the auth gate refuses everyone else. */
export function createWaitlistRoutes({ store, listed }: WaitlistRouteDeps): RouteHandler {
  return async ({ res, path, method, url, json }) => {
    if (path !== "/api/waitlist") return PASS;
    if (method === "GET") {
      return json(res, 200, { entries: store.list().filter((entry) => !listed(entry.email)) });
    }
    if (method === "DELETE") {
      const email = url.searchParams.get("email") ?? "";
      if (!email.trim()) return json(res, 400, { error: "Diga qual e-mail sai da lista de espera." });
      store.remove(email);
      return json(res, 200, { entries: store.list().filter((entry) => !listed(entry.email)) });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
