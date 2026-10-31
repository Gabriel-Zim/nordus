import { describe, expect, it } from "vitest";
import { takeAccountsRequest } from "./accounts-link";

describe("the ?desktop-settings=contas request", () => {
  it("is taken once and leaves the rest of the address", () => {
    expect(takeAccountsRequest("http://127.0.0.1:8899/?desktop-settings=contas")).toBe("/");
    expect(takeAccountsRequest("http://127.0.0.1:8899/?a=1&desktop-settings=contas#x")).toBe("/?a=1#x");
    expect(takeAccountsRequest("http://127.0.0.1:8899/?desktop-settings=phone")).toBeNull();
    expect(takeAccountsRequest("http://127.0.0.1:8899/")).toBeNull();
  });
});
