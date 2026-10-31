/** Whether a conversation's session runs another model than this turn's on an engine that pins a session to its first
 * model: resuming it would be refused, so the turn starts a fresh session with the history replayed instead. */
export function sessionOnOtherModel(input: {
  pinned: boolean;
  instanceId: string;
  model: string | undefined;
  liveSessionModel: string | undefined;
  lastContextModel: string | undefined;
}): boolean {
  if (!input.pinned || !input.model) return false;
  const prefix = `${input.instanceId}:`;
  const last = input.lastContextModel?.startsWith(prefix) ? input.lastContextModel.slice(prefix.length) : undefined;
  const known = input.liveSessionModel ?? last;
  return known !== undefined && known !== input.model;
}

export function sessionHoldsOtherModel(configResult: any, model: string | undefined): boolean {
  const current = configResult?.models?.currentModelId;
  return Boolean(model) && typeof current === "string" && current !== model;
}
