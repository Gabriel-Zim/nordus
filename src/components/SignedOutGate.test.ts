import { describe, expect, it } from "vitest";
import { takeNotificationTarget } from "@/lib/web-push";
import { googleStartHref } from "@/pair/NordusLoginPage";
import { signInReturnPath } from "./SignedOutGate";

const state = (selectedId: string) => ({
  activeView: "chat" as const,
  selectedId,
  bots: [{ id: "fabrikam", threadId: "t-fabrikam" }],
  groups: [{ id: "sala", threadId: "t-sala" }],
}) as unknown as Parameters<typeof signInReturnPath>[1];

describe("signing in again after a lost session", () => {
  it("comes back from Google to the conversation whose messages are waiting", () => {
    const path = signInReturnPath([
      { status: "failed", target: { kind: "bot", botId: "outro" }, threadId: "t-outro" },
      { status: "queued", target: { kind: "bot", botId: "fabrikam" }, threadId: "t-fabrikam" },
    ], state("sala"));
    expect(takeNotificationTarget(`https://app.nordus.ai${path}`)?.target).toEqual({ botId: "fabrikam", threadId: "t-fabrikam" });
    expect(googleStartHref(path, "")).toBe(`/auth/google?voltar=${encodeURIComponent(path)}`);
  });

  it("otherwise to the conversation on screen, a room included, and to the start when there is none", () => {
    expect(takeNotificationTarget(`https://app.nordus.ai${signInReturnPath([], state("sala"))}`)?.target)
      .toEqual({ botId: "sala", threadId: "t-sala" });
    expect(signInReturnPath([], state("ninguem"))).toBe("/");
  });
});
