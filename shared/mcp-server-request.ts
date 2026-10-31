/**
 * Durable payload of the "turn this helper on" card. Adding a helper always
 * saves it switched off; only this card's confirm turns it on, so a mistaken
 * addition never starts a new process or connection by itself.
 */
export interface McpServerRequestCardData {
  version: 1;
  requestId: string;
  botId: string;
  threadId: string;
  serverName: string;
  createdAt: number;
  reason: string;
}
