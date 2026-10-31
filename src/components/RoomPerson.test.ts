// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RoomPerson } from "./RoomPerson";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "/api/attachments/avery-1.png";
const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";
let host: HTMLDivElement;
let root: Root;
const show = (person: Parameters<typeof RoomPerson>[0]["person"]) =>
  act(async () => root.render(createElement(RoomPerson, { person }, createElement("p", { "data-bubble": "" }, "hello"))));

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the person above a line in a room", () => {
  it("shows the name, the photo and the line itself", async () => {
    await show({ name: "Avery", email: "avery@example.test", avatarUrl: PHOTO });
    expect(host.querySelector("[data-room-person-name]")?.textContent).toBe("Avery");
    expect(host.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
    expect(host.querySelector("[title='avery@example.test']")).not.toBeNull();
    expect(host.querySelector("[data-bubble]")?.textContent).toBe("hello");
  });

  it("takes a Google photo as it is, without telling Google which page asked", async () => {
    await show({ name: "Maria Souza", avatarUrl: GOOGLE });
    const image = host.querySelector("img")!;
    expect(image.getAttribute("src")).toBe(GOOGLE);
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("shows the initials when there is no photo", async () => {
    await show({ name: "Maria Souza" });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[data-room-person] span")?.textContent).toBe("MS");
  });

  it("falls back to the initials when the photo does not load", async () => {
    await show({ name: "Avery", avatarUrl: PHOTO });
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[data-room-person] span")?.textContent).toBe("A");
    expect(host.querySelector("[data-bubble]")?.textContent).toBe("hello");
  });

  it("shows the initials for an address that is neither the owner's attachment nor https", async () => {
    for (const avatarUrl of ["javascript:alert(1)", "http://lh3.googleusercontent.com/a.png", "data:image/png;base64,AAAA", "//evil.test/a.png"]) {
      await show({ name: "Maria Souza", avatarUrl });
      expect(host.querySelector("img"), avatarUrl).toBeNull();
    }
  });
});
