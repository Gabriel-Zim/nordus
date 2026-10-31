// Nordus: one line before a hand-off, nothing after it in the same turn ("Pedido enviado..." repeats the first).
/** Per turn: whether the bot already wrote to the person and whether it handed work out. */
const handOffTurns = new Map<string, { spoke: boolean; handedOff: boolean }>();
const HAND_OFF_NOTE_MAX = 280;
function handOffTurn(threadId: string, turnId: string | undefined) {
  const key = `${threadId}:${turnId ?? ""}`;
  let turn = handOffTurns.get(key);
  if (!turn) {
    turn = { spoke: false, handedOff: false };
    handOffTurns.set(key, turn);
    if (handOffTurns.size > 500) handOffTurns.delete(handOffTurns.keys().next().value!);
  }
  return turn;
}
export function markHandOff(threadId: string, turnId: string | undefined): void {
  handOffTurn(threadId, turnId).handedOff = true;
}
/** A second short line after the hand-off, once the bot already said it is passing the work on. */
export function repeatsHandOffNote(threadId: string, turnId: string | undefined, text: string): boolean {
  const turn = handOffTurn(threadId, turnId);
  const repeat = turn.handedOff && turn.spoke && text.trim().length <= HAND_OFF_NOTE_MAX;
  if (text.trim()) turn.spoke = true;
  return repeat;
}
