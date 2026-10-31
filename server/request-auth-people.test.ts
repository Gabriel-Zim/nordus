import type { IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { guestAllowed, requiredScope, resolveRequestAuth } from "./request-auth.ts";
import { SessionRegistry } from "./sessions.ts";

const request = (headers: Record<string, string>, method = "GET") => ({ headers, method }) as unknown as IncomingMessage;

describe("which routes a signed-in person without admin may reach", () => {
  it("opens the directory, direct messages, the feed and an agent's budget to the chat scope", () => {
    const open: Array<[string, string]> = [
      ["GET", "/api/people/directory"], ["PUT", "/api/people/rooms/abc/people"],
      ["GET", "/api/dms"], ["POST", "/api/dms"], ["GET", "/api/dms/abc/messages"], ["POST", "/api/dms/abc/messages"], ["POST", "/api/dms/abc/read"],
      ["GET", "/api/notifications"], ["POST", "/api/notifications/read-all"], ["POST", "/api/notifications/n1/read"],
      ["GET", "/api/bots/abc/budget"], ["PUT", "/api/bots/abc/budget"],
    ];
    for (const [method, path] of open) expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
  });

  it("keeps what the workspace spends, the sign-in lists and the rest of the wiring for admins", () => {
    const closed: Array<[string, string]> = [
      ["GET", "/api/budget/month"], ["GET", "/api/usage"], ["PUT", "/api/config"],
      ["DELETE", "/api/dms/abc"], ["PUT", "/api/dms/abc/messages"], ["PATCH", "/api/dms"],
      ["DELETE", "/api/bots/abc/budget"], ["PUT", "/api/people/directory"], ["GET", "/api/people/rooms/abc/people"],
    ];
    for (const [method, path] of closed) expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
  });
});

describe("what a guest may do", () => {
  const allowed: Array<[string, string]> = [
    ["GET", "/api/auth/session"], ["POST", "/api/auth/logout"], ["POST", "/api/auth/stream-ticket"], ["GET", "/api/health"], ["GET", "/api/events"], ["GET", "/api/config"],
    ["GET", "/api/edition"], ["GET", "/api/brand"], ["GET", "/api/updates/check"],
    ["GET", "/api/bots"], ["GET", "/api/search"], ["GET", "/api/threads/t1/messages"], ["GET", "/api/threads/t1/messages/m1/image"], ["GET", "/api/threads/t1/reply-draft"],
    ["POST", "/api/groups/g1/messages"], ["POST", "/api/groups/g1/read"], ["POST", "/api/bots/b1/messages"], ["POST", "/api/bots/b1/read"],
    ["POST", "/api/threads/t1/respond"], ["POST", "/api/threads/t1/messages/m1/reactions"],
    ["POST", "/api/attachments"], ["GET", "/api/attachments/a1.png"], ["POST", "/api/files"],
    ["GET", "/api/people/directory"], ["GET", "/api/dms"], ["POST", "/api/dms"], ["GET", "/api/dms/d1/messages"], ["POST", "/api/dms/d1/messages"], ["POST", "/api/dms/d1/read"],
    ["GET", "/api/notifications"], ["POST", "/api/notifications/read-all"], ["POST", "/api/notifications/n1/read"],
  ];
  const refused: Array<[string, string]> = [
    ["PATCH", "/api/groups/g1"], ["POST", "/api/groups"], ["POST", "/api/groups/g1/interrupt"], ["POST", "/api/groups/g1/tasks"],
    ["PATCH", "/api/groups/g1/tasks/t1"], ["DELETE", "/api/groups/g1/tasks/t1"], ["POST", "/api/groups/g1/members/b1/compact"], ["DELETE", "/api/groups/g1/queue/q1"],
    ["PATCH", "/api/bots/b1"], ["PATCH", "/api/bots/b1/profile"], ["POST", "/api/bots/b1/always-allow"], ["POST", "/api/bots/b1/respond"],
    ["POST", "/api/bots/b1/interrupt"], ["POST", "/api/bots/b1/compact"], ["POST", "/api/bots/b1/tasks"], ["PATCH", "/api/bots/b1/tasks/t1"],
    ["POST", "/api/bots/b1/messages/m1/edit"], ["PATCH", "/api/bots/b1/cards/c1"], ["POST", "/api/threads/t1/undo"], ["GET", "/api/threads/t1/export"],
    ["GET", "/api/bots/b1/budget"], ["PUT", "/api/bots/b1/budget"], ["PUT", "/api/people/rooms/g1/people"],
    ["GET", "/api/routines"], ["POST", "/api/routines"], ["PATCH", "/api/routines/r1"], ["POST", "/api/routine-runs/x/cancel"],
    ["GET", "/api/webhooks"], ["GET", "/api/app-triggers"], ["GET", "/api/team-map"], ["GET", "/api/today"],
    ["POST", "/api/tts/speak"], ["POST", "/api/bot-tag-suggestions"], ["GET", "/api/bots/b1/browser/live"], ["POST", "/api/bots/b1/browser/action"],
    ["POST", "/api/threads/t1/messages/m1/file"], ["GET", "/api/shared-computers"],
  ];

  it("is limited to reading and writing where they were put, their direct messages, the directory and their own notices", () => {
    for (const [method, path] of allowed) expect(guestAllowed(method, path), `${method} ${path}`).toBe(true);
  });

  it("is refused what a member could do beyond that, rooms and conversations included", () => {
    for (const [method, path] of refused) expect(guestAllowed(method, path), `${method} ${path}`).toBe(false);
  });

  it("never reaches further than the chat scope reaches", () => {
    for (const [method, path] of allowed) expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
  });
});

describe("the check on a real session", () => {
  let dir: string;
  let sessions: SessionRegistry;
  const tokens: Record<string, string> = {};
  const as = (who: string, path: string, method = "GET") => resolveRequestAuth(
    request({ host: "bots.example.com", authorization: `Bearer ${tokens[who]}` }, method),
    { sessions, cookieName: "nordus_session_8799_env", streamPath: "/api/events", url: new URL(path, "http://x") },
  );

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nordus-auth-people-"));
    sessions = new SessionRegistry({
      file: join(dir, "sessions.json"),
      emailScopes: (email) => (email.startsWith("boss") ? ["admin", "client"] : ["client"]),
      emailGuestSnapshot: () => (email) => email.startsWith("gus"),
    });
    for (const email of ["boss@x.test", "ana@x.test", "gus@x.test"]) {
      tokens[email.split("@")[0]!] = sessions.issue({ label: "laptop", email, scopes: email.startsWith("boss") ? ["admin", "client"] : ["client"] }).token;
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lets a member open a room and see routines, and tells a guest that a guest only takes part in channels", () => {
    expect(as("ana", "/api/groups", "POST").auth?.kind).toBe("session");
    expect(as("ana", "/api/routines").auth?.kind).toBe("session");
    expect(as("boss", "/api/groups", "POST").auth?.kind).toBe("session");
    for (const [method, path] of [["POST", "/api/groups"], ["GET", "/api/routines"], ["GET", "/api/webhooks"]] as const) {
      const refused = as("gus", path, method);
      expect(refused.auth, `${method} ${path}`).toBeNull();
      expect(refused.status).toBe(403);
      expect(refused.error).toMatch(/guest/);
    }
  });

  it("tells a guest the same when they rename or pin a room's conversation, change an agent's instructions or ask to always allow", () => {
    for (const [method, path] of [
      ["PATCH", "/api/groups/g1"], ["PATCH", "/api/groups/g1/tasks/t1"], ["PATCH", "/api/bots/b1/profile"], ["PATCH", "/api/bots/b1"], ["POST", "/api/bots/b1/always-allow"],
    ] as const) {
      const refused = as("gus", path, method);
      expect(refused.auth, `${method} ${path}`).toBeNull();
      expect(refused.status).toBe(403);
      expect(refused.error).toMatch(/guest/);
      expect(as("ana", path, method).auth?.kind, `ana ${method} ${path}`).toBe("session");
    }
  });

  it("still lets a guest read and write where they were put", () => {
    expect(as("gus", "/api/bots").auth?.kind).toBe("session");
    expect(as("gus", "/api/groups/g1/messages", "POST").auth?.kind).toBe("session");
    expect(as("gus", "/api/people/directory").auth?.kind).toBe("session");
    expect(as("gus", "/api/dms", "POST").auth?.kind).toBe("session");
    expect(as("gus", "/api/config", "PUT").status).toBe(403);
  });
});
