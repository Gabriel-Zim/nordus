import { afterEach, describe, expect, it, vi } from "vitest";
import { isNativeApp, nativeBadge, pushTargetFromData, sharedItemsToComposerInput } from "./native-app";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native app bridge", () => {
  it("is off in a browser and on inside the iPhone app", () => {
    vi.stubGlobal("window", {});
    expect(isNativeApp()).toBe(false);
    const Badge = { set: vi.fn(), clear: vi.fn() };
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { Badge } } });
    expect(isNativeApp()).toBe(true);
    expect(nativeBadge()).toBe(Badge);
  });

  it("reads the conversation a push opens", () => {
    expect(pushTargetFromData({ botId: "b1", threadId: "t1", aps: {} })).toEqual({ botId: "b1", threadId: "t1" });
    expect(pushTargetFromData({ botId: "b1", threadId: "t1", requestId: "req-7" })).toEqual({ botId: "b1", threadId: "t1", requestId: "req-7" });
    expect(pushTargetFromData({ botId: "b1", threadId: "t1", requestId: "a\"]b" })).toEqual({ botId: "b1", threadId: "t1" });
    expect(pushTargetFromData({ botId: "b1" })).toBeNull();
    expect(pushTargetFromData(undefined)).toBeNull();
  });

  it("turns shared items into composer text and files", () => {
    const { text, files } = sharedItemsToComposerInput([
      { id: "1", kind: "url", url: "https://nordus.ai" },
      { id: "2", kind: "text", text: "olha isso" },
      { id: "3", kind: "file", name: "foto.png", mime: "image/png", base64: btoa("png") },
    ]);
    expect(text).toBe("https://nordus.ai\nolha isso");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("foto.png");
    expect(files[0].type).toBe("image/png");
  });
});
