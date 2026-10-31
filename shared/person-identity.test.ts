import { describe, expect, it } from "vitest";
import { MAX_PHOTO_URL, fromOwnerDevice, httpsPhotoUrl, personPhotoUrl } from "./person-identity.ts";

const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";

describe("httpsPhotoUrl", () => {
  it("keeps an https address and nothing else", () => {
    expect(httpsPhotoUrl(GOOGLE)).toBe(GOOGLE);
    for (const bad of ["http://lh3.googleusercontent.com/a.png", "//lh3.googleusercontent.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "/api/attachments/a.png", "", "not a url"]) {
      expect(httpsPhotoUrl(bad), bad).toBeUndefined();
    }
    for (const bad of [undefined, null, 7, {}]) expect(httpsPhotoUrl(bad)).toBeUndefined();
  });

  it("refuses credentials, whitespace, control characters and an address past the bound", () => {
    expect(httpsPhotoUrl("https://user:pass@lh3.googleusercontent.com/a.png")).toBeUndefined();
    expect(httpsPhotoUrl("https://lh3.googleusercontent.com/a b.png")).toBeUndefined();
    expect(httpsPhotoUrl("https://lh3.googleusercontent.com/a\n.png")).toBeUndefined();
    const long = `https://lh3.googleusercontent.com/${"a".repeat(MAX_PHOTO_URL)}`;
    expect(httpsPhotoUrl(long)).toBeUndefined();
    const fits = `https://lh3.googleusercontent.com/${"a".repeat(MAX_PHOTO_URL - "https://lh3.googleusercontent.com/".length)}`;
    expect(fits).toHaveLength(MAX_PHOTO_URL);
    expect(httpsPhotoUrl(fits)).toBe(fits);
  });
});

describe("personPhotoUrl", () => {
  it("takes the owner's stored attachment or an https address", () => {
    expect(personPhotoUrl("/api/attachments/3f2a-91.png")).toBe("/api/attachments/3f2a-91.png");
    expect(personPhotoUrl(GOOGLE)).toBe(GOOGLE);
  });

  it("refuses a script-capable image, another path and a bare host", () => {
    for (const bad of ["/api/attachments/x.svg", "/api/other/x.png", "//evil.test/x.png", "http://evil.test/x.png", "data:image/svg+xml,<svg/>"]) {
      expect(personPhotoUrl(bad), bad).toBeUndefined();
    }
    expect(personPhotoUrl(undefined)).toBeUndefined();
  });
});

describe("fromOwnerDevice", () => {
  it("is a sender with the admin stamp and no address", () => {
    expect(fromOwnerDevice({ admin: true })).toBe(true);
    expect(fromOwnerDevice({ admin: true, email: "   " })).toBe(true);
  });

  it("is not a person with an address, nor a device without the admin stamp", () => {
    expect(fromOwnerDevice({ admin: true, email: "avery@example.test" })).toBe(false);
    expect(fromOwnerDevice({})).toBe(false);
    expect(fromOwnerDevice({ email: "ana@example.test" })).toBe(false);
    expect(fromOwnerDevice(undefined)).toBe(false);
  });
});
