import { describe, expect, it } from "vitest";
import { deviceLabel, labelFromUserAgent } from "./request-auth.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("device names", () => {
  it("names a phone after its owner, in Portuguese", () => {
    expect(labelFromUserAgent(IPHONE, "Avery Mercer")).toBe("iPhone de Avery");
    expect(labelFromUserAgent(MAC, "Avery")).toBe("Mac de Avery");
  });

  it("falls back to the browser and the system without an owner", () => {
    expect(labelFromUserAgent(MAC)).toBe("Safari no Mac");
    expect(labelFromUserAgent(undefined)).toBe("Aparelho sem nome");
  });

  it("replaces an English phone label an older client sent, and keeps a name the person chose", () => {
    expect(deviceLabel("Test on iPhone", IPHONE, "Avery")).toBe("iPhone de Avery");
    expect(deviceLabel("", IPHONE, "Avery")).toBe("iPhone de Avery");
    expect(deviceLabel("iPhone da Jordan", IPHONE, "Avery")).toBe("iPhone da Jordan");
  });
});
