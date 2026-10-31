/** The largest recording the voice-note route accepts; the phone checks it before queueing so it never resends a refused clip. */
export const VOICE_NOTE_MAX_BYTES = 25 * 1024 * 1024;

export function voiceNoteFits(bytes: number): boolean {
  return bytes <= VOICE_NOTE_MAX_BYTES;
}
