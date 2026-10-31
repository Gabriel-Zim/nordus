import { describe, expect, it } from "vitest";
import { knownContactsText } from "./approval-contacts.ts";

const line = (extra: Record<string, unknown>) => ({ role: "user" as const, text: "ana@cliente.com", ...extra });

describe("the contacts a person vouched for", () => {
  it("counts what the person typed, joined in order", () => {
    expect(knownContactsText([line({ text: "mande para ana@cliente.com" }), line({ text: "e para bia@cliente.com" })])).toBe("mande para ana@cliente.com e para bia@cliente.com");
  });

  it("never counts a bot, a teammate's ask, an API line or a line somebody relayed, such as a board card", () => {
    expect(knownContactsText([
      { role: "bot" as const, text: "bot@x.com" },
      line({ text: "peer@x.com", peerAsk: { botId: "b", name: "B" } }),
      line({ text: "api@x.com", via: "api" }),
      line({ text: "card@x.com", relayed: true }),
      line({ text: "ana@cliente.com" }),
    ])).toBe("ana@cliente.com");
  });

  it("keeps only the last twenty thousand characters", () => {
    const text = knownContactsText([line({ text: "a".repeat(30_000) })]);
    expect(text).toHaveLength(20_000);
  });
});
