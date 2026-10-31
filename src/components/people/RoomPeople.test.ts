import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryPerson } from "../../../shared/people";
import type { Viewer } from "@/lib/viewer";
import type { Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  viewer: { admin: false, guest: false } as { admin: boolean; guest: boolean; email?: string },
  people: [] as Array<{ email: string; name: string; role: string }>,
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: {}, dispatch: () => {} }) }));
vi.mock("@/lib/use-viewer", () => ({ useViewer: () => fixture.viewer, useGuest: () => fixture.viewer.guest }));
vi.mock("@/state/people-directory", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/people-directory")>(),
  useDirectory: () => ({ loaded: true, people: fixture.people }),
}));
import { RoomPeople } from "./RoomPeople";

const directory: DirectoryPerson[] = [
  { email: "ana@acme.test", name: "Ana Paula", role: "member" },
  { email: "bia@acme.test", name: "Bia", role: "member" },
  { email: "caio@acme.test", name: "Caio", role: "admin" },
  { email: "gil@acme.test", name: "Gil", role: "guest" },
];
const room = (extra: Partial<Group> = {}) => ({ id: "r1", name: "Projeto", ...extra }) as unknown as Group;
const render = (group: Group, viewer: Viewer) => {
  fixture.viewer = viewer;
  return renderToStaticMarkup(createElement(RoomPeople, { group }));
};
const hasControl = (html: string, name: string) => html.includes(name);

beforeEach(() => {
  fixture.people = directory;
});

describe("the People section of a channel", () => {
  it("says everyone on the team is in the general channel, with nothing to change even for an admin", () => {
    const html = render(room({ general: true }), { admin: true, guest: false, email: "caio@acme.test" });
    expect(html).toContain("Everyone on the team");
    expect(html).toContain("The General channel is always open to the whole team.");
    for (const control of ["data-room-limit", "data-room-add-person", "data-room-open-to-all", "data-room-remove-person"]) expect(hasControl(html, control)).toBe(false);
  });

  it("says everyone on the team is in a channel with no list, and lets an admin limit it", () => {
    const html = render(room({ createdBy: "ana@acme.test" }), { admin: true, guest: false, email: "caio@acme.test" });
    expect(html).toContain("Everyone on the team");
    expect(html).toContain("Everyone on the team can see and write in this channel.");
    expect(html).toContain("data-room-limit");
    expect(html).toContain("Limit to some people");
  });

  it("lets whoever opened the channel limit it", () => {
    expect(render(room({ createdBy: "ana@acme.test" }), { admin: false, guest: false, email: "ana@acme.test" })).toContain("data-room-limit");
  });

  it("shows another member the channel without a way to change it", () => {
    const html = render(room({ createdBy: "ana@acme.test" }), { admin: false, guest: false, email: "bia@acme.test" });
    expect(html).toContain("Everyone on the team");
    expect(hasControl(html, "data-room-limit")).toBe(false);
  });

  it("lists the people of a limited channel by name, with their addresses", () => {
    const html = render(room({ people: ["ana@acme.test", "bia@acme.test"], createdBy: "ana@acme.test" }), { admin: false, guest: false, email: "bia@acme.test" });
    expect(html).toContain("Ana Paula");
    expect(html).toContain("ana@acme.test");
    expect(html).toContain("Only these people can see and write in this channel.");
    expect(html).not.toContain("Caio");
    expect(html).toContain(">you<");
  });

  it("shows an address that left the directory under the name it suggests", () => {
    const html = render(room({ people: ["ana@acme.test", "maria.souza@elsewhere.test"], createdBy: "ana@acme.test" }), { admin: false, guest: false, email: "ana@acme.test" });
    expect(html).toContain("Maria Souza");
    expect(html).toContain("maria.souza@elsewhere.test");
  });

  it("gives an admin a way to add, remove and open the channel up again, but not to remove who opened it", () => {
    const html = render(room({ people: ["ana@acme.test", "bia@acme.test"], createdBy: "ana@acme.test" }), { admin: true, guest: false, email: "caio@acme.test" });
    expect(html).toContain("data-room-add-person");
    expect(html).toContain("data-room-open-to-all");
    expect(html).toContain('data-room-remove-person="bia@acme.test"');
    expect(html).not.toContain('data-room-remove-person="ana@acme.test"');
  });

  it("gives whoever opened the channel the same controls", () => {
    const html = render(room({ people: ["ana@acme.test", "bia@acme.test"], createdBy: "ana@acme.test" }), { admin: false, guest: false, email: "ana@acme.test" });
    expect(html).toContain("data-room-add-person");
    expect(html).toContain('data-room-remove-person="bia@acme.test"');
  });

  it("gives no controls to another member, nor to a guest who is in", () => {
    const group = room({ people: ["ana@acme.test", "gil@acme.test"], createdBy: "ana@acme.test" });
    for (const viewer of [{ admin: false, guest: false, email: "bia@acme.test" }, { admin: false, guest: true, email: "gil@acme.test" }]) {
      const html = render(group, viewer);
      expect(html).toContain("Gil");
      for (const control of ["data-room-limit", "data-room-add-person", "data-room-open-to-all", "data-room-remove-person"]) expect(hasControl(html, control)).toBe(false);
    }
  });

  it("marks a guest in the list as a guest", () => {
    const html = render(room({ people: ["ana@acme.test", "gil@acme.test"], createdBy: "ana@acme.test" }), { admin: false, guest: false, email: "ana@acme.test" });
    expect(html).toContain("Guest");
  });

  it("offers no add button when everyone is already in", () => {
    fixture.people = directory.slice(0, 2);
    const html = render(room({ people: ["ana@acme.test", "bia@acme.test"], createdBy: "ana@acme.test" }), { admin: false, guest: false, email: "ana@acme.test" });
    expect(hasControl(html, "data-room-add-person")).toBe(false);
  });
});
