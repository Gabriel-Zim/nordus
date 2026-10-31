/** A bot that needs the person's answer ends its reply with "NEEDS INPUT: <question>". The marker is for the app, not for the
 *  reader: the line shows as the plain question. The stored message keeps every character. */
const NEEDS_INPUT_MARKER = /^([ \t]*)NEEDS[ \t]+INPUT[ \t]*:[ \t]*/gim;
const NEEDS_INPUT_LINE = /^[ \t]*NEEDS[ \t]+INPUT[ \t]*:/im;

export function visibleBotText(text: string): string {
  return text.replace(NEEDS_INPUT_MARKER, "");
}

export function hasNeedsInputLine(text: string): boolean {
  return NEEDS_INPUT_LINE.test(text);
}
