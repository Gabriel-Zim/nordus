import { describe, expect, it } from "vitest";

import type { Message } from "../store.ts";
import { clientMessage, presentedMessage } from "./message-pages.ts";

const owner = { name: "Avery", email: "avery@example.test", avatarUrl: "/api/attachments/avery-1.png" };
const at = 1_700_000_000_000;
const line = (fields: Partial<Message>): Message => ({ id: "m1", at, role: "user", kind: "text", text: "Fala turma", ...fields });

describe("a message as a client reads it", () => {
  it("shows a line stored from the owner's paired device as the owner, and leaves the stored line alone", () => {
    const stored = line({ sender: { name: "Chrome on Mac", admin: true, id: "device-1" } });
    expect(presentedMessage(stored, owner).sender).toEqual({ name: "Avery", id: "device-1", email: "avery@example.test", avatarUrl: owner.avatarUrl, admin: true });
    expect(stored.sender).toEqual({ name: "Chrome on Mac", admin: true, id: "device-1" });
  });

  it("hands back the very same message when there is nobody to present", () => {
    for (const message of [
      line({}),
      line({ sender: { name: "Staff phone" } }),
      line({ sender: { name: "Ana", email: "ana@example.test", admin: true, notOwner: true } }),
    ]) {
      expect(presentedMessage(message, owner)).toBe(message);
    }
    const stored = line({ sender: { name: "Chrome on Mac", admin: true } });
    expect(presentedMessage(stored, {})).toBe(stored);
  });

  it("still takes the picture off a screen message, whoever sent the line before it", () => {
    const screen = line({ kind: "screen", png: "AAAA", sender: { name: "Chrome on Mac", admin: true } });
    const sent = clientMessage(screen, owner);
    expect(sent).toMatchObject({ hasImage: true, sender: { name: "Avery" } });
    expect(sent).not.toHaveProperty("png");
    expect(screen.png).toBe("AAAA");
  });
});
