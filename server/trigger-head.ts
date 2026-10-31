const TRIGGER_HEAD = /^\s*\[(?:Scheduled routine|Routine) "|^\s*\[(?:USER-CONFIGURED WEBHOOK INSTRUCTIONS|AUTHENTICATED WEBHOOK TASK|DEFAULT WEBHOOK INSTRUCTIONS)\]/;

/** The opening of a message a routine or a webhook wrote, not a person. */
export const triggeredHead = (head: string | null | undefined) => Boolean(head && TRIGGER_HEAD.test(head));
