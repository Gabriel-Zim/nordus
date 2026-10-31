/** ChatMarkdown sizes its normalized-markdown cache from this many entries; the transcript itself renders every row. */
export const TRANSCRIPT_WINDOW_SIZE = 120;

export interface TranscriptWindow<T> {
  visible: T[];
  startIndex: number;
  endIndex: number;
}

/** The window is the whole loaded transcript: rows stay mounted as new ones arrive and while the reader follows. */
export function resolveTranscriptWindow<T>(messages: readonly T[]): TranscriptWindow<T> {
  return { visible: [...messages], startIndex: 0, endIndex: messages.length };
}
