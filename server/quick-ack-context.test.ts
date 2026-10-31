import { describe, expect, it } from "vitest";

import { isContextMessage } from "./delta-context.ts";
import { isRoomContextMessage } from "./host/room-transcript.ts";

describe("Nordus immediate line", () => {
  it("never goes back to an engine as context", () => {
    const line = { kind: "text" as const, text: "Um minuto, Avery, vou conferir.", quickAck: true };
    expect(isContextMessage(line)).toBe(false);
    expect(isRoomContextMessage(line)).toBe(false);
    expect(isContextMessage({ ...line, quickAck: undefined })).toBe(true);
  });
});
