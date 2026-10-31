/** A teammate whose conversation a waiting requester is blocked on; `threadId` is that teammate's conversation. */
export interface WaitingOn {
  botId: string;
  name: string;
  threadId: string;
  /** The teammate is parked on a question for the person, not working. */
  onPerson?: true;
}
