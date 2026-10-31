import { describe, expect, it } from "vitest";

import { requiredScope, serviceAllowed } from "./request-auth.ts";

describe("who may reach the approvals addresses", () => {
  it("lets a signed-in member read their own list and decide by id, where the handlers cut what they see", () => {
    expect(requiredScope("GET", "/api/approvals")).toBe("client");
    expect(requiredScope("GET", "/api/inbox")).toBe("client");
    expect(requiredScope("POST", "/api/approvals/thread-1.msg-1/approve")).toBe("client");
    expect(requiredScope("POST", "/api/approvals/thread-1.msg-1/decline")).toBe("client");
  });

  it("keeps the wait setting, and anything else under the address, to administrators", () => {
    expect(requiredScope("GET", "/api/approvals/settings")).toBe("admin");
    expect(requiredScope("PUT", "/api/approvals/settings")).toBe("admin");
    expect(requiredScope("POST", "/api/approvals")).toBe("admin");
    expect(requiredScope("POST", "/api/approvals/not-an-id/approve")).toBe("admin");
    expect(requiredScope("POST", "/api/approvals/a.b/other")).toBe("admin");
    expect(requiredScope("DELETE", "/api/approvals/a.b/approve")).toBe("admin");
  });

  it("never opens them to a bot's own shell, which must not approve its own requests", () => {
    for (const [method, path] of [
      ["GET", "/api/approvals"], ["GET", "/api/inbox"], ["POST", "/api/approvals/thread-1.msg-1/approve"], ["POST", "/api/approvals/thread-1.msg-1/decline"],
      ["GET", "/api/approvals/settings"], ["PUT", "/api/approvals/settings"],
    ] as const) expect(serviceAllowed(method, path), `${method} ${path}`).toBe(false);
  });
});
