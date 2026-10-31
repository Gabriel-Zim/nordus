/** Each decision the decision model makes, switched on or off on its own in Settings. Absent means on. */
export const DECIDER_JOBS = [
  "roomRouting", "roomListen", "bossDispatch", "modelSize", "emailTriage", "notifications", "criticalCheck", "portalRouting", "skillPick", "taskLanes", "ackFirst", "workingLine", "tagSuggest", "browserGoal",
  // Nordus: readings the rule used to make alone; the model only helps it (server/decider/clef-reads.ts).
  "replyReading", "reactionReading", "voiceConsent", "routineNews", "needsInput", "turnError",
  // Nordus: an admin's "já pode agendar" in any chat starts the Metricool scheduling at once (server/schedule-now.ts).
  "scheduleNow",
  // Nordus: before an outside bot sends something out, the decision model checks it for another client's name, internal data or a secret (server/decider/outbound-leak.ts).
  "outboundLeak",
] as const;
export type DeciderJob = (typeof DECIDER_JOBS)[number];
