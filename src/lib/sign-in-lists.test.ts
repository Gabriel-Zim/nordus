import { describe, expect, it } from "vitest";

import { normalizeAccessEntry, readSignInLists, withEntries, withEntry, withoutEntry } from "./sign-in-lists";

describe("the three sign-in lists", () => {
  it("accepts an address or an @domain and nothing else", () => {
    expect(normalizeAccessEntry(" Her@Example.com ")).toBe("her@example.com");
    expect(normalizeAccessEntry("@Agentada.cc")).toBe("@agentada.cc");
    expect(normalizeAccessEntry("nope")).toBeNull();
  });

  it("leaves the guests key out while nobody knows about guests", () => {
    const start = { admins: ["a@x.com"], members: ["b@x.com"] };
    expect(withEntry(start, "c@x.com", "member")).toEqual({ admins: ["a@x.com"], members: ["b@x.com", "c@x.com"] });
    expect(withoutEntry(start, "a@x.com")).toEqual({ admins: [], members: ["b@x.com"] });
  });

  it("moves an address into guests and out of the other lists", () => {
    const start = { admins: ["a@x.com"], members: ["b@x.com"] };
    expect(withEntry(start, "b@x.com", "guest")).toEqual({ admins: ["a@x.com"], members: [], guests: ["b@x.com"] });
    expect(withEntry(start, "a@x.com", "guest")).toEqual({ admins: [], members: ["b@x.com"], guests: ["a@x.com"] });
  });

  it("moves a guest to another role without leaving a copy behind", () => {
    const start = { admins: [], members: [], guests: ["g@x.com", "h@x.com"] };
    expect(withEntry(start, "g@x.com", "member")).toEqual({ admins: [], members: ["g@x.com"], guests: ["h@x.com"] });
    expect(withEntry(start, "h@x.com", "admin")).toEqual({ admins: ["h@x.com"], members: [], guests: ["g@x.com"] });
  });

  it("removes an address from every list", () => {
    expect(withoutEntry({ admins: ["a@x.com"], members: ["b@x.com"], guests: ["g@x.com"] }, "g@x.com")).toEqual({ admins: ["a@x.com"], members: ["b@x.com"], guests: [] });
  });

  it("adds several addresses at once with one role", () => {
    expect(withEntries({ admins: [], members: ["a@x.com"] }, ["b@x.com", "@y.com"], "guest")).toEqual({ admins: [], members: ["a@x.com"], guests: ["b@x.com", "@y.com"] });
  });

  it("reads the guests list from the config only when the server sent one", () => {
    expect(readSignInLists({ signIn: { admins: ["a@x.com"], members: ["b@x.com"] } })).toEqual({ admins: ["a@x.com"], members: ["b@x.com"] });
    expect(readSignInLists({ signIn: { admins: [], members: [], guests: ["g@x.com"] } })).toEqual({ admins: [], members: [], guests: ["g@x.com"] });
    expect(readSignInLists({ signIn: { admins: [], members: [], guests: [] } })).toEqual({ admins: [], members: [], guests: [] });
    expect(readSignInLists(null)).toEqual({ admins: [], members: [] });
  });
});
