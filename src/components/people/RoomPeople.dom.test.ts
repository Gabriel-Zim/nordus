// @vitest-environment happy-dom
// The People section of a channel in a real DOM: choosing, saving and the request each choice sends.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryPerson } from "../../../shared/people";
import type { Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  viewer: { admin: true, guest: false, email: "root@acme.test" } as { admin: boolean; guest: boolean; email?: string },
  requests: [] as Array<{ path: string; method?: string; body?: unknown }>,
  answer: (_body: unknown): unknown => ({}),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: {}, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/use-viewer", () => ({ useViewer: () => fixture.viewer, useGuest: () => fixture.viewer.guest }));
vi.mock("@/state/api", () => ({
  api: async (path: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fixture.requests.push({ path, method: init?.method, body });
    const result = fixture.answer(body);
    if (result instanceof Error) throw result;
    return result;
  },
}));
const directory: DirectoryPerson[] = [
  { email: "ana@acme.test", name: "Ana", role: "member" },
  { email: "bia@acme.test", name: "Bia", role: "member" },
  { email: "caio@acme.test", name: "Caio", role: "member" },
  { email: "root@acme.test", name: "Root", role: "admin" },
];
vi.mock("@/state/people-directory", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/people-directory")>(),
  useDirectory: () => ({ loaded: true, people: directory }),
}));

const { RoomPeople } = await import("./RoomPeople");

const group = (extra: Partial<Group> = {}) => ({ id: "r1", name: "Projeto", threadId: "t1", createdBy: "ana@acme.test", ...extra }) as unknown as Group;
let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const show = (value: Group) => flushSync(() => root.render(createElement(RoomPeople, { group: value })));
const click = (selector: string) => {
  const element = host.querySelector(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
};

beforeEach(() => {
  fixture.dispatch.mockReset();
  fixture.requests = [];
  fixture.answer = (body) => ({ group: { id: "r1", threadId: "t1", people: (body as { people: string[] | null }).people ?? undefined } });
  fixture.viewer = { admin: true, guest: false, email: "root@acme.test" };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("limiting a channel to some people", () => {
  it("sends the people picked, and takes the channel the server answers with", async () => {
    show(group());
    click("[data-room-limit]");
    click('[data-person="bia@acme.test"]');
    click('[data-person="caio@acme.test"]');
    click("[data-room-limit-save]");
    await settle();
    expect(fixture.requests).toEqual([{ path: "/api/people/rooms/r1/people", method: "PUT", body: { people: ["bia@acme.test", "caio@acme.test"] } }]);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "groupPatched", group: { id: "r1", threadId: "t1", people: ["bia@acme.test", "caio@acme.test"] } });
  });

  it("takes a person back out of the pick, and with nobody picked sends only whoever opened the channel", async () => {
    show(group());
    click("[data-room-limit]");
    click('[data-person="bia@acme.test"]');
    click('[data-person="bia@acme.test"]');
    expect(host.textContent).toContain("With nobody picked, only you are in.");
    click("[data-room-limit-save]");
    await settle();
    expect(fixture.requests[0]!.body).toEqual({ people: ["ana@acme.test"] });
  });

  it("changes nothing when the choice is cancelled", () => {
    show(group());
    click("[data-room-limit]");
    expect(host.querySelector("[data-people-picker]")).not.toBeNull();
    const cancel = [...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!;
    flushSync(() => cancel.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(host.querySelector("[data-people-picker]")).toBeNull();
    expect(fixture.requests).toEqual([]);
  });
});

describe("changing a limited channel", () => {
  const limited = group({ people: ["ana@acme.test", "bia@acme.test"] });

  it("removes a person, keeping the rest", async () => {
    show(limited);
    click('[data-room-remove-person="bia@acme.test"]');
    await settle();
    expect(fixture.requests).toEqual([{ path: "/api/people/rooms/r1/people", method: "PUT", body: { people: ["ana@acme.test"] } }]);
  });

  it("adds a person from those who are not in yet", async () => {
    show(limited);
    click("[data-room-add-person]");
    expect(host.querySelector('[data-person="ana@acme.test"]')).toBeNull();
    click('[data-person="caio@acme.test"]');
    await settle();
    expect(fixture.requests[0]!.body).toEqual({ people: ["ana@acme.test", "bia@acme.test", "caio@acme.test"] });
  });

  it("opens the channel to everyone again with a null list", async () => {
    show(limited);
    click("[data-room-open-to-all]");
    await settle();
    expect(fixture.requests[0]!.body).toEqual({ people: null });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "groupPatched", group: { id: "r1", threadId: "t1", people: undefined } });
  });

  it("shows what the server said when it refuses, and does not touch the channel", async () => {
    fixture.answer = () => new Error("only an admin or the person who opened this channel chooses who is in it");
    show(limited);
    click("[data-room-remove-person='bia@acme.test']");
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("only an admin or the person who opened this channel");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("leaves a member who did not open it with nothing to click", () => {
    fixture.viewer = { admin: false, guest: false, email: "bia@acme.test" };
    show(limited);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});
