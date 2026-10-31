import { describe, expect, it } from "vitest";

import { allowedScopes, createEmailSignIn, isGuestEmail, roleOfEmail, signInEnabled } from "./account-signin.ts";
import { startControlPlaneStub } from "./testing/control-plane-stub.ts";

const list = { admins: ["boss@x.test", "@agency.test"], members: ["ana@x.test", "@team.test"], guests: ["gus@x.test", "@clients.test"] };

describe("the role an address has on the sign-in list", () => {
  it("names admin, member or guest, ignoring case", () => {
    expect(roleOfEmail("BOSS@x.test", list)).toBe("admin");
    expect(roleOfEmail("any@agency.test", list)).toBe("admin");
    expect(roleOfEmail("ana@x.test", list)).toBe("member");
    expect(roleOfEmail("any@team.test", list)).toBe("member");
    expect(roleOfEmail("Gus@x.test", list)).toBe("guest");
    expect(roleOfEmail("cliente@clients.test", list)).toBe("guest");
    expect(roleOfEmail("stranger@x.test", list)).toBeNull();
    expect(roleOfEmail("no at sign", list)).toBeNull();
  });

  it("gives a person on two lists the wider role", () => {
    const both = { admins: ["a@x.test"], members: ["a@x.test", "b@x.test"], guests: ["a@x.test", "b@x.test", "c@x.test"] };
    expect(roleOfEmail("a@x.test", both)).toBe("admin");
    expect(roleOfEmail("b@x.test", both)).toBe("member");
    expect(roleOfEmail("c@x.test", both)).toBe("guest");
  });

  it("never lets a look-alike domain in", () => {
    expect(roleOfEmail("x@evilclients.test", list)).toBeNull();
    expect(roleOfEmail("x@clients.test.evil", list)).toBeNull();
    expect(roleOfEmail("@clients.test", list)).toBeNull();
  });

  it("gives a guest the chat scope and no more", () => {
    expect(allowedScopes("gus@x.test", list)).toEqual(["client"]);
    expect(allowedScopes("boss@x.test", list)).toEqual(["admin", "client"]);
    expect(allowedScopes("stranger@x.test", list)).toBeNull();
    expect(isGuestEmail("gus@x.test", list)).toBe(true);
    expect(isGuestEmail("ana@x.test", list)).toBe(false);
    expect(isGuestEmail("boss@x.test", list)).toBe(false);
    expect(isGuestEmail("stranger@x.test", list)).toBe(false);
  });

  it("counts a list with only guests as sign-in being on, and a list without guests as before", () => {
    expect(signInEnabled({ admins: [], members: [], guests: ["g@x.test"] })).toBe(true);
    expect(signInEnabled({ admins: [], members: [] })).toBe(false);
    expect(allowedScopes("ana@x.test", { admins: [], members: ["ana@x.test"] })).toEqual(["client"]);
    expect(roleOfEmail("ana@x.test", { admins: [], members: ["ana@x.test"] })).toBe("member");
  });
});

describe("the sign-in exchange", () => {
  it("lets a guest in as a guest and marks nobody else", async () => {
    const stub = await startControlPlaneStub();
    try {
      const signIn = createEmailSignIn({ allow: list, env: { ...process.env, NORDUS_CONTROL_PLANE_URL: stub.url } });
      expect(await signIn.start("gus@x.test")).toEqual({ ok: true });
      const guest = await signIn.verify("gus@x.test", stub.otp);
      expect(guest).toMatchObject({ ok: true, email: "gus@x.test", scopes: ["client"], guest: true });
      const member = await signIn.verify("ana@x.test", stub.otp);
      expect(member).toMatchObject({ ok: true, scopes: ["client"] });
      expect(member).not.toHaveProperty("guest");
      const admin = await signIn.verify("boss@x.test", stub.otp);
      expect(admin).toMatchObject({ ok: true, scopes: ["admin", "client"] });
      expect(admin).not.toHaveProperty("guest");
    } finally {
      await stub.close();
    }
  });
});
