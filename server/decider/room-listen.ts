// In a conversation room, whether a member who was not addressed has something worth adding, asked of the decision
// model instead of running that member's whole turn just to hear it stay silent.
import type { Decider } from "./index.ts";

export const ROOM_LISTEN_TIMEOUT_MS = 1_500;
/** Below this the member stays silent; a failed decision falls back to asking the member itself. */
export const ROOM_LISTEN_MIN_PROBABILITY = 0.5;
const LINE_MAX = 500;
const RECENT_LINES = 8;

export interface RoomListenInput {
  room: string;
  member: { name: string; title?: string; description?: string };
  recent: Array<{ from: string; text: string }>;
}

const clip = (value: string, max: number) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function roomListenRequest(input: RoomListenInput) {
  const member = `${clip(input.member.name, 80)}${input.member.title ? `, ${clip(input.member.title, 120)}` : ""}`;
  const state = {
    room: clip(input.room, 80),
    member,
    ...(input.member.description ? { member_role: clip(input.member.description, 400) } : {}),
    recent_messages: input.recent.slice(-RECENT_LINES).map((line) => ({ from: clip(line.from, 80), text: clip(line.text, LINE_MAX) })),
  };
  const instructions = `Should ${member} speak up now in this room conversation? Yes only if they can add something genuinely useful to the latest exchange: offer to do their part, correct a mistake, or add a missing fact within their role. No for thanks, agreement, small talk, or a topic outside their role.`;
  return { state, instructions };
}

/** "speak", "silent", or "ask" when the decision model gave no usable answer. Never throws. */
export async function decideRoomListen(
  decider: Pick<Decider, "yesNo">,
  input: RoomListenInput,
  options: { signal?: AbortSignal } = {},
): Promise<"speak" | "silent" | "ask"> {
  try {
    const { state, instructions } = roomListenRequest(input);
    const result = await decider.yesNo("roomListen", state, instructions, { timeoutMs: ROOM_LISTEN_TIMEOUT_MS, signal: options.signal });
    if (!result.ok) return "ask";
    return result.answers.p >= ROOM_LISTEN_MIN_PROBABILITY ? "speak" : "silent";
  } catch {
    return "ask";
  }
}
