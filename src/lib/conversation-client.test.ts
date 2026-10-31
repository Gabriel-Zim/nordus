import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { activeClientLabel, forgetClients, preloadClients, roomClientOptions } from "./conversation-client";

const clients = [
  { slug: "evergreen", name: "Evergreen Capital" },
  { slug: "fabrikam", name: "Fabrikam" },
];

describe("activeClientLabel", () => {
  it("shows a room's own client, whatever its conversation named", () => {
    expect(activeClientLabel({ group: { client: "evergreen" }, groupTask: { clients: ["fabrikam"] } }, clients)).toBe("Cliente: Evergreen Capital");
  });

  it("falls back to the clients a room conversation named, joined", () => {
    expect(activeClientLabel({ group: {}, groupTask: { clients: ["evergreen", "fabrikam"] } }, clients)).toBe("Cliente: Evergreen Capital + Fabrikam");
    expect(activeClientLabel({ group: { client: null }, groupTask: { clients: ["fabrikam"] } }, clients)).toBe("Cliente: Fabrikam");
  });

  it("reads a direct chat's clients from its open conversation, never a room's", () => {
    expect(activeClientLabel({ task: { clients: ["fabrikam"] } }, clients)).toBe("Cliente: Fabrikam");
    expect(activeClientLabel({ group: {}, task: { clients: ["fabrikam"] } }, clients)).toBeNull();
  });

  it("names an unlisted client by its slug in caps", () => {
    expect(activeClientLabel({ task: { clients: ["lumon"] } }, [])).toBe("Cliente: LUMON");
  });

  it("shows nothing without a client", () => {
    expect(activeClientLabel({ group: {}, groupTask: {} }, clients)).toBeNull();
    expect(activeClientLabel({ task: { clients: [] } }, clients)).toBeNull();
    expect(activeClientLabel({}, clients)).toBeNull();
  });
});

describe("roomClientOptions", () => {
  it("keeps the listed clients and adds the room's own when the list lacks it", () => {
    expect(roomClientOptions("evergreen", clients)).toEqual(clients);
    expect(roomClientOptions("lumon", clients)).toEqual([...clients, { slug: "lumon", name: "LUMON" }]);
    expect(roomClientOptions(null, [])).toEqual([]);
  });
});

describe("preloadClients", () => {
  beforeEach(() => {
    forgetClients();
    fixture.api.mockReset();
  });

  it("asks the server once per session and drops malformed rows", async () => {
    fixture.api.mockResolvedValue({ clients: [...clients, { slug: "", name: "Vazio" }, { name: "Sem slug" }] });
    expect(await Promise.all([preloadClients(), preloadClients()])).toEqual([clients, clients]);
    expect(await preloadClients()).toEqual(clients);
    expect(fixture.api).toHaveBeenCalledTimes(1);
    expect(fixture.api).toHaveBeenCalledWith("/api/clients");
  });

  it("asks again after a failure instead of keeping an empty list", async () => {
    fixture.api.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ clients });
    expect(await preloadClients()).toEqual([]);
    expect(await preloadClients()).toEqual(clients);
  });
});
