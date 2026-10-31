// @vitest-environment happy-dom
// A guest never asks for the app automations, which the server keeps from guests.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  session: { kind: "session", id: "s", label: "", scopes: ["client"], expiresAt: 1 } as Record<string, unknown>,
  api: vi.fn(async () => ({ triggers: [], attempts: [], service: null })),
  listen: vi.fn(() => () => {}),
}));
vi.mock("@/state/store", () => ({ api: fixture.api }));
vi.mock("@/lib/live-events", () => ({ listenLiveFrames: fixture.listen }));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/session")>(),
  sessionOnce: async () => fixture.session,
}));

const mountOnce = async () => {
  vi.resetModules();
  const { useAppTriggers } = await import("./app-triggers");
  const Probe = () => { useAppTriggers(); return null; };
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(createElement(Probe)));
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => root.unmount());
};

beforeEach(() => {
  fixture.api.mockClear();
  fixture.listen.mockClear();
});

describe("the app automations", () => {
  it("are loaded and followed for a member", async () => {
    fixture.session = { kind: "session", id: "s", label: "", scopes: ["client"], expiresAt: 1, email: "bia@acme.test" };
    await mountOnce();
    expect(fixture.api).toHaveBeenCalledWith("/api/app-triggers");
    expect(fixture.listen).toHaveBeenCalledTimes(1);
  });

  it("are neither loaded nor followed for a guest", async () => {
    fixture.session = { kind: "session", id: "s", label: "", scopes: ["client"], expiresAt: 1, email: "gil@acme.test", guest: true };
    await mountOnce();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.listen).not.toHaveBeenCalled();
  });
});
