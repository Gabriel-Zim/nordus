import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_SIGN_IN_FAILED, cloudOwnerOf, invalidateSession, isConnected, pairWithCode, seedSession, sessionBodyOnce, sessionOnce, isOwnerOrAdmin, previewBrowserSignIn, readSessionState, reasonWorthShowing, SERVICE_TRUST_REASON, signInWithBrowserGrant,
  takeBrowserSignInFromLocation, takeInvitedEmailFromLocation, takeJoinTokenFromLocation, takePairingCodeFromLocation, startEmailSignIn, verifyEmailSignIn,
} from "./session";

describe("what the pair page says about why it was shown", () => {
  it("stays quiet for the ordinary no-session case and repeats anything else", () => {
    expect(reasonWorthShowing("forbidden: this request came through a proxy (pair this device to use the server remotely)")).toBeNull();
    expect(reasonWorthShowing("forbidden: loopback host required (pair this device to use the server remotely)")).toBeNull();
    expect(reasonWorthShowing("403")).toBeNull();
    expect(reasonWorthShowing(undefined)).toBeNull();
    expect(reasonWorthShowing("unauthorized: this session has expired or was revoked; pair this device again")).toMatch(/expired or was revoked/);
  });
});

describe("the invited address on a pair link", () => {
  it("prefills a valid address, drops it from the address bar, and ignores junk", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", { search: "?email=Ada%40Example.test&x=1", pathname: "/pair", hash: "#code=ABCD" });
    vi.stubGlobal("history", { replaceState });
    expect(takeInvitedEmailFromLocation()).toBe("ada@example.test");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair?x=1#code=ABCD");
    vi.stubGlobal("location", { search: "?email=not-an-address", pathname: "/pair", hash: "" });
    expect(takeInvitedEmailFromLocation()).toBeNull();
    vi.stubGlobal("location", { search: "", pathname: "/pair", hash: "" });
    expect(takeInvitedEmailFromLocation()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("the Nordus Cloud page's \"Use in your browser\" link", () => {
  const credential = `nordus_pair_${"b".repeat(43)}`;
  it("is taken off the address bar and out of history before anything renders, whatever it carries", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("location", { pathname: "/pair", search: "", hash: `#signin=${credential}` });
    expect(takeBrowserSignInFromLocation()).toBe(credential);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair");
    replaceState.mockClear();
    vi.stubGlobal("location", { pathname: "/pair", search: "", hash: "#signin=ABCD-EFGH-JKLM" });
    expect(takeBrowserSignInFromLocation()).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair");
    replaceState.mockClear();
    vi.stubGlobal("location", { pathname: "/pair", search: "", hash: "#code=ABCD-EFGH-JKLM" });
    expect(takeBrowserSignInFromLocation()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
    expect(takePairingCodeFromLocation()).toBe("ABCD-EFGH-JKLM");
    vi.unstubAllGlobals();
  });

  it("shows whose Cloud it is first, asking only to look, and treats anything else as spent", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = (status: number, body: unknown) => (async (path: string, init?: RequestInit) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    expect(await previewBrowserSignIn(credential, server(200, { owner: "ada@example.test", expiresAt: 1 }))).toEqual({ owner: "ada@example.test" });
    expect(requests).toEqual([{ path: "/api/auth/pair", body: { code: credential, browser: true, preview: true } }]);
    expect(await previewBrowserSignIn(credential, server(401, { error: "expired" }))).toBeNull();
    expect(await previewBrowserSignIn(credential, server(200, { owner: "" }))).toBeNull();
    expect(await previewBrowserSignIn(credential, server(200, { owner: 7 }))).toBeNull();
    expect(await previewBrowserSignIn(credential, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });

  it("on Continue is always redeemed into this browser's cookie, connected or not, with the page's one attempt id", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = (async (path: string, init?: RequestInit) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (path === "/api/auth/session") return new Response(JSON.stringify({ kind: "session", id: "s", label: "Chrome on Mac", scopes: ["client"], expiresAt: 1 }), { status: 200 });
      return new Response(JSON.stringify({ session: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await signInWithBrowserGrant(credential, "attempt-page-0001", server)).toEqual({ ok: true });
    expect(await signInWithBrowserGrant(credential, "attempt-page-0001", server)).toEqual({ ok: true });
    expect(requests.map((r) => r.path)).toEqual(["/api/auth/pair", "/api/auth/pair"]);
    for (const request of requests) expect(request.body).toMatchObject({ code: credential, cookie: true, browser: true, attemptId: "attempt-page-0001" });
    const spent = (async () => new Response(JSON.stringify({ error: "pairing code is wrong or has expired" }), { status: 401 })) as unknown as typeof fetch;
    expect(await signInWithBrowserGrant(credential, "attempt-page-0002", spent)).toEqual({ ok: false, error: "pairing code is wrong or has expired" });
    expect(reasonWorthShowing(BROWSER_SIGN_IN_FAILED)).toBe(BROWSER_SIGN_IN_FAILED);
  });

  it("names the Cloud's owner afterwards only for a browser sign-in's session on a Cloud home", () => {
    expect(cloudOwnerOf({ kind: "session", cloudHome: true, owner: "ada@example.test" })).toBe("ada@example.test");
    for (const session of [{ kind: "session", owner: "ada@example.test" }, { kind: "session", cloudHome: true }, { kind: "loopback" },
      { cloudHome: true, owner: 7 }, { cloudHome: "yes", owner: "ada@example.test" }, null, undefined]) expect(cloudOwnerOf(session)).toBeNull();
  });
});

describe("who the served UI is on its own machine", () => {
  const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it("keeps the key a shared workspace gives this session's reactions, and nothing else in its place", async () => {
    const shared = { kind: "session", id: "s", label: "Ada's laptop", scopes: ["client"], expiresAt: 1 };
    expect(await readSessionState(answer({ ...shared, reactor: "p_ada" }))).toEqual({ ...shared, reactor: "p_ada" });
    expect(await readSessionState(answer({ ...shared, reactor: 7 }))).toEqual(shared);
    expect(await readSessionState(answer(shared))).toEqual(shared);
  });
  it("keeps the person the server says this session is, and only a well-formed one", async () => {
    const shared = { kind: "session", id: "s", label: "Chrome on Mac", scopes: ["admin", "client"], expiresAt: 1 };
    const owner = { name: "Avery", email: "avery@example.test", avatarUrl: "/api/attachments/a-1.png", owner: true };
    expect(await readSessionState(answer({ ...shared, person: owner }))).toEqual({ ...shared, person: owner });
    const google = { name: "Maria Souza", avatarUrl: "https://lh3.googleusercontent.com/a/x=s96-c" };
    expect(await readSessionState(answer({ ...shared, person: google }))).toEqual({ ...shared, person: google });
    expect(await readSessionState(answer({ ...shared, person: { name: "Avery", avatarUrl: "javascript:alert(1)", owner: "yes" } }))).toEqual({ ...shared, person: { name: "Avery" } });
    expect(await readSessionState(answer({ ...shared, person: { email: "avery@example.test" } }))).toEqual(shared);
    expect(await readSessionState(answer({ ...shared, person: "Avery" }))).toEqual(shared);
  });
  it("is the owner on loopback unless the server says local requests are only a service", async () => {
    const owner = await readSessionState(answer({ kind: "loopback", scopes: ["admin", "client"] }));
    expect(owner).toEqual({ kind: "loopback" });
    expect(isOwnerOrAdmin(owner)).toBe(true);
    const service = await readSessionState(answer({ kind: "loopback", scopes: ["client"], trust: "service" }));
    expect(service).toEqual({ kind: "loopback", trust: "service" });
    expect(isOwnerOrAdmin(service)).toBe(false);
    expect(isOwnerOrAdmin({ kind: "session", id: "s", label: "l", scopes: ["client"], expiresAt: 1 })).toBe(false);
    expect(isOwnerOrAdmin({ kind: "session", id: "s", label: "l", scopes: ["admin", "client"], expiresAt: 1 })).toBe(true);
    expect(isOwnerOrAdmin(null)).toBe(false);
  });
});

describe("an SSH tunnel to a server that treats local requests as a service", () => {
  it("is not connected, so the app sends it to sign in, and says why", () => {
    expect(isConnected({ kind: "loopback" })).toBe(true);
    expect(isConnected({ kind: "loopback", trust: "service" })).toBe(false);
    expect(isConnected({ kind: "session", id: "s", label: "l", scopes: ["client"], expiresAt: 1 })).toBe(true);
    expect(isConnected({ kind: "unauthenticated", error: "pair" })).toBe(false);
    expect(isConnected(null)).toBe(false);
    expect(reasonWorthShowing(SERVICE_TRUST_REASON)).toBe(SERVICE_TRUST_REASON);
  });
});

describe("one session request for the whole page", () => {
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  beforeEach(() => invalidateSession());

  it("turns simultaneous callers into one fetch", async () => {
    const fetchImpl = reply({ kind: "session", id: "s", label: "Mac", scopes: ["admin"], expiresAt: 1 });
    const [a, b, c, d, e] = await Promise.all([1, 2, 3, 4, 5].map(() => sessionOnce(false, fetchImpl)));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([b, c, d, e]).toEqual([a, a, a, a]);
    await sessionOnce(false, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("forgets a rejected request and asks again", async () => {
    const failing = vi.fn(async () => ({ get status(): number { throw new Error("boom"); }, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(sessionOnce(false, failing)).rejects.toThrow("boom");
    const ok = reply({ kind: "loopback" });
    expect(await sessionOnce(false, ok)).toEqual({ kind: "loopback" });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("asks again when forced or invalidated, and keeps the raw answer for the readers that need it", async () => {
    const fetchImpl = reply({ kind: "session", id: "s", label: "", scopes: ["client"], expiresAt: 1, cloudHome: true, owner: "ada@example.test" });
    await sessionOnce(false, fetchImpl);
    await sessionOnce(true, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    invalidateSession();
    expect(cloudOwnerOf(await sessionBodyOnce(false, fetchImpl))).toBe("ada@example.test");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("lets the page that already knows seed the answer, and refuses the raw body of a signed-out visitor", async () => {
    const fetchImpl = reply({}, 401);
    seedSession({ kind: "loopback" });
    expect(await sessionOnce(false, fetchImpl)).toEqual({ kind: "loopback" });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(sessionBodyOnce(true, fetchImpl)).rejects.toThrow();
  });

  it("is dropped by a successful pairing", async () => {
    const fetchImpl = reply({ kind: "loopback" });
    await sessionOnce(false, fetchImpl);
    const paired = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await pairWithCode({ code: "c", label: "l" }, paired);
    await sessionOnce(false, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("the invite link's token", () => {
  it("is taken off the address bar and ignored when malformed", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("location", { search: "?join=abcdEFGH12345678&x=1", pathname: "/pair", hash: "" });
    expect(takeJoinTokenFromLocation()).toBe("abcdEFGH12345678");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair?x=1");
    vi.stubGlobal("location", { search: "?join=a%20b", pathname: "/pair", hash: "" });
    expect(takeJoinTokenFromLocation()).toBeNull();
    vi.stubGlobal("location", { search: "", pathname: "/pair", hash: "" });
    expect(takeJoinTokenFromLocation()).toBeNull();
  });
});

describe("email sign-in through an invite link", () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const sentBody = (fetchImpl: typeof fetch) => JSON.parse(String((vi.mocked(fetchImpl).mock.calls[0]![1] as RequestInit).body));

  it("sends the token only when there is one", async () => {
    const withToken = reply(200, {});
    await startEmailSignIn("ada@example.test", "tok12345", withToken);
    expect(sentBody(withToken)).toEqual({ email: "ada@example.test", joinToken: "tok12345" });
    const without = reply(200, {});
    await verifyEmailSignIn({ email: "ada@example.test", code: "12345678", label: "Mac" }, without);
    expect(sentBody(without)).toEqual({ email: "ada@example.test", code: "12345678", label: "Mac" });
  });

  it("reports a request waiting for approval without treating it as a session", async () => {
    const result = await verifyEmailSignIn({ email: "ada@example.test", code: "12345678", label: "Mac", joinToken: "tok12345" }, reply(202, { pending: true, email: "ada@example.test" }));
    expect(result).toEqual({ ok: true, pending: true });
  });
});
