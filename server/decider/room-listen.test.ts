import { describe, expect, it } from "vitest";

import { decideRoomListen, roomListenRequest } from "./room-listen.ts";

const input = { room: "ROTEIRO TIME", member: { name: "DESIGNERDEIA", title: "Designer" }, recent: [{ from: "Avery", text: "Legenda para o post de café?" }, { from: "Social", text: "Café quentinho, manhã boa!" }] };

describe("room listen", () => {
  it("asks about this member and the latest exchange only", () => {
    const { state, instructions } = roomListenRequest(input);
    expect(state).toMatchObject({ room: "ROTEIRO TIME", member: "DESIGNERDEIA, Designer" });
    expect(state.recent_messages).toHaveLength(2);
    expect(instructions).toContain("Should DESIGNERDEIA, Designer speak up now");
  });

  it("speaks above the bar, stays silent below it, and asks the member when the decision fails", async () => {
    const answer = (p: number) => ({ yesNo: async () => ({ ok: true as const, provider: "jev" as const, answers: { type: "yesno" as const, p } }) });
    expect(await decideRoomListen(answer(0.8) as never, input)).toBe("speak");
    expect(await decideRoomListen(answer(0.2) as never, input)).toBe("silent");
    expect(await decideRoomListen({ yesNo: async () => ({ ok: false as const, reason: "timeout" as const }) } as never, input)).toBe("ask");
    expect(await decideRoomListen({ yesNo: async () => { throw new Error("x"); } } as never, input)).toBe("ask");
  });
});
