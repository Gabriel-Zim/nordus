import { describe, expect, it } from "vitest";

import { ChatToolCalls } from "./openai-chat-protocol.ts";

const completeCall = {
  id: "call_echo",
  type: "function",
  function: { name: "echo", arguments: "{}" },
};

describe("streamed chat tool calls", () => {
  it("treats explicit null continuation fields as absent", () => {
    const calls = new ChatToolCalls();
    calls.add([{ index: 0, ...completeCall, function: { ...completeCall.function, arguments: "" } }], true);
    calls.add([{ index: 0, id: null, type: null, function: { name: null, arguments: null } }], true);
    calls.add([{ index: 0, id: null, function: { name: null, arguments: "{}" } }], true);

    expect(calls.finish("tool_calls", false)).toEqual([completeCall]);
  });

  it("keeps the provider's extra_content so a Gemini thought signature is echoed back", () => {
    const signature = { google: { thought_signature: "sig-A" } };
    const streamed = new ChatToolCalls();
    streamed.add([{ index: 0, ...completeCall, extra_content: signature }], true);
    streamed.add([{ index: 0, extra_content: null, function: { arguments: "" } }], true);
    expect(streamed.finish("tool_calls", false)).toEqual([{ ...completeCall, extra_content: signature }]);

    const whole = new ChatToolCalls();
    whole.add([{ ...completeCall, extra_content: signature }], false);
    expect(whole.finish("tool_calls", false)).toEqual([{ ...completeCall, extra_content: signature }]);
  });

  it("rejects an extra_content that is not an object", () => {
    const calls = new ChatToolCalls();
    expect(() => calls.add([{ index: 0, ...completeCall, extra_content: "sig" }], true)).toThrow();
  });

  it("still rejects incomplete calls after null-only deltas", () => {
    const calls = new ChatToolCalls();
    calls.add([{ index: 0, id: null, type: null, function: { name: null, arguments: null } }], true);

    expect(() => calls.finish("tool_calls", false)).toThrow(/incomplete or duplicate/);
  });

  it.each([
    { index: 0, type: "computer" },
    { index: 0, function: null },
    { index: 0, function: [] },
    { index: 0, function: { name: 1 } },
    { index: 0, function: { arguments: 1 } },
  ])("rejects unsupported or malformed continuation fields", (delta) => {
    const calls = new ChatToolCalls();
    expect(() => calls.add([delta], true)).toThrow();
  });

  it.each([
    { id: "call_large_name", name: "n".repeat(65), arguments: "{}" },
    { id: "call_large_args", name: "echo", arguments: "x".repeat(256_001) },
  ])("preserves tool-call size limits", ({ id, name, arguments: args }) => {
    const calls = new ChatToolCalls();
    expect(() => calls.add([{ index: 0, id, function: { name, arguments: args } }], true)).toThrow(/size limit/);
  });
});

describe("tool calls per reply", () => {
  it("accepts 32 calls in one reply and refuses a 33rd", () => {
    const calls = new ChatToolCalls();
    calls.add(Array.from({ length: 32 }, (_, index) => ({ index, ...completeCall, id: `call_${index}` })), true);
    expect(calls.finish("tool_calls", false)).toHaveLength(32);
    expect(() => new ChatToolCalls().add([{ index: 32, ...completeCall }], true)).toThrow(/invalid tool-call index/);
  });
});

describe("complete chat tool calls", () => {
  it.each([
    { ...completeCall, id: null },
    { ...completeCall, type: null },
    { ...completeCall, function: null },
    { ...completeCall, function: { ...completeCall.function, name: null } },
    { ...completeCall, function: { ...completeCall.function, arguments: null } },
  ])("rejects null required fields in non-streaming responses", (call) => {
    const calls = new ChatToolCalls();
    expect(() => calls.add([call], false)).toThrow();
  });
});
