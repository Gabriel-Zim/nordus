import { escapeAttribute } from "@/lib/composer-attachments";

export interface SentVoiceNote {
  path: string;
  mime: string;
  durationMs?: number;
  transcript: string;
}

const TAG = /<voice-note path="([^"]*)" mime="([^"]*)"(?: duration-ms="(\d+)")?>\n?([\s\S]*?)\n?<\/voice-note>/;

function unescape(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&#9;", "\t").replaceAll("&#13;", "\r").replaceAll("&#10;", "\n").replaceAll("&amp;", "&");
}

/** What the bot reads: the transcript inside a tag that says it came from audio. */
export function voiceNoteMessage(note: SentVoiceNote): string {
  const duration = note.durationMs ? ` duration-ms="${Math.round(note.durationMs)}"` : "";
  const text = note.transcript.replaceAll("<", "‹").replaceAll(">", "›");
  return `<voice-note path="${escapeAttribute(note.path)}" mime="${escapeAttribute(note.mime)}"${duration}>\n${text}\n</voice-note>`;
}

export function parseVoiceNote(text: string | undefined): (SentVoiceNote & { rest: string }) | null {
  if (!text || !text.includes("<voice-note")) return null;
  const match = TAG.exec(text);
  if (!match) return null;
  return {
    path: unescape(match[1]!),
    mime: unescape(match[2]!),
    durationMs: match[3] ? Number(match[3]) : undefined,
    transcript: match[4]!.trim(),
    rest: text.replace(match[0], "").trim(),
  };
}

/** The audio recorder stands in for dictation when the engine has no dictation, so the simple app keeps voice. */
export function voiceNoteVisible({ locked, hasContent, advanced, dictationAvailable }: {
  locked: boolean;
  hasContent: boolean;
  advanced: boolean;
  dictationAvailable: boolean;
}): boolean {
  return !locked && !hasContent && (advanced || !dictationAvailable);
}
