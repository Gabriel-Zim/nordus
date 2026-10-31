import { describe, expect, it } from "vitest";
import { roomRequestLine } from "./room-request.ts";

describe("room request line", () => {
  it("marks the request awaited when the sender is woken or polls for the answer", () => {
    expect(roomRequestLine("r1", "resume")).toEqual({ id: "r1", phase: "request", awaited: true });
    expect(roomRequestLine("r1", "poll")).toEqual({ id: "r1", phase: "request", awaited: true });
  });

  it("leaves a one-way request without the stamp, so its reply stays visible", () => {
    expect(roomRequestLine("r1", "none")).toEqual({ id: "r1", phase: "request" });
  });
});
